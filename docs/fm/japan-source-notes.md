# Japan FM coverage: official-source blocker

As of 2026-03-24, Japan's Ministry of Internal Affairs and Communications (MIC) / Radio Use
Portal does expose an official public `num` / `list` Web API for the radio-station search
system, but it is not currently practical to ship a reliable public FM importer in this repo.

## Official sources checked

- Web API overview page:
  - https://www.tele.soumu.go.jp/j/musen/webapi/index.htm
- Public search UI:
  - https://www.tele.soumu.go.jp/j/musen/SearchServlet?pageID=1
- Web API attachments linked from the overview page:
  - https://www.tele.soumu.go.jp/resource/j/musen/webapi/mw_req_info.pdf
  - https://www.tele.soumu.go.jp/resource/j/musen/webapi/mw_req_conditions.pdf
  - https://www.tele.soumu.go.jp/resource/j/musen/webapi/mw_code.pdf

## What works

- The official `num` / `list` endpoints do exist and return structured JSON at least some of the
  time.
- In local validation, `list?ST=1&DA=1&OF=2&OW=AT&DC=2&SC=1` returned 500 records and
  `num?MC=1&OF=2&OW=AT&ST=1` returned a total corpus count of 330343 records.

## Why this is blocked for a public FM importer

- The official request-condition and code-list PDFs linked from the API overview page returned
  HTTP 403 in automated access from this environment, so the documented filter and code mapping
  needed to request only FM broadcast licences could not be retrieved reliably.
- The public `SearchServlet` pages also returned the portal error page (`403`) to automated
  access from this environment.
- The Web API itself was inconsistent: some requests returned valid JSON, while subsequent
  requests to the same official endpoints returned the portal error page instead.
- Without the official condition/code tables, filtering down to FM would require reverse
  engineering undocumented parameters.
- Falling back to a full crawl of the whole active corpus is not a good public-repo solution:
  the official count is ~330k records, and the largest validated page size here was 500 rows,
  implying roughly 661 API requests before filtering.

## Practical conclusion

Do not add a Japan FM importer until one of these becomes stable and publicly accessible:

- the request-condition and code-value documents for the Web API, or
- a stable public search/API path that consistently serves automated requests without intermittent
  403 responses, or
- a real official bulk export for broadcasting stations.

Until then, any importer would either rely on undocumented parameters or hammer the entire radio
station corpus and still risk breaking on access controls.
