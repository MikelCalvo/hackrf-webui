# Portugal FM Source Notes

## Blocker

I could not verify a clean, current, machine-readable national FM station dataset for Portugal that is both official and suitable for a robust importer.

Official sources I could confirm:

- ANACOM public portal for electronic communications services:
  - `https://digital.anacom.pt/pt-PT/Servicos/Comunica%C3%A7%C3%B5es-Electr%C3%B3nicas/`
- `dados.gov.pt` dataset for Lisbon radio and television actors:
  - `https://dados.gov.pt/pt/datasets/radio-e-televisao/`
- `dados.gov.pt` dataset for radios in Portugal websites / Arquivo.pt history:
  - `https://dados.gov.pt/pt/datasets/radios-em-portugal-websites-e-historico-de-versoes-no-arquivo-pt/`

## Why this is blocked

The sources above are either:

1. service/registry pages without a public national FM export,
2. partial city-level or media-ecosystem datasets,
3. or non-frequency datasets that list radio websites rather than FM transmitter/station rows.

That is not enough to ship a robust Portugal FM importer without relying on brittle scraping or on non-official sources.

## Best next step

Use one of these approaches:

1. Find a public ANACOM or government export that lists FM transmitters or concessions in bulk.
2. If the scope can be narrowed, build city/municipality-specific importers from official local datasets.
3. If a hidden ANACOM registry endpoint exists behind the portal, confirm a reproducible, public download path before coding the importer.

## Recommendation

Do not add a Portugal importer yet. The official sources are real, but not clean enough as a national bulk feed for this codebase.

