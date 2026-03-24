# New Zealand FM coverage: official-source blocker

As of 2026-03-24, Radio Spectrum Management (RSM) / the Register of Radio Frequencies (RRF)
does not expose a real public bulk export path for New Zealand FM licence data that is suitable
for a reproducible public importer in this repository.

## What is available publicly

- Public users can search licences in the RRF:
  - https://www.rsm.govt.nz/licensing/how-do-i/use-the-rrf/search-the-rrf/search-licences
- Public users can also use area search:
  - https://www.rsm.govt.nz/licensing/how-do-i/use-the-rrf/search-the-rrf/area-search-licences
- RSM publishes high-level licensing and policy pages for commercial FM broadcasting:
  - https://www.rsm.govt.nz/licensing/licences-you-must-pay-for/broadcasting-licences/commercial-fm-sound-broadcasting-licence

## Why this is blocked for a bulk importer

- RSM's own documentation says licence data extracts are only available to approved users logged
  into the RRF with RealMe:
  - https://www.rsm.govt.nz/licensing/how-do-i/use-the-rrf/extract-data-from-the-rrf/extracting-licence-data
  - https://www.rsm.govt.nz/licensing/how-do-i/use-the-rrf/rrf-user-guides/specialised-searching/extracting-licence-data-from-the-rrf
- The search pages note that authorised users can export search results to CSV, which implies the
  public search flow is not a public bulk data feed.
- The area-search documentation also states that only point or multiple-point licences are found,
  and licences with named or defined areas are not returned, so a public scrape of area search
  would be incomplete by design:
  - https://www.rsm.govt.nz/licensing/how-do-i/use-the-rrf/search-the-rrf/area-search-licences

## Practical conclusion

Do not add an importer until one of these exists:

- a public CSV/XLSX/XML/JSON bulk export from RSM/RRF, or
- a documented public search/export API that does not require approved-user privileges.

Without that, any FM importer would depend on brittle scraping of an interactive search UI and
would still risk incomplete coverage.
