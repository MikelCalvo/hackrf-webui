# Albania FM Source Notes

## Decision

No importer was implemented for Albania.

There is no clean official public source, reproducible from this environment, that provides the minimum FM catalog fields together:

- tuneable FM frequency,
- site or city,
- station/service name,
- and operator or licensee.

## Official sources checked

### 1. AMA live audio-service register

URL:

- `https://ama.gov.al/oshma-ofrues-sherbimi-audio/`

What it is:

- official HTML table on the AMA website,
- public and reproducible without JS,
- page metadata shows `datePublished` `2024-08-02T11:25:21+00:00` and `dateModified` `2025-01-29T12:25:26+00:00`.

What it contains:

- 55 table rows as fetched on 2026-03-24,
- columns:
  - `Shoqeria`
  - `Oshma`
  - `Sherbimi`
  - `Licence`
  - `Zona e Mbulimit`

Why it is insufficient:

- it is a live license/service roster,
- but it does not expose FM frequency,
- it does not expose transmitter site,
- and it does not expose a per-frequency station assignment list.

Conclusion:

- useful as a broadcaster/licensee directory only,
- not enough for a tuneable FM importer.

### 2. AMA periodic bulletin PDF

URL:

- `https://ama.gov.al/wp-content/uploads/2018/12/AMA-BULETINI-PERIODIK-2.pdf`

Observed metadata:

- PDF, 146 pages,
- `CreationDate` `2018-01-11`,
- `ModDate` `2018-12-19`.

What it contains:

- historical bulletin content,
- sections such as:
  - `Treguesit teknikë të transmetimit të OSHMA-ve`
  - `Plani frekuencor numerik`
  - `Mbulimi me sinjal i OSHMA-ve sipas territorit dhe popullatës`

Why it is insufficient:

- it is not a live registry,
- it is clearly historical,
- and it is not a current per-station FM assignment source.

Conclusion:

- official but stale,
- not suitable as a current catalog source.

### 3. AKEP registers page and audiovisual-network register PDF

URLs:

- `https://akep.al/publikime/regjistrat/`
- `https://akep.al/wp-content/uploads/2026/03/REGJISTRI-I-SIPERMARRESVE-PER-TRANSMETIM-AUDIO-DHE-OSE-AUDIOVIZIVE-NE-DATEN-02.03.2026.pdf`

Observed metadata for the PDF:

- PDF, 61 pages,
- `CreationDate` `2026-03-02`.

What it contains:

- a current official AKEP register of entrepreneurs that notified audio and/or audiovisual transmission networks,
- fields visible in the PDF include operator identity, certificate number/date, network types, coverage area, declaration/start date, NIPT, legal representative, address, and contact data.

Why it is insufficient:

- it is a network-authorization register,
- not a broadcaster FM frequency register,
- and it does not provide tuneable FM frequency plus station/service mapping.

Conclusion:

- official and current,
- but wrong data model for FM catalog import.

### 4. AKEP frequency-plan page and annexes

URLs:

- `https://akep.al/publikime/plani-i-frekuencave/`
- `https://akep.al/wp-content/uploads/2025/01/PKF_2025-1.pdf`
- `https://akep.al/wp-content/uploads/2023/09/Plani-i-Perdorimit-te-Frekuencave-2023.pdf`
- `https://akep.al/wp-content/uploads/2025/05/ANEKSI-3-Lidhje-fikse-TV-Radio-30.04.2025.xlsx`

What they are:

- official national spectrum plan and usage-plan documents,
- plus annex spreadsheets.

Why they are insufficient:

- the page itself describes band planning and usage rules, not live station assignments,
- the checked Annex 3 workbook is about fixed links and channelization, not public FM broadcaster listings,
- workbook sheet names include:
  - `Brezi 2025-2110 MHz;2200-2290`
  - `Aneksi 3 Lidhje Fikse TV ,Radio`
  - `Radio ne 1350-1517 MHz`
  - `TV,Brezi 3800-4200 MHz`

Conclusion:

- official and reproducible,
- but these are planning/fixed-link documents, not a tuneable FM broadcast register.

### 5. AKEP Public Atlas

Viewer URLs:

- `https://atlas.akep.al/smartPortal/AKEP/`
- `https://atlas.akep.al/smartViewer/#/AKEP`

Official API endpoints discovered from the public viewer bundle:

- token endpoint:
  - `https://atlas.akep.al/smartRest/rest/publicToken`
- config endpoint:
  - `https://atlas.akep.al/smartRest/rest/configPortalViewer`

What works:

- `publicToken` is public and returns a bearer token plus public-role privileges,
- `configPortalViewer` with that bearer token returns `operationalMaps`.

What the official config exposes:

- `Radio` dynamic service:
  - `http://atlas1.ad.akep.al:6080/arcgis/rest/services/Radio/MapServer`
  - layers `[0,1,2,3,4]`
- `Mbulimi` dynamic service:
  - `http://atlas1.ad.akep.al:6080/arcgis/rest/services/Mbulimi/MapServer`
  - layers `[0,1,2,3,4,5]`

Why this is still blocked:

- the service URLs exposed by the official config point to `atlas1.ad.akep.al`, which is an internal host and is not resolvable from this environment,
- direct access to those URLs fails at DNS resolution,
- the public atlas proxy also does not yield a usable response from here.

Exact failing proxy pattern tested:

- `https://atlas.akep.al/smartRest/proxy?http://atlas1.ad.akep.al:6080/arcgis/rest/services/Radio/MapServer&f=pjson`

Observed result with valid bearer token:

- `{"success":false,"message":"Internal server error"}`

Conclusion:

- this is the closest official source to a real FM/coverage dataset,
- but it is not reproducibly queryable from this environment,
- so it is not yet safe to build an importer on top of it.

## Bottom line

The best live public source is the AMA HTML table, but it lacks frequency and site/transmitter data, so it cannot support a tuneable FM catalog.

The best technically promising source is the AKEP Public Atlas, because it clearly exposes official `Radio` and `Mbulimi` map services in its authenticated config. However, those services are disclosed only via internal `atlas1.ad.akep.al` URLs, and the official public proxy fails from this environment. That makes the source non-reproducible for an importer here.

If AKEP later exposes the `Radio` and `Mbulimi` ArcGIS services on a public resolvable URL, or fixes the public proxy so those services can be queried externally, Albania should be revisited.
