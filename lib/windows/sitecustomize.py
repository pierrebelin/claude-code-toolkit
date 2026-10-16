"""Makes native Windows Python write like POSIX Python, for the kit only.

Put on PYTHONPATH by lib/platform.sh on Windows, never on macOS or Linux. Native
Python translates "\\n" to "\\r\\n" on stdout, stderr and every text-mode write: a
`$(python3 ...)` in a hook would keep a `\\r`, and a file the kit writes would
differ from the one it writes on macOS. Here every text-mode stream writes LF
unless the caller passes its own `newline`. Reading is untouched: universal
newlines already turn CRLF into LF.

A sitecustomize found later on sys.path (a venv's, a distribution's) is run
after this one, so installing the kit takes nothing away.
"""
import builtins
import io
import os
import sys

if os.name == "nt":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(newline="\n")
        except (AttributeError, ValueError):
            pass

    _open = io.open

    def _lf_open(file, mode="r", buffering=-1, encoding=None, errors=None, newline=None, closefd=True, opener=None):
        if newline is None and "b" not in mode and any(m in mode for m in "wax+"):
            newline = "\n"
        return _open(file, mode, buffering, encoding, errors, newline, closefd, opener)

    builtins.open = io.open = _lf_open

    _here = os.path.normcase(os.path.dirname(os.path.abspath(__file__)))
    _rest = [p for p in sys.path if os.path.normcase(os.path.abspath(p or ".")) != _here]
    try:
        import importlib.machinery
        import importlib.util

        _spec = importlib.machinery.PathFinder.find_spec("sitecustomize", _rest)
        if _spec is not None and _spec.loader is not None:
            _module = importlib.util.module_from_spec(_spec)
            _spec.loader.exec_module(_module)
    except Exception:
        pass
