#!/usr/bin/env python3
"""Retakes the mods' README screenshots (docs/screenshots/) from the real panes.

Runs `claude --plugin-dir mods` (light theme, fullscreen layout) in a pseudo-terminal of
210 x 60 cells, so a docked pane opens at about 94 columns, drives each view (commands,
clicks on the rows to unfold), reads the screen with its colours through a terminal emulator,
cuts it to the pane and draws it framed into a PNG of 256 colours.

    python dev/screenshots.py                 # the five pane views
    python dev/screenshots.py band            # context-band: runs one real turn reading two files
    python dev/screenshots.py spec demo-home  # some views only
    python dev/screenshots.py --out /tmp/shots

Needs `pyte`, `pillow`, `fonttools`, and `pywinpty` on Windows or `ptyprocess` elsewhere:
    python -m pip install pyte pillow fonttools pywinpty   # ptyprocess instead of pywinpty off Windows
A maintainer tool for this checkout: never shipped, never a `cctoolkit` command.
"""
import argparse
import json
import os
import shutil
import sys
import threading
import time
from collections import Counter
from pathlib import Path

import pyte
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
COLS, ROWS = 210, 60
SPEC = 'examples/todo/product-archiving/SPEC-product-archiving.md'


# --- terminal --------------------------------------------------------------------------------

class Terminal:
    """`claude` in a pseudo-terminal, its screen kept by pyte."""

    def __init__(self, argv: list[str], cwd: Path):
        env = {k: v for k, v in os.environ.items() if not k.startswith('CLAUDE')}
        env.update(TERM='xterm-256color', COLORTERM='truecolor', CLAUDE_CODE_NO_FLICKER='1')
        self.screen = pyte.Screen(COLS, ROWS)
        self.stream = pyte.Stream(self.screen)
        self.lock = threading.Lock()
        if sys.platform == 'win32':
            import winpty
            self.proc = winpty.PtyProcess.spawn(argv, dimensions=(ROWS, COLS), cwd=str(cwd), env=env)
            self._read = lambda: self.proc.read(65536)
        else:
            from ptyprocess import PtyProcess
            self.proc = PtyProcess.spawn(argv, dimensions=(ROWS, COLS), cwd=str(cwd), env=env)
            self._read = lambda: self.proc.read(65536).decode('utf-8', 'replace')
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        while True:
            try:
                data = self._read()
            except EOFError:
                return
            if data:
                with self.lock:
                    self.stream.feed(data)

    def write(self, text: str):
        self.proc.write(text if sys.platform == 'win32' else text.encode())

    def cells(self) -> list[list[tuple]]:
        with self.lock:
            return [[(c.data, c.fg, c.bg, c.bold, c.italics, c.underscore, c.reverse)
                     for c in (self.screen.buffer[y][x] for x in range(COLS))] for y in range(ROWS)]

    def lines(self) -> list[str]:
        return [''.join(cell[0] for cell in row) for row in self.cells()]

    def wait(self, text: str, timeout: float = 30, gone: bool = False) -> list[str]:
        end = time.time() + timeout
        while time.time() < end:
            lines = self.lines()
            if any(text in line for line in lines) != gone:
                time.sleep(0.8)  # let the frame settle
                return self.lines()
            time.sleep(0.3)
        raise TimeoutError(f'{"still" if gone else "never"} on screen: {text!r}')

    def type(self, text: str, settle: float = 0.6):
        for ch in text:  # one key at a time: a burst reads as a paste
            self.write(ch)
            time.sleep(0.02)
        time.sleep(settle)
        self.write('\r')

    def command(self, text: str, expect: str, timeout: float = 30):
        self.type(text)
        return self.wait(expect, timeout)

    def click(self, text: str, dx: int = 0, after: str | None = None):
        """Clicks the cell `dx` columns right of where `text` starts (the last occurrence)."""
        lines = self.lines()
        y = max(i for i, line in enumerate(lines) if text in line)
        x = lines[y].index(text) + dx
        self.write(f'\x1b[<0;{x + 1};{y + 1}M')  # a whole sequence at once: split, ESC reads as Escape
        time.sleep(0.2)
        self.write(f'\x1b[<0;{x + 1};{y + 1}m')
        if after is not None:
            self.wait(after)
        time.sleep(1)

    def close(self):
        try:
            self.proc.terminate(force=True)
        except Exception:
            pass


# --- crops -----------------------------------------------------------------------------------

