# PRD-ARCH — Product archiving

> A catalogue manager archives a published product that is no longer sold, and can restore it later. Archived products leave the catalogue but keep their history, so past orders and diagrams stay readable.

## 1. Context <!-- kit:context -->

Products that are no longer sold can only be deleted today, which breaks the diagrams and orders that reference them. Catalogue managers keep obsolete products published instead, and customers keep finding them in the catalogue.

## 2. Vocabulary <!-- kit:vocabulary -->

| Term | Definition |
|------|------------|
| Archived product | Product withdrawn from the catalogue, kept read-only for history |
| Catalogue manager | User allowed to change the lifecycle of the organisation's products |

## 3. Overview <!-- kit:overview -->

```mermaid
flowchart LR
    D[Draft] -->|publish| P[Published]
    P -->|"archive (CU-01, RM-01)"| A[Archived]
    A -->|"restore (CU-02, RM-04)"| P
    A -.->|"hidden from catalogue (RM-03)"| C[Catalogue listing]
```

## 4. Use cases <!-- kit:use-cases -->

### CU-01 — Archive a product

**Actor** catalogue manager · **Intent** withdraw a product no longer sold without losing its history · **Frequency** a few times a month

**Nominal scenario:**
1. The manager opens a published product of their organisation.
2. They ask to archive it.
3. The product becomes archived and leaves the catalogue listing.

**Errors:** product not published → refused (RM-01); product of another organisation → reported as not found (RM-02).

### CU-02 — Restore an archived product

**Actor** catalogue manager · **Intent** put back on sale a product archived by mistake · **Frequency** rare

**Nominal scenario:**
1. The manager opens an archived product.
2. They ask to restore it.
3. The product is published again and reappears in the catalogue listing.

**Errors:** product not archived → refused (RM-04).

## 5. Business rules <!-- kit:business-rules -->

### RM-01 — Only a published product can be archived
- **Statement**: archiving a draft or an already archived product is refused · **Origin**: product choice · **Severity**: blocking
- **Applies to**: CU-01

### RM-02 — A product is visible only to its organisation
- **Statement**: a product of another organisation is reported as not found, never as forbidden · **Origin**: existing product behaviour · **Severity**: blocking
- **Applies to**: cross-cutting

### RM-03 — An archived product is absent from the catalogue listing
- **Statement**: the catalogue listing returns published products only; an archived product stays readable by its identifier · **Origin**: product choice · **Severity**: blocking
- **Applies to**: CU-01, CU-02

### RM-04 — Only an archived product can be restored
- **Statement**: restoring a product that is not archived is refused · **Origin**: product choice · **Severity**: blocking
- **Applies to**: CU-02

## 7. States & transitions <!-- kit:states -->

| State | Event | Next state | Condition |
|-------|-------|------------|-----------|
| Published | archive | Archived | RM-01 |
| Archived | restore | Published | RM-04 |

## 9. Relations <!-- kit:relations -->

| Upstream | Downstream |
|----------|------------|
| Product publication (existing) | Catalogue listing filters on the lifecycle state |

## 10. Out of scope <!-- kit:out-of-scope -->

| Exclusion | Reason |
|-----------|--------|
| Archiving several products at once | No demand yet; one at a time covers the need |
| Notifying customers of an archived product | Handled by the marketing team, outside the product |

## 11. Assumptions <!-- kit:assumptions -->

| # | Assumption | To be validated by |
|---|------------|--------------------|
| 1 | Diagrams referencing an archived product keep displaying it, unchanged | Product owner |

## 12. Open questions <!-- kit:open-questions -->

<!-- kit:cols n,severity,question,impact,options -->
| # | Severity | Question | Impact | Options |
|---|----------|----------|--------|---------|
| 1 | Major | Should an archived product be restorable after a set period (e.g. 2 years)? | A retention limit would add a rule to CU-02 | No limit (recommended) / 2 years / configurable |
