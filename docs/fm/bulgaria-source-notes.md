# Bulgaria FM Source Notes

## Blocker

The best official public source I could verify is the CEM terrestrial broadcasting registry:

- `https://www.cem.bg/linear_reg.php?lang=en&cat=2&filter=1&fType=2&fRange=0&fSpread=0&filterName=&fCity=`

It is reachable from this environment and it does expose official radio licence records, but it does not expose the assigned FM frequency or transmitter-site frequency table needed for normalized `hackrf-webui` FM rows.

## Why This Is Blocked

- The official CEM registry gives station identity, licence metadata, coverage type, and decisions.
- It does not provide per-row `MHz` values.
- The related CEM decisions page is official, but frequency details are fragmented across individual acts rather than a reproducible national bulk feed:
  - `https://www.cem.bg/actsbg/12`

## Recommendation

Do not add a Bulgaria FM importer yet. The current official blocker is the lack of frequency data in a stable public bulk source.
