# Italy FM Source Notes

I checked the official MIMIT and AGCOM sources for a bulk FM station dataset that could be loaded into `hackrf-webui` with frequencies, city names, and region codes.

What I found:

- MIMIT has official radio pages and downloadable documents for local broadcasters, but the public list I found is a broadcaster registry, not a station-frequency dataset:
  - https://www.mimit.gov.it/it/comunicazioni/radio/contributi-emittenti-radiofoniche-locali
  - https://www.mimit.gov.it/images/stories/documenti/allegati/Elenco_fornitori_di_servizi_radiofonici_-_emittenti_locali_2.pdf
- The MIMIT map portal exposes some official datasets, but I did not find a radio/FM coverage layer or export that provides station frequencies:
  - https://mappe.mimit.gov.it/
- AGCOM’s FM page states that the national analog FM plan has not yet been adopted, which makes it unsuitable as a bulk station registry:
  - https://www.agcom.it/competenze/comunicazioni-elettroniche/reti/frequenze/frequenze-radio-e-TV/radiodiffusione-sonora/radiodiffusione-sonora-analogica-FM

Conclusion:

- I did not find a clean official bulk source that can be converted into normalized FM station rows without inventing or approximating frequency data.
- No Italy importer was created in this pass.
- Expected station count: not available from the official sources checked.

If a later official source appears with per-station frequency, city, and region fields, it can be added as a dedicated importer file under `scripts/catalog/sources/`.
