# San Marino FM Source Notes

## Source

Official San Marino RTV radio page:

- `https://www.sanmarinortv.sm/radio`

## Implementation Notes

- The source is a broadcaster station page, not a formal regulator transmitter register.
- The page contains a stable `CANALI RADIO` block with the two public FM services:
  - `Radio San Marino` on `FM 102.7`
  - `Radio San Marino Classic` on `FM 103.2`
- The same page also exposes the broadcaster address block:
  - `Viale J.F.Kennedy, 13 - 47890`
  - `San Marino Città`
  - `Repubblica di San Marino`
- The importer in `scripts/catalog/sources/sanmarino-sm.mjs` parses both HTML blocks directly and deduplicates by name plus frequency.

## City Heuristic

- `cityName` is taken from the official address block as `San Marino Città`.
- I checked that value against the repo's GeoNames matcher from this environment; it resolves to `San Marino`.

## Observed Shape

From the current March 24, 2026 pull from this environment:

- `2` FM stations returned

## Caveat

This importer file is implemented locally, but it is not wired into `scripts/catalog/build.mjs` in this change because that file was explicitly out of scope.
