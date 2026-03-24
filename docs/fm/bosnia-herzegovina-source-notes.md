# Bosnia and Herzegovina FM coverage: official-source blocker

As of 2026-03-24, the Communications Regulatory Agency of Bosnia and Herzegovina
(`RAK`, often referred to as the CRA regulator) does not expose a clean public FM
station register that can be used as a reproducible importer source for
`hackrf-webui`.

## What is available publicly

- RAK publishes annual reports. The 2024 report is public here:
  - https://docs.rak.ba/documents/508fe794-f1bc-4a72-90f7-80bcd69e2690.pdf
  - This report states that, as of 2024-12-31, there were 148 holders of the
    general terrestrial radio broadcasting permit, plus 2 medium-wave holders and
    2 nonprofit radio holders.
- RAK exposes a public site-search endpoint:
  - https://www.rak.ba/Api/Searchables/GetList?searchTerm=FM
  - https://www.rak.ba/Api/Searchables/GetList?searchTerm=LRF-R-1%2F19
- That search endpoint points to official forms and tender/result pages such as:
  - https://www.rak.ba/articles/160
  - https://www.rak.ba/news/606
  - https://www.rak.ba/news/1636
  - https://www.rak.ba/news/541
  - https://www.rak.ba/news/561
- RAK also publishes official tender/application documents under `docs.rak.ba`,
  for example:
  - https://docs.rak.ba/documents/8064d932-9c2f-4f2e-8ae3-349fb4479d2b.pdf
  - https://docs.rak.ba/documents/f0c81712-adb9-4202-b20e-11d5dc173435.pdf
  - https://docs.rak.ba/documents/d7adf907-8333-4a79-8265-a5db7337f4a5.pdf

## Why this is blocked for a tuneable FM importer

- RAK does not publish a public nationwide FM registry with per-station or
  per-transmitter rows containing at least frequency, site/city, station/program,
  and license holder.
- The 2024 annual report is not a station list.
  - It provides counts and describes licensing activity and frequency tenders.
  - It does not publish the current technical assignments for all active FM
    services.
- The public search endpoint is not a data feed.
  - `Searchables/GetList` returns only document/article metadata such as `name`,
    `url`, and `downloadUrl`.
  - It does not return broadcast rows or technical parameters for the current FM
    dial.
- The public call and results documents are not a complete current catalog.
  - They cover specific tenders and specific `LRF-R-*` resource lists.
  - Even where they mention locations or awarded resources, they are fragmented by
    competition and do not provide a single current nationwide FM register.
- The public-looking license APIs are not usable as a source.
  - `https://www.rak.ba/Api/Licenses/GetList` returns `401 Unauthorized`.
  - `https://www.rak.ba/Api/LicenseHolders/GetGrid` returns a small sample/test-like
    contact list rather than a real broadcast-license register.

## Runtime blocker in this environment

- Both `rak.ba` and `docs.rak.ba` currently fail TLS verification for standard
  clients in this environment.
- `node fetch('https://www.rak.ba/Api/Searchables/GetList?searchTerm=FM')` fails
  with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
- `node fetch('https://docs.rak.ba/documents/8064d932-9c2f-4f2e-8ae3-349fb4479d2b.pdf')`
  fails with the same certificate-verification error.
- `curl` and Python `requests` also fail certificate verification against the same
  hosts unless TLS verification is explicitly disabled.
- `http://www.rak.ba/` redirects to HTTPS, so there is no clean HTTP fallback.

## Practical conclusion

Do not add a Bosnia and Herzegovina FM importer until RAK publishes one of these:

- a public CSV/XLSX/XML/JSON/API with current FM stations or transmitters, or
- a public verified-cert endpoint that exposes current FM license data with at
  least frequency, site/city, station name, and license holder.

Without that, any importer would either depend on incomplete tender history or on
disabling TLS verification for official sources, which is not a clean or reliable
basis for this repository.
