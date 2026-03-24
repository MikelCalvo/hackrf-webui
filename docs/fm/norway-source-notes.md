# Norway FM coverage: official-source blocker

As of 2026-03-24, I did not find a clean official public source that can be turned into a
reproducible Norway FM importer for `hackrf-webui` with at least frequency, site/city, and
station/licensee fields.

## What is available officially

- Nkom's TV/radio permissions page points users to Finnsenderen for operational FM and DAB
  transmitters:
  - https://nkom.no/frekvenser-og-elektronisk-utstyr/tillatelse-til-a-bruke-frekvenser/tv-og-radio
- Finnsenderen itself is an official Nkom service:
  - https://finnsenderen.no/
- Finnsenderen exposes some public metadata endpoints for `type=Radio og TV`:
  - https://finnsenderen.no/finnsenderen_service/rest/settings
  - https://finnsenderen.no/finnsenderen_service/rest/possiblefilters?type=Radio%20og%20TV
  - https://finnsenderen.no/finnsenderen_service/rest/technologies?type=Radio%20og%20TV
  - https://finnsenderen.no/finnsenderen_service/rest/services?type=Radio%20og%20TV
  - https://finnsenderen.no/finnsenderen_service/rest/operators?type=Radio%20og%20TV
- Nkom also runs Frekvensportalen with a public spectrum-rights export:
  - https://frekvens.nkom.no/#/main
  - https://frekvens.nkom.no/frekvensportalen_service/rest/rightofuseinfos
- Medietilsynet publishes an official radio concessions overview page:
  - https://www.medietilsynet.no/tv-film-radio/radio/oversikt-over-konsesjonarer-og-ledige-sendernett-for-radio/

## Why this is blocked for a tuneable FM importer

- Finnsenderen does not expose a public bulk FM station list.
  - The public REST endpoints above only return filter metadata such as available technologies
    (`FM`, `DAB`, `TV`, `DVBT2`) and service labels (`Kommersiell`, `Lokal`, `NRK`).
  - The current public SPA served by `https://finnsenderen.no/main.js?692a7b764fda33eb25a2`
    exposes only the `straaling`, `ledige`, and `about` routes in the current build. The old
    radio-specific UI is not publicly reachable anymore.
  - The shipped JS still contains a detail-only pattern,
    `sendermaster/{id}/sendere`, but that is not sufficient for scraping because there is no
    public ID-discovery/list endpoint in the same build.
- The obvious Finnsenderen list endpoints are not public.
  - These candidate endpoints returned `404` when tested from this environment:
    - https://finnsenderen.no/finnsenderen_service/rest/sendermaster
    - https://finnsenderen.no/finnsenderen_service/rest/sendermaster/
    - https://finnsenderen.no/finnsenderen_service/rest/sendere
    - https://finnsenderen.no/finnsenderen_service/rest/master
    - https://finnsenderen.no/finnsenderen_service/rest/masters
- The `straaling` endpoint is not a usable workaround.
  - `https://finnsenderen.no/finnsenderen_service/rest/straaling` returns an exposure summary for
    a chosen position, not an enumerable national FM register. It does not provide a reproducible
    countrywide list of FM rows with station, site, and licensee.
- Frekvensportalen is official and reproducible, but it is the wrong dataset.
  - `https://frekvens.nkom.no/frekvensportalen_service/rest/rightofuseinfos` returns
    spectrum-rights rows such as frequency ranges, holder, coverage area, and permit number.
  - In the FM broadcast band, the public rows observed from this endpoint were generic
    `Band II LPD` entries for low-power FM use under the general authorisation rules, not a list
    of operational broadcast transmitters with site/city and programme names.
  - That makes Frekvensportalen unsuitable for a tuneable FM catalog even though the endpoint is
    public and stable.
- Medietilsynet does not provide a usable replacement from this runtime.
  - The official page above is informative, but from this environment both
    `https://medietilsynet.no/...` and `https://www.medietilsynet.no/...` fail after redirect to
    `www.medietilsynet.no` because the `www` hostname does not resolve here.
  - The page content visible through browser access is also about local-radio concessions and
    sendernett areas, not a complete nationwide per-frequency FM transmitter register.

## Practical conclusion

Do not add a Norway importer until one of these exists:

- a public Nkom/Finnsenderen bulk endpoint that lists operational FM transmitters with fields
  like frequency, site, programme, and holder, or
- a public Medietilsynet or Nkom export file with equivalent per-transmitter data.

Without that, any Norway FM importer would depend on brittle reverse engineering of an incomplete
frontend and still would not have a trustworthy public station list to import.
