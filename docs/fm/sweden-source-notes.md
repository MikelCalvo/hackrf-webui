# Sweden FM Source Notes

## Source Status

Current Sweden FM importing remains blocked from this environment when restricted to directly accessible official sources for the currently on-air FM layer.

Official sources checked:

- `https://mediemyndigheten.se/tillstandsregister/?search-type=2`
- `https://mediemyndigheten.se/tillstandsregister/?search-type=1`
- `https://mediemyndigheten.se/ansokan-och-registrering/sanda-radio/`
- `https://mediemyndigheten.se/ansokan-och-registrering/sanda-radio/sok-tillstand-for-kommersiell-radio/`
- `https://mediemyndigheten.se/globalassets/dokument/sandningstillstand/analog-radio/17-02157-beslut-nationella-tillstand-analog-radio-2018.pdf`
- `https://mediemyndigheten.se/globalassets/dokument/sandningstillstand/analog-radio/17-02157-beslut-regionala-tillstand-analog-radio-med-bilagor.pdf`
- `https://mediemyndigheten.se/contentassets/a65f6b791c674e07874a3918910d9abf/sandningsomraden-med-mastplatser-sandarparametrar-och-antenndiagram.pdf`
- `https://mediemyndigheten.se/contentassets/a65f6b791c674e07874a3918910d9abf/information-om-analog-kommersiell-radio.pdf`
- `https://pts.se/tillstand-och-anmalan/radio/ljudrundradio/`
- `https://radiotillstand.pts.se/TvRadio/create`

## Blocker

- The official `Tillståndsregister` still exposes names, permit holders, dates, municipalities, and counties, but not FM frequencies or transmitter sites.
- Mediemyndigheten's current `Sända radio` page does list the analog commercial channels that are on air today, but only as station name plus holder. It links the current 2018 permit PDFs, and those PDFs explicitly state that technical conditions such as frequency and power are decided by PTS rather than included in the permit text.
- The official PTS `Ljudrundradio` page and `radiotillstand.pts.se` e-service explain how to apply for FM transmitter permits and what technical data must be supplied, but they do not expose a public downloadable register of issued current FM transmitter permits.
- The accessible large technical PDF is for the next analog commercial period starting on `2026-08-01`, while the current permits shown in the official register still run through `2026-07-31`. That PDF therefore does not describe the currently active FM layer on `2026-03-24`.
- The official information PDF states that Excel and ITU technical files are available on request via `registrator@mediemyndigheten.se`; those files are not directly downloadable from this environment.
- Community radio (`Närradio`) still lacks directly accessible official current frequency data here, and the checked official public-service radio documents also do not expose a current station-by-frequency FM table.

## Practical Result

- A current, exact Sweden FM importer should stay blocked until a directly accessible official source exposes current FM frequencies together with station or permit identity.
- A future-period commercial-only parser remains possible from the `2026-08-01` technical PDF, but it would not represent the current tuneable FM catalog.
