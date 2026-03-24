# Finland FM Source Notes

## Source

Official Traficom broadcast station register:

- `https://eservices.traficom.fi/Licensesservices/Forms/BCLicenses.aspx?langid=en`

Workflow used by the importer in `scripts/catalog/sources/traficom-fi.mjs`:

1. `GET` the `BCLicenses.aspx?langid=en` form.
2. Extract ASP.NET hidden fields from the HTML.
3. `POST` back to the same URL with `ButtonDownload=Download as text file`.
4. Decode the returned `BCLuvat.txt` as `Windows-1252`.
5. Parse the TSV and keep only numeric FM rows in `87.5` to `108.0 MHz`.
6. Exclude short-term licences via `Start date of the short-term licence`.

## Notes

- The official TSV currently mixes FM, other radio bands, and internal/rebroadcast systems.
- The importer filters by numeric FM frequency instead of relying on a dedicated official FM flag.
- The download currently includes a header bug near the tail of the file:
  - `Language term not found: Licenses.FormattedFrequency`
- The coordinate fields are compact strings such as `24E3824` and `60N1039`; the importer converts them to decimal degrees.

## Observed Shape

From the current March 24, 2026 pull from this environment:

- `1125` total rows in the official download
- `1022` numeric FM rows in `87.5` to `108.0 MHz`
- `961` FM rows after excluding short-term licences

## Caveat

This importer file is implemented locally, but it is not wired into `scripts/catalog/build.mjs` in this change because that file was explicitly out of scope.
