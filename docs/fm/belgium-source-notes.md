## Belgium (Wallonia/Brussels) official FM source

- Official source family: CSA service archive and individual service pages.
- Archive root used for discovery: `https://www.csa.be/categorie-service/radio/`
- Official CSA province list with embedded service-page links: `https://www.csa.be/wp-content/uploads/2025/06/liste_radiosinde-provinces-2025.pdf`
- Example service page with analog FM rows: `https://www.csa.be/service/radio-contact/`

### Why this source works

The CSA archive pages list radio services in stable pagination. Individual service pages expose:

- `Nom du service`
- `Éditeur`
- `Autorité de régulation`
- `Secteur`
- `Catégorie`
- `Profil`
- `En mode analogique` rows in the form `SITE : FREQ MHz`

That is enough to build tuneable FM rows for Wallonia/Brussels from official pages.

### Operational instability observed from this environment

Observed on `2026-03-24` from this workspace:

- `https://www.csa.be/categorie-service/radio/` returned `HTTP 503` with `Retry-After: 3600`
- `https://www.csa.be/service/radio-contact/` also returned `HTTP 503`
- later the same day, both URLs returned `HTTP 200`

So the source is structurally usable, but live access is intermittently unstable from this environment.

### Importer policy

`scripts/catalog/sources/csa-be.mjs` is hardened to:

- crawl only the archive pagination instead of broad category recursion
- merge archive discovery with the official province PDF links so service URLs survive if the archive layout changes
- retry short-lived `429`/`5xx` failures
- time out slow requests
- skip individual broken service pages
- throw when CSA discovery or page fetches yield zero FM rows so the builder keeps the last cached Belgian shard instead of overwriting it with an empty result

This avoids poisoning the build with partial or misleading data during CSA outages.
