# Argentina FM Source Notes

## Blocker

There is an official Argentina.gob.ar page for the ENACOM "Listado de Servicios de Comunicación Audiovisual":

- `https://www.argentina.gob.ar/dine/listado-de-servicios-de-comunicacion-audiovisual`

The page is official and clearly references the definitive broadcast service list by province, but it is not exposed here as a clean machine-readable CSV/JSON export. From this environment I could verify the official page and related legal references, but I could not validate a reproducible end-to-end importer quickly enough to justify shipping one.

Relevant official references:

- `https://www.argentina.gob.ar/dine/listado-de-servicios-de-comunicacion-audiovisual`
- `https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-2-2023-388971/texto`
- `https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-19-2023-385353/texto`
- `https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-935-2025-414514/texto`

## What I Could Confirm

- ENACOM publishes the service list at the official Argentina.gob.ar domain.
- The public page is organized by province, not as a single obvious structured dataset.
- The surrounding legal text confirms the list includes district, service name, type, frequency, and related identifying information.

## Why I Stopped Here

A robust importer would need one of these:

1. A stable machine-readable export from ENACOM.
2. A maintained map of province document URLs, with PDF parsing and dedupe logic.
3. A confirmed official endpoint that can be crawled deterministically without relying on brittle page structure.

I do not have that yet, and I do not want to ship a fragile parser that depends on incidental HTML or search-engine-cached URLs.

## Best Next Step

Build the importer in two stages:

1. Extract and freeze the province document URLs from the official ENACOM page.
2. Parse the PDF rows into the shared FM station shape, then dedupe by frequency + call sign + locality.

If ENACOM later exposes a CSV/XLSX export, switch to that immediately and keep the parser layer unchanged.