def pane_box(lines: list[str], start: str) -> tuple[int, int, int, int]:
    """Right of the docked pane's `│` border, from the row holding `start` to its last non-blank row."""
    y0 = next(i for i, line in enumerate(lines) if start in line)
    sep = lines[y0].index('│')
    y = y0
    while y + 1 < len(lines) and lines[y + 1][sep] == '│':
        y += 1
    while not lines[y][sep + 1:].strip():
        y -= 1
    return sep + 1, COLS, y0, y + 1


def band_box(lines: list[str]) -> tuple[int, int, int, int]:
    """The prompt between its two rules and the band beneath, as wide as the band's text."""
    prompt = max(i for i, line in enumerate(lines) if line.startswith('❯'))
    y1 = max(i for i, line in enumerate(lines) if line.strip()) + 1
    width = max(len(line.rstrip()) for line in lines[prompt + 2:y1])
    return 0, min(COLS, width + 4), prompt - 1, y1


# --- drawing ---------------------------------------------------------------------------------

FONT_DIRS = [Path('C:/Windows/Fonts'), Path('/usr/share/fonts'), Path('/Library/Fonts'), Path.home() / '.fonts']
MONO = ['CascadiaMono.ttf', 'DejaVuSansMono.ttf', 'Menlo.ttc']
FALLBACK = ['consola.ttf', 'seguisym.ttf', 'seguiemj.ttf', 'DejaVuSans.ttf', 'NotoSansSymbols2-Regular.ttf']
TITLE = ['segoeui.ttf', 'DejaVuSans.ttf', 'Helvetica.ttc']
SIZE, LH = 26, 40
FG = (31, 31, 31)
NAMED = {
    'black': (31, 31, 31), 'red': (190, 60, 50), 'green': (60, 130, 60), 'brown': (170, 120, 30), 'yellow': (170, 120, 30),
    'blue': (40, 100, 200), 'magenta': (150, 60, 160), 'cyan': (30, 140, 160), 'white': (200, 200, 200),
}


def font_file(names: list[str]) -> Path | None:
    for name in names:
        for folder in FONT_DIRS:
            found = next(folder.rglob(name), None) if folder.is_dir() else None
            if found is not None:
                return found
    return None


def colour(value: str, default: tuple) -> tuple:
    if value == 'default':
        return default
    if value in NAMED:
        return NAMED[value]
    if len(value) == 6:
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    return default


