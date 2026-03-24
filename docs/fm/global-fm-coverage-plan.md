# Global FM Coverage Plan

## Objective

Build a **considerable and maintainable global FM catalog** for `hackrf-webui` without sacrificing runtime performance or source quality.

This plan is intentionally **city-first**, not country-count-first. The target is to cover the **main metropolitan areas of the world** before trying to claim complete national coverage everywhere.

## Current Baseline

As of the current local catalog build:

- `42` countries and territories
- `18,094` cities
- `67,013` FM stations
- runtime catalog split into:
  - `src/data/catalog/manifest.json`
  - `public/catalog/manifest.json`
  - `public/catalog/countries/*.json`

Current structured coverage is strongest in:

- United States
- France
- Turkey
- Canada
- Peru
- Germany
- Colombia
- Chile
- Brazil
- Mexico
- Australia
- Austria
- Czech Republic
- India
- Ecuador
- Bolivia
- Belgium
- Switzerland
- Poland
- Taiwan

Most recent landed additions:

- Lithuania
- Slovenia
- Netherlands
- Slovakia
- Vietnam
- Hungary
- Ireland
- Croatia

Current seed/manual coverage exists for:

- Spain
- United Kingdom
- Japan
- South Korea
- Puerto Rico
- U.S. Virgin Islands
- American Samoa
- Guam
- Northern Mariana Islands

## Definition Of Success

We should not define success as "every FM station in every country". That becomes legally messy, operationally expensive, and hard to verify.

Instead, define success in layers:

### Coverage Tier A

Covered if all of the following are true:

- national capital is covered
- top `3` to `10` metro areas are covered
- at least `70%` of the known major commercial/public FM stations in those metros are present

### Coverage Tier B

Covered if:

- at least one major city in the country is covered
- data quality is acceptable
- source provenance is tracked

### Coverage Tier C

Covered if:

- only partial manual/community data exists
- UI can surface it, but the country is visibly incomplete

## Source Quality Policy

Use this order of preference:

1. Official regulator or government open data
2. Official regulator PDF/XLS/CSV reports that can be parsed reproducibly
3. Official broadcaster or network frequency pages
4. Manual seed entries with source URL and verification date

Do not use bulk imports from community/directories as the primary source for a public catalog if redistribution terms are unclear.

## Confirmed Source Leads

These are the next high-value official or regulator-backed leads already worth evaluating for importer work:

- United Kingdom: Ofcom analogue radio technical parameters with VHF data
- Germany: Bundesnetzagentur broadcast transmitter data with regular UKW updates
- Mexico: IFT public concessions and radio downloads
- Brazil: ANATEL basic broadcasting plan publications
- India: Ministry of Information and Broadcasting lists for operational private FM, Akashvani FM, and community radio

These do not all guarantee the same parser complexity, but they are the right starting points for public, reproducible ingestion.

Reference pages:

- Ofcom radio transmitter parameters: `https://www.ofcom.org.uk/cy/tv-radio-and-on-demand/coverage-and-transmitters/radio-tech-parameters`
- Bundesnetzagentur broadcasting: `https://www.bundesnetzagentur.de/EN/Areas/Telecommunications/FrequencyManagement/Broadcasting/start.html`
- IFT public concession registry: `https://rpc.ift.org.mx/`
- IFT broadcast coverage report: `https://www.ift.org.mx/espectro-radioelectrico/estudio-de-cobertura-de-los-servicios-de-radiodifusion-en-mexico-2023`
- ANATEL broadcast channel plans: `https://www.gov.br/anatel/pt-br/regulado/radiodifusao/planos-basicos-de-distribuicao-de-canais`
- Prasar Bharati Akashvani: `https://prasarbharati.gov.in/akashvani/`

## Global Rollout Strategy

## Phase 0: Foundations

Status: done

- shard runtime catalog by country
- keep initial client payload small
- load only the active country in the UI
- virtualize the station list
- preserve offline runtime

## Phase 1: Structured High-Impact Countries

Goal: cover the largest radio markets and biggest metro clusters where structured official data is available or likely available with moderate parser effort.

Status: in progress

Already landed with reproducible importers:

- Austria
- Belgium (Flemish regional official data)
- Switzerland
- Germany
- Mexico
- Brazil
- France
- Colombia
- Chile
- Czech Republic
- Ecuador
- Peru
- Bolivia
- India
- Poland
- regional Spain
- Taiwan
- Singapore
- Malaysia
- regional Philippines (Region VII)
- Turkey
- Uruguay
- Paraguay

Current blocker notes exist for:

- United Kingdom
- Italy
- Argentina
- New Zealand
- Japan
- South Africa

High-confidence validated next targets from the latest research waves:

- Croatia is now landed via the official HAKOM FM concession table
- South Korea only as a degraded TBN-only fallback, not as a national FM importer
- Indonesia blocked by an unreachable official machine-readable source from this environment
- Philippines national feed blocked by Cloudflare, but Region VII is now landed through the official WordPress JSON endpoint
- Thailand blocked by Cloudflare on the official NBTC catalog/API path from this environment
- Spain still blocked as a clean national importer, despite regional official data now being landed

