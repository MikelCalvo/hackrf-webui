# Greece FM Source Notes

## Source

Official ESR workbook:

- `https://www.esr.gr/wp-content/uploads/bnl.xlsx`

The importer in `scripts/catalog/sources/esr-gr.mjs` parses all workbook sheets and keeps only rows marked active with `Λ`.

## Implementation Notes

- The source is best understood as a station and licensing register, not a pure transmitter register.
- Frequency and transmission site are extracted from `ΣΥΧΝΟΤΗΤΑ ΚΑΙ ΘΕΣΗ ΕΚΠΟΜΠΗΣ`.
- `cityName` uses a pragmatic contact-locality heuristic from `ΣΤΟΙΧΕΙΑ ΕΠΙΚΟΙΝΩΝΙΑΣ (ΤΡΕΧΩΝ ΦΟΡΕΑΣ)` because that matches the builder's GeoNames flow far better than using transmission sites directly.
- The transmission site is still preserved in the generated description and tags.

## Caveat

This importer file is implemented locally, but it is not wired into `scripts/catalog/build.mjs` in this change because that file was explicitly out of scope.
