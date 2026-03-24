# Kosovo FM coverage: official-source blocker

As of 2026-03-24, I did not find a clean public official source that can be
turned into a reproducible Kosovo FM importer for `hackrf-webui` with at least
frequency, site/city, and station/licensee fields.

## What is available officially

- The Independent Media Commission (`KPM`) public site is here:
  - https://www.kpm-ks.org/
- The public KPM frontend is a React SPA and ships this bundle:
  - https://www.kpm-ks.org/static/js/main.0f6c9ac9.js
- That bundle points to a public CMS API base at:
  - https://www.kpm-ks.org/cmsapi/api/
- The Electronic and Postal Communications Regulatory Authority (`ARKEP`) public
  site is here:
  - https://www.arkep-rks.org/
- The ARKEP frontend ships this public bundle:
  - https://www.arkep-rks.org/static/js/main.8f1ff34a.chunk.js
- ARKEP also exposes a public frequency-search backend:
  - https://www.arkep-rks.org/api/api/Home/GetDate
  - https://www.arkep-rks.org/api/api/RadioFrequenc/GetAllocations
  - https://www.arkep-rks.org/api/api/RadioFrequenc/GetApplications
  - https://www.arkep-rks.org/api/api/RadioFrequenc/Search?rangeFrom=87.5&rangeTo=108&typeId=3

## Why this is blocked for a tuneable FM importer

- KPM does not expose a public structured FM station registry.
  - The current public frontend points at `/cmsapi/api/`, but the discoverable
    endpoints exposed by the shipped JS are CMS-style content/admin calls rather
    than a public radio-frequency or broadcaster register.
  - I did not find a current public endpoint on `kpm-ks.org` that returns
    nationwide FM rows with station/program name, site/city, frequency, and
    license holder.
- ARKEP's public frequency tool is reproducible but it is the wrong dataset.
  - `https://www.arkep-rks.org/api/api/Home/GetDate` is used by the public site
    to derive a `key` header for the frequency API.
  - Without that header, calls such as
    `https://www.arkep-rks.org/api/api/RadioFrequenc/GetApplications` return
    `401 Unauthorized`.
  - With the same header logic as the public frontend, the API becomes readable,
    but it returns band-plan metadata, not transmitter assignments.
  - For the FM broadcast band, the official search endpoint
    `https://www.arkep-rks.org/api/api/RadioFrequenc/Search?rangeFrom=87.5&rangeTo=108&typeId=3`
    returns rows such as:
    - `87.5-100 MHz` / allocation `Broadcasting` / application `FM sound analogue`
    - `100-108 MHz` / allocation `Broadcasting` / application `FM sound analogue`
  - Those rows contain fields like frequency range, allocation term, allocation
    status, application term, and comments, but they do not identify actual FM
    stations, programme names, transmitter sites, or licensees.
- The missing fields are exactly the fields needed for a tuneable FM catalog.
  - No per-station or per-transmitter frequency rows
  - No site/city names for transmitters
  - No station/program names tied to frequencies
  - No license-holder or operator names tied to FM assignments

## Practical conclusion

Do not add a Kosovo importer until one of these exists:

- a public KPM register of licensed radio services with current technical FM
  parameters, or
- a public ARKEP export/API that lists actual FM transmitters or stations with
  at least frequency, site/city, station/programme name, and holder/licensee.

Without that, any Kosovo FM importer would either scrape non-registry CMS
content or incorrectly treat ARKEP's band-allocation table as if it were a
station list.
