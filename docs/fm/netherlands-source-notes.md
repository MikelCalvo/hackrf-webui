# Netherlands FM Source Notes

The Netherlands importer is now landed in `hackrf-webui`.

Current official source stack:

- `RDI` current FM licence pages for `LCO` and `NLCO`, which expose package-level PDF licences with holder names:
  - https://www.rdi.nl/documenten/2023/08/28/vergunningen-lco
  - https://www.rdi.nl/documenten/vergunningen/2025/07/04/vergunningen-pakketten-nlco
- `Staatscourant 2024, 36945`, used as a technical fallback for `NLCO` packages whose current `RDI` PDF does not include the annex pages:
  - https://zoek.officielebekendmakingen.nl/stcrt-2024-36945.pdf

Implementation notes:

- The importer parses the licence PDFs directly, extracting `package`, `site`, `frequency`, and `ERP`.
- `LCO` and `NLCO` holder names come from the current `RDI` index pages.
- `B20` and `B24` fall back to the `Staatscourant` technical annex because the current `RDI` PDFs are short general permits without the full technical appendix.
- The current landed result is `307` Dutch FM rows across `89` cities in the generated catalog.

Conclusion:

- There is still no single normalized national Dutch FM export.
- The combined `RDI` + `Staatscourant` path is good enough to produce a reproducible public importer without relying on unofficial directories.
