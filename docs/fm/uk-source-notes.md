# UK FM coverage: official-source blocker

As of 2026-03-24, Ofcom does publish an official current broadcast-radio
technical-parameters source, and the published field descriptions suggest it
would likely be usable for a UK FM importer. However, from this environment the
actual downloadable files are still blocked behind an interactive Cloudflare
challenge, so the source cannot be fetched reproducibly or validated end to end.

## What is available officially

- Ofcom's current broadcast-radio technical-parameters page is public here:
  - https://www.ofcom.org.uk/tv-radio-and-on-demand/coverage-and-transmitters/radio-tech-parameters
- That page was reachable from this environment and, on 2026-03-24, stated:
  - Published: 21 July 2023
  - Last updated: 17 March 2026
- The same page advertises current downloadable files, including:
  - `TxParams VHF data (CSV)`
  - `TxParams MF data (CSV)`
  - `TxParams DAB data (CSV)`
  - `Entire set of TxParams data values (XLSX)`
- The current Ofcom VHF CSV download URL tested from this environment was:
  - https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsvhf.csv?v=413713
- The current Ofcom XLSX download URL tested from this environment was:
  - https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparams.xlsx?v=413717
- data.gov.uk also publishes the official dataset landing page:
  - https://www.data.gov.uk/dataset/7b8b2c73-3b3c-4958-b942-dfcd09ebcb0e/technical-parameters-for-broadcast-radio-transmitters
- The official CKAN API entry for that dataset is accessible:
  - https://www.data.gov.uk/api/3/action/package_show?id=technical-parameters-for-broadcast-radio-transmitters

## Why this remains blocked here

- The current Ofcom download URLs are not fetchable by standard clients in this
  environment.
  - The current VHF CSV URL above returns `HTTP 403`.
  - The response headers include `cf-mitigated: challenge`.
  - The response body is the Cloudflare interstitial with `Just a moment...`
    and `Enable JavaScript and cookies to continue`.
- The same runtime block affects the legacy Ofcom asset URLs still referenced by
  data.gov.uk metadata.
  - Example legacy VHF URL:
    - https://www.ofcom.org.uk/__data/assets/file/0020/91307/TxParamsVHF.csv
  - This also returned `HTTP 403` with the same Cloudflare challenge headers.
- data.gov.uk does not provide a usable official mirror or proxy for the CSV.
  - The VHF preview page is reachable:
    - https://www.data.gov.uk/dataset/7b8b2c73-3b3c-4958-b942-dfcd09ebcb0e/technical-parameters-for-broadcast-radio-transmitters/datafile/e59f7b0a-784f-43b9-8205-7a409fe1e522/preview
  - But it explicitly says:
    - `Currently there is no preview available for "TxParams VHF data (CSV, 732.2 KB)"`
  - The CKAN `package_show` API returns only resource metadata and blocked Ofcom
    URLs, not the CSV rows themselves.

## What the source appears to contain

- From the field explanations on Ofcom's public page, the analogue VHF data
  includes fields such as `Station`, `Area`, `Site`, and `Frequency`, plus
  technical details like grid reference, aerial height, ERP, and RDS metadata.
- Inference from that official documentation:
  - the VHF CSV looks likely suitable for FM tuneable rows if the file were
    actually downloadable here.
- I could not verify the live CSV schema directly from this environment because
  the file download itself is blocked.

## Practical conclusion

Do not add a UK importer until one of these is true:

- the current Ofcom VHF CSV/XLSX becomes directly fetchable from this
  environment without an interactive challenge, or
- data.gov.uk exposes an official preview, mirror, or API that returns the
  actual VHF rows rather than only metadata.

Without that, any UK importer would depend on a source that cannot be fetched or
smoke-tested reproducibly from this runtime.
