# Liechtenstein FM Source Notes

## Official URLs Checked

- `https://www.radio.li/kontakt`
- `https://www.llv.li/serviceportal2/amtsstellen/amt-fuer-kommunikation/import/pdf-llv-ak-frequenzzuweisungsplan.pdf`
- `https://www.llv.li/de/medienmitteilungen/bericht-betreffend-die-weiterfuehrung-von-radio-liechtenstein-unter-privater-traegerschaft`

## Source Assessment

- `radio.li` is the official broadcaster site and the contact page is reachable from this environment.
- That page confirms the broadcaster identity and contact details for `Liechtensteinischer Rundfunk`, but it does not publish a current UKW/FM frequency list.
- The regulator-side `llv.li` PDF and press URLs are official, but direct HTTP access from this shell currently returns `403` with a Cloudflare challenge.

## Blocker

- The accessible official broadcaster page is not a transmitter or frequency register.
- The official regulator path that appears most relevant is a frequency allocation plan, not a clean current FM station register.
- From this environment, the regulator URLs are not reproducibly fetchable via normal HTTP tooling because of the Cloudflare challenge, so they are not suitable for an importer workflow here.

## Conclusion

No importer was implemented for Liechtenstein in this change. The best official blocker is the combination of no FM list on the broadcaster site and no reliably fetchable current regulator register from this environment.
