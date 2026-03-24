# South Africa FM Source Notes

## Blocker

I could not verify a current, reproducible official bulk dataset for South African FM stations that includes both the station/operator identity and the assigned FM frequency/service area in one machine-readable source.

Official sources I could confirm:

- ICASA list of broadcasting licensees:
  - `https://www.icasa.org.za/legislation-and-regulations/broadcasting-service-licences-2020`
  - `https://www.icasa.org.za/uploads/files/List-of-Broadcasting-Licensees-2020.pdf`
- ICASA compliance reports page with many station-specific PDFs:
  - `https://www.icasa.org.za/pages/compliance-reports`
- ICASA frequency-planning pages:
  - `https://www.icasa.org.za/legislation-and-regulations/national-radio-frequency-plan-2021`
  - `https://www.icasa.org.za/pages/radio-frequency-spectrum-assignment-plans`
- Recent official high-level counts of licensed sound broadcasters:
  - `https://www.icasa.org.za/news/2026/icasa-commemorates-world-radio-day`

## Why this is blocked

The official sources are fragmented:

1. The licence list gives licensee names and contact details, but not FM frequencies or a reliable station-by-station service-area mapping.
2. The compliance section contains many individual broadcaster PDFs, which may include technical details, but there is no clear bulk registry to ingest consistently.
3. The national frequency plans and assignment-plan documents govern spectrum allocation, but they are not a current operator-to-frequency dataset.

That means there is no clean official bulk path I can use to return normalized FM station rows without inventing a brittle join across unrelated PDFs and historical planning documents.

## Best next step

Use one of these approaches:

1. Obtain a current ICASA registry export that maps each sound broadcasting service to its FM frequency and licensed coverage area.
2. If ICASA publishes a structured spectrum-licence register separately from the service-licence list, use that as the technical source and join it only if the identifiers are explicit and stable.
3. If no bulk export exists, limit scope to a smaller official subset, such as individual commercial sound broadcasters with current licence-amendment PDFs that explicitly list frequencies.

## Recommendation

Do not add a South Africa FM importer yet. The official sources are real, but not clean enough as a reproducible national bulk feed for this codebase.

