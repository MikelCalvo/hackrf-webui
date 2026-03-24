# Europe FM Coverage Status

Snapshot date: `2026-03-24`

## Summary

- European countries/territories with FM entries currently in the catalog: `33`
- Of those, countries with a serious official or public-sector importer path in this repo: `32`
- European country with only partial/manual seed data and no clean official importer yet: `1`
  - `GB`
- European countries currently blocked and documented with official-source notes: `12`

## Covered in Catalog

- `AT` Austria
- `BE` Belgium
- `CH` Switzerland
- `CY` Cyprus
- `CZ` Czech Republic
- `DE` Germany
- `DK` Denmark
- `EE` Estonia
- `ES` Spain
- `FI` Finland
- `FR` France
- `GR` Greece
- `HR` Croatia
- `HU` Hungary
- `IE` Ireland
- `IT` Italy
- `LT` Lithuania
- `LU` Luxembourg
- `LV` Latvia
- `MD` Moldova
- `ME` Montenegro
- `MK` North Macedonia
- `MT` Malta
- `NL` Netherlands
- `PL` Poland
- `PT` Portugal
- `RO` Romania
- `RS` Serbia
- `SI` Slovenia
- `SK` Slovakia
- `SM` San Marino
- `UA` Ukraine

## Partial / Manual Only

- `GB` United Kingdom
  - The catalog still contains a small manual seed only.
  - A clean official importer remains blocked by Ofcom downloads returning Cloudflare challenges from this environment.
  - See [uk-source-notes.md](./uk-source-notes.md).

## Blocked / Not Added

- `AL` Albania
  - [albania-source-notes.md](./albania-source-notes.md)
- `AD` Andorra
  - [andorra-source-notes.md](./andorra-source-notes.md)
- `BA` Bosnia and Herzegovina
  - [bosnia-herzegovina-source-notes.md](./bosnia-herzegovina-source-notes.md)
- `BG` Bulgaria
  - [bulgaria-source-notes.md](./bulgaria-source-notes.md)
- `BY` Belarus
  - [belarus-source-notes.md](./belarus-source-notes.md)
- `IS` Iceland
  - [iceland-source-notes.md](./iceland-source-notes.md)
- `LI` Liechtenstein
  - [liechtenstein-source-notes.md](./liechtenstein-source-notes.md)
- `MC` Monaco
  - [monaco-source-notes.md](./monaco-source-notes.md)
- `NO` Norway
  - [norway-source-notes.md](./norway-source-notes.md)
- `SE` Sweden
  - [sweden-source-notes.md](./sweden-source-notes.md)
- `VA` Vatican City
  - [vatican-source-notes.md](./vatican-source-notes.md)
- `XK` Kosovo
  - [kosovo-source-notes.md](./kosovo-source-notes.md)

## Notes

- `BE` is currently a hybrid result:
  - Flanders is covered by the existing regional importer.
  - Wallonia/Brussels has a hardened official importer path in `csa-be.mjs` that now merges the archive crawl with the official CSA province PDF link list, and still falls back cleanly when `csa.be` is unstable.
- `ES` remains partial at the national level.
  - The regional importer aggregates official sources for Andalusia, Extremadura, Castilla y León, and the Catalonia public network.
- `PT` is based on the last public bulk ERC export rather than a current ANACOM technical registry.
  - See [portugal-source-notes.md](./portugal-source-notes.md).
