# Belarus FM source investigation

Status: blocked for a national FM importer from this environment.

## Official sources checked

- Ministry of Communications and Informatization main site:
  `https://mpt.gov.by/`
- State Commission on Radio Frequencies page:
  `https://mpt.gov.by/ru/gosudarstvennaya-komissiya-po-radiochastotam-pri-sovete-bezopasnosti-respubliki-belarus`
- Radio spectrum regulation page:
  `https://mpt.gov.by/ru/perechen-npa-reguliruyushchih-deyatelnost/radiochastotnyy-spektr`
- Example official tender notices that mention FM assignments:
  `https://mpt.gov.by/ru/news/16-07-2021-7291`
  `https://mpt.gov.by/ru/news/18-08-2021-7308`
- BelGIE official site:
  `https://www.belgie.by/`
- Ministry of Information site:
  `https://mininform.gov.by/`

## What is available

- `mpt.gov.by` is reachable and reproducible from this environment.
- The radio-frequency commission page is a legal/forms hub. It links to decrees, application forms, instructions, and commission decisions, but not to a nationwide machine-readable register of active FM broadcasters.
- The radio-spectrum page is also only a legal framework page. It lists laws, decrees, and spectrum allocation rules, but no station-level dataset.
- The 2021 tender notices are point-in-time competition announcements for single FM assignments, for example `98.6 MHz` at the `Rakitnitsa` transmission site. They are not a registry of currently active stations.

## Why this cannot support a tuneable FM catalog

The reachable official sources do not provide a reproducible nationwide dataset that combines:

1. station or program name,
2. licensee,
3. FM frequency,
4. transmission site or city.

`mpt.gov.by` exposes regulation and tender material, not an active broadcaster register.

## Environment blockers

- `https://www.belgie.by/` timed out repeatedly from this environment, so I could not verify whether BelGIE exposes a reusable transmitter register.
- `https://mininform.gov.by/` failed to connect from this environment, so I could not verify whether the media regulator exposes a broadcaster register there.

## Conclusion

No Belarus importer was implemented. From the official sources reachable here, there is no clean national FM registry suitable for `hackrf-webui`.
