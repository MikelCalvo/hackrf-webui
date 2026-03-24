# Romania FM Source Notes

## Source choice

The Romania importer uses the official CNA index page and discovers the current radio PDF URL from that page at runtime:

- `https://cna.ro/a-situatii-privind-licentele-audiovizuale-avizele-de-furnizare-a-serviciilor-media-audiovizuale-la-cerere-avizele-de-retransmisie-si-autorizatiile-de-re-fl7wut28fqxu5c0y94sohaf7/`

It then parses:

- the main radio licence PDF as the primary source,
- and the SRR frequencies PDF only as a supplement for public-radio rows where the main licence PDF omits the FM value.

## Why the parser is cautious

The main CNA radio PDF is a text-extractable export, but it is not a clean transmitter register:

- it mixes FM, internet and satellite rows,
- some MW/AM rows appear as decimal values below `3 MHz`,
- some SRR rows are listed without an FM value in the main table,
- and the PDF text uses placeholder ASCII characters for Romanian diacritics.

Because of that, the importer:

1. keeps only numeric FM rows between `87.0` and `108.5 MHz`,
2. excludes `SATELIT`, `INTERNET`, and sub-`3 MHz` rows,
3. supplements only blank-frequency SRR rows from the separate SRR PDF,
4. and dedupes on `city + station name + frequency` to stay aligned with the catalog builder.

## Known limitations

- CNA is publishing regulatory snapshots, not a live national transmitter registry.
- Some locality labels are coverage-area labels rather than clean municipality names, so final city matching still depends on the catalog geonames step.
- The SRR supplement is intentionally narrow: it fills blank public-radio FM rows instead of importing the full SRR transmitter list independently.
