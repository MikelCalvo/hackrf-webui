# Vatican City FM Source Notes

As of 2026-03-24, I did not implement a standalone Vatican City FM importer.

## Official source checked

- Vatican News / Radio Vaticana:
  - https://www.vaticannews.va/it/rvi.html

## What the official page provides

The official Radio Vaticana page currently lists:

- `103.8 FM` for the city of Rome
- `105 FM` for Rome and province

It also lists DAB+, streaming, and shortwave options.

## Why this is not a clean country-level importer

For this repository, the bar is a tuneable catalog source that can be modeled as
`station/licensee + frequency + locality/site`, ideally in a reproducible
official feed.

The Vatican official page does not provide:

- a public technical register for Vatican City FM assignments
- a station-by-station list scoped to Vatican City as a radio territory
- a transmitter/site register with locality, coordinates, or licensing metadata

Instead, it exposes Rome-area carriage for Vatican Radio. That is useful for
human listening, but not a clean sovereign-country FM registry for this catalog.

## Practical conclusion

- Do not add a separate Vatican City FM importer unless an official technical
  registry or stable public assignment list appears.
- If Vatican Radio frequencies are ever included in the catalog, they should be
  treated explicitly as Rome-area distribution from the official Vatican source,
  not as proof of a distinct Vatican City FM network register.
