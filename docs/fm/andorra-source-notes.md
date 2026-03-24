# Andorra FM Source Notes

## Official URLs Checked

- `https://www.rtva.ad/pagina/avis-legal`
- `https://www.rtva.ad/en-directe/rna`
- `https://www.rtva.ad/en-directe/am`
- `https://www.rtva.ad/ca/noticies/cultura/promoure-cultura-francesa-perque-no-es-perdi`

## Source Assessment

- `rtva.ad` is the official public broadcaster site.
- The legal page states RTVA operates the two radio services `Ràdio Nacional d'Andorra (RNA)` and `Andorra Música`.
- The live channel pages are reproducible and expose station metadata and streaming pages for both services.

## Blocker

- RTVA does not expose a clean current FM transmitter or frequency register on the public site.
- The live pages for `RNA` and `Andorra Música` expose channel metadata and streams, but no FM frequency fields.
- An older official article incidentally mentions `Ràdio Nacional d'Andorra (94.2 FM)`, but this is not a structured station list and I did not find an equivalent current official FM frequency disclosure for `Andorra Música`.
- That leaves no reproducible official workflow for a full Andorran FM importer from this environment without mixing current live pages with incidental editorial mentions.

## Conclusion

No importer was implemented for Andorra in this change. The official blocker is the absence of a current public RTVA frequency register for both FM services.
