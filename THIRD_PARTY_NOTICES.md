# Third-party notices

## ModelTrace

- Source: https://github.com/xqy2006/ModelTrace
- Pinned commit: `6cd4a8ff0f3f4e49d6d6969dd2fbadfa1569fde2`
- Copyright (c) 2026 xqy2006.
- License: MIT; the full original notice is in `third_party/modeltrace/LICENSE`.

`third_party/modeltrace/` contains the original scoring code and reference bank. `fingerprint-core.js` was renamed to `fingerprint-core.mjs` without changing its contents. `provenance.json` records original paths and SHA-256 hashes. The scheduler, standard Responses client, strict input validation and warning policy are implemented separately by this project.

## Sub2API integration

This independent project can connect to an unmodified Sub2API installation through its ordinary Responses endpoint. It does not include Sub2API source code, use its database, require its administrative API, or install a backend patch. Sub2API is a separate project: https://github.com/Wei-Shaw/sub2api.

Neither ModelTrace nor Sub2API endorses this monitor. Names identify compatible or credited projects, not affiliation.