def draw(cells: list[list[tuple]], box: tuple[int, int, int, int], title: str, out: Path):
    mono = font_file(MONO)
    if mono is None:
        sys.exit(f'no monospace font among {MONO}')
    regular = ImageFont.truetype(str(mono), SIZE)
    bold = ImageFont.truetype(str(mono), SIZE)
    try:
        bold.set_variation_by_name('Bold')
    except Exception:
        pass
    cmap = TTFont(str(mono), lazy=True, fontNumber=0).getBestCmap()
    fallbacks = [(TTFont(str(f), lazy=True, fontNumber=0).getBestCmap(), ImageFont.truetype(str(f), SIZE - 2))
                 for f in (font_file([n]) for n in FALLBACK) if f is not None]
    titled = font_file(TITLE)
    title_font = ImageFont.truetype(str(titled), 28) if titled is not None else regular

    def font_for(ch: str, is_bold: bool):
        if ord(ch[0]) in cmap:
            return bold if is_bold else regular
        return next((f for table, f in fallbacks if ord(ch[0]) in table), regular)

    x0, x1, y0, y1 = box
    cw = round(regular.getlength('M'))
    bg = colour(Counter(cells[y][x][2] for y in range(y0, y1) for x in range(x0, x1)).most_common(1)[0][0], (238, 238, 238))
    pad, bar, margin, radius = 40, 66, 56, 22
    w, h = (x1 - x0) * cw + 2 * pad, (y1 - y0) * LH + 2 * pad - 16 + bar
    win = Image.new('RGB', (w, h), bg)
    d = ImageDraw.Draw(win)
    d.rectangle([0, 0, w, bar], fill=(246, 246, 247))
    d.line([0, bar, w, bar], fill=(222, 222, 224), width=2)
    for i, dot in enumerate([(176, 132, 104), (232, 184, 106), (90, 140, 90)]):
        cx = 40 + i * 40
        d.ellipse([cx - 12, bar // 2 - 12, cx + 12, bar // 2 + 12], fill=dot)
    d.text(((w - d.textlength(title, font=title_font)) / 2, bar // 2), title, font=title_font, fill=(40, 40, 40), anchor='lm')
    for r in range(y1 - y0):
        y = bar + pad + r * LH
        for c in range(x1 - x0):
            ch, fg, cbg, is_bold, _, under, reverse = cells[y0 + r][x0 + c]
            x = pad + c * cw
            fgc, bgc = colour(fg, FG), colour(cbg, bg)
            if reverse:
                fgc, bgc = bgc, fgc
            if bgc != bg:
                d.rectangle([x, y - 4, x + cw, y + LH - 4], fill=bgc)
            if ch == '│':
                d.line([x + cw // 2, y - 4, x + cw // 2, y + LH - 4], fill=fgc, width=2)
            elif ch in '─━':
                d.line([x, y + LH // 2 - 4, x + cw, y + LH // 2 - 4], fill=fgc, width=4 if ch == '━' else 2)
            elif ch and ch != ' ':
                d.text((x, y + LH // 2 - 4), ch, font=font_for(ch, is_bold), fill=fgc, anchor='lm')
            if under:
                d.line([x, y + LH - 8, x + cw, y + LH - 8], fill=fgc, width=2)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius, fill=255)
    canvas = Image.new('RGB', (w + 2 * margin, h + 2 * margin), (232, 233, 236))
    shadow = Image.new('L', canvas.size, 0)
    ImageDraw.Draw(shadow).rounded_rectangle([margin, margin + 8, margin + w, margin + h + 8], radius, fill=70)
    canvas.paste((200, 201, 205), (0, 0), shadow.filter(ImageFilter.GaussianBlur(18)))
    canvas.paste(win, (margin, margin), mask)
    canvas.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(out, optimize=True)
    print(f'{out.as_posix()}  {canvas.size[0]}x{canvas.size[1]}')


# --- views -----------------------------------------------------------------------------------

def run_lot(term: Terminal, args: str, start: str):
    term.command(f'/run-lot-pane {args}', start)
    return pane_box(term.wait('Supervisor' if 'plan' in args else 'c: current step'), start)


def demo_home(term: Terminal):
    term.command('/knowledge-pane demo', '✻ Knowledge')
    term.wait('Recent')
    if '▸ Observed' in '\n'.join(term.lines()):
        term.click('▸ Observed', after='▾ Observed')  # on the terminal, the glyph is the button
    return pane_box(term.lines(), '✻ Knowledge')


def spec(term: Terminal):
    term.command(f'/spec-pane {SPEC}', '✻ Spec')
    term.wait('Technical points')
    term.click('● 1 ', after='Impact')
    term.click('CAT-RM-003', after='Statement:')
    return pane_box(term.wait('fold all'), '✻ Spec')


def band(term: Terminal):
    term.type('Read CHANGELOG.md and README.md, then answer with the single word: ok')
    term.wait('1 turn', timeout=240)
    term.wait('details')
    term.click('▸ details', after='Step')
    return band_box(term.lines())


VIEWS = {
    'demo-running': ('run-lot-pane — run-lot in progress', lambda t: run_lot(t, 'demo', '✻ run-lot')),
    'demo-plan-running': ('run-lot-pane — run-plan in progress', lambda t: run_lot(t, 'demo plan', '✻ run-plan')),
    'demo-plan-merge': ('run-lot-pane — run-plan delivered, merge staged', lambda t: run_lot(t, 'demo plan merge', '✻ run-plan')),
    'demo-home': ('knowledge-pane — demo base', demo_home),
    'spec': ('knowledge-pane — spec', spec),
    'band': ('context-band', band),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('views', nargs='*', help=f'among {", ".join(VIEWS)}; all but band by default')
    parser.add_argument('--out', type=Path, default=ROOT / 'docs' / 'screenshots')
    options = parser.parse_args()
    views = options.views or [name for name in VIEWS if name != 'band']
    unknown = [name for name in views if name not in VIEWS]
    if unknown:
        parser.error(f'unknown view: {", ".join(unknown)}')
    claude = shutil.which('claude')
    if claude is None:
        sys.exit('claude is not on the PATH')
    options.out.mkdir(parents=True, exist_ok=True)
    term = Terminal([claude, '--plugin-dir', 'mods', '--settings', json.dumps({'theme': 'light'})], ROOT)
    try:
        term.wait('Claude Code', timeout=60)
        term.wait('❯')
        # band first: its turn is the session's only one, before any pane opens beside it
        for name in sorted(views, key=lambda n: n != 'band'):
            title, take = VIEWS[name]
            box = take(term)
            draw(term.cells(), box, title, options.out / f'{name}.png')
    finally:
        term.close()


if __name__ == '__main__':
    main()