Priority countries:

- United Kingdom
- Germany
- Mexico
- Brazil
- Spain
- France
- Italy
- Japan
- South Korea
- Argentina

Expected outcome:

- strong Europe coverage in major capitals and large metros
- strong Latin America presence in the main population centers
- East Asia presence beyond the current seed-only state

Definition of done for this phase:

- at least `10` additional countries with reproducible importers or well-scoped manual pipelines
- all capitals plus the largest metros covered for those countries

## Phase 2: Asia-Pacific And Regional Hubs

Goal: cover the largest urban clusters where data may be mixed quality but still worth integrating carefully.

Priority countries:

- India
- Indonesia
- Philippines
- Thailand
- Vietnam
- Malaysia
- Singapore
- Taiwan
- Turkey
- New Zealand

Expected outcome:

- most of the largest population centers in Asia-Pacific represented
- strong city-level usefulness even where national completeness is not yet possible

Definition of done for this phase:

- all metros above roughly `5M` population in these countries have baseline FM coverage
- capital cities and economic hubs are no longer empty

## Phase 3: Middle East, Africa, And Secondary Europe

Goal: fill the biggest remaining global blind spots.

Priority countries:

- Saudi Arabia
- United Arab Emirates
- Israel
- Egypt
- Morocco
- South Africa
- Nigeria
- Kenya
- Poland
- Netherlands
- Belgium
- Portugal
- Greece
- Czechia
- Romania

Expected outcome:

- meaningful coverage across EMEA, especially capitals and regional business/tourism hubs

## Phase 4: Long Tail And Community Expansion

Goal: let contributors expand coverage safely once the core ingestion model is stable.

Additions:

- importer templates for small countries
- country-level completeness markers in the manifest
- PR-friendly manual seed workflow for missing cities
- validation tooling for duplicate frequencies, bad coordinates, and orphan cities

## City-First Coverage Rules

When a country is added, do not start by trying to ingest every tiny relay.

Add cities in this order:

1. Capital city
2. Metro areas above `10M`
3. Metro areas above `5M`
4. Major regional capitals
5. Tourism, transport, or industrial hubs
6. Long-tail local cities

This gives the best user value per hour of work.

## Country Intake Checklist

Every new country should follow the same path:

1. Identify the best source class
2. Confirm redistribution and repository safety
3. Map country names/codes into `GeoNames`
4. Normalize city names and admin regions
5. Deduplicate frequencies and station identities
6. Generate a country shard
7. Verify top cities manually
8. Mark the country with a completeness level

## Engineering Backlog For Scaling Coverage

Before adding many more countries, the next catalog tasks should be:

- add `coverageTier` and `sourceQuality` fields at country level in the manifest
- add a per-country metadata file with:
  - source name
  - source URL
  - last imported date
  - importer type
  - completeness estimate
- add validation commands for:
  - duplicate station IDs
  - duplicate station name/frequency collisions in the same city
  - invalid coordinates
  - cities with zero stations
- split very large countries further later if needed
  - `US` by state or region
  - `CA` by province
  - `BR` by state
  - `IN` by state

## Practical Milestones

## Milestone 1

Reach a strong "western core":

- US
- CA
- AU
- UK
- DE
- ES
- FR
- IT
- MX
- BR

This alone gives a large share of globally recognizable cities.

## Milestone 2

Reach a strong "global capitals and megacities" set:

- Tokyo
- Seoul
- Mexico City
- Sao Paulo
- Rio de Janeiro
- Buenos Aires
- Bogota
- Santiago
- London
- Paris
- Madrid
- Barcelona
- Berlin
- Rome
- Milan
- Delhi
- Mumbai
- Jakarta
- Manila
- Bangkok
- Istanbul
- Cairo
- Johannesburg
- Lagos

If these are well-covered, the catalog already feels global to most users.

## Milestone 3

Reach regional depth:

- top `3` to `10` metros per covered country
- capital plus secondary hubs
- enough density that filtering by country and city feels useful, not sparse

## Recommended Work Order

This is the order that best balances user value and implementation cost:

1. UK, Germany, Mexico
2. Brazil, France, Italy
3. Japan, South Korea
4. Argentina, Colombia, Chile
5. India, Indonesia, Philippines, Thailand
6. South Africa, Nigeria, Egypt, Morocco
7. Netherlands, Belgium, Portugal, Poland, Turkey

## Guardrails

- prefer reproducible imports over heroic one-off scrapes
- avoid claiming completeness where we only have capital-city data
- track provenance for every station batch
- keep the runtime fast even if the raw import side grows massively
- do not let one country importer block progress for the rest of the world

## Final Target

A realistic "considerable global coverage" target is:

- all major capitals
- all metros above `5M`
- strong coverage in the top radio markets
- country shards that remain small enough for the local UI to stay fast

That is the right target before chasing full national completeness in every region.
