# Configuration and operations

Configuration is loaded once at startup. Restart after editing it. Keep real configs and state outside the checkout; keep credentials in environment variables or your existing secret manager.

| Field | Meaning |
| --- | --- |
| `enabled` | Explicit boolean; false refuses `--once` and `--run` |
| `interval_seconds` | Fixed cycle interval, 300–604800 seconds |
| `confirmation_delay_seconds` | Wait before confirmation, 10–3600 seconds |
| `max_probe_requests_per_cycle` | 6–600 requests; at least six per configured target |
| `minimum_probability` | Alternate candidate threshold, 0.9–1; default 0.95 |
| `maximum_expected_probability` | Maximum score for requested model, 0–0.1; default 0.05 |
| `state_dir` | Absolute directory or relative to the config file |
| `targets` | Up to 100 explicitly configured targets |

Each target has:

| Field | Meaning |
| --- | --- |
| `id` | Unique local label, letters/digits/underscore/hyphen; not an account-routing selector |
| `base_url` | API base URL; `/responses` is appended. Include `/v1` if your gateway requires it |
| `api_key_env` | Environment variable containing an ordinary API key |
| `model` | Requested model ID; must exactly match an entry in the reference bank to be probed |
| `effort` | Empty string or `low`, `medium`, `high`, `xhigh`; must be supported by the endpoint/model |

HTTPS is required except for loopback HTTP. URLs containing credentials, queries or fragments are rejected. Unknown configuration fields are rejected, including former fork-specific admin or auto-pause settings. Reference IDs can be listed offline:

```sh
node --input-type=module -e 'import {loadReference} from "./src/scorer.mjs"; console.log((await loadReference()).bank.models.map(m => m.id).join("\n"));'
```

## Runtime behavior

Each probe has a 120-second timeout and a bounded response body. Redirects are rejected. There are no automatic network retries. Targets run sequentially and share the per-cycle request budget. A standard API request is generally billed by the gateway just like other inference requests; this project does not control billing or model-selection policy.

The sampler uses isolated fresh prompts. It requests no tools and rejects tool outputs, refusals, incomplete responses and malformed number arrays. The input filter rejects obvious sorted or short-period sequences; it is not a test of statistical randomness. Scoring uses the pinned ModelTrace implementation without modifying it.

Local scoring thresholds are policy choices, not independently calibrated false-positive guarantees. Setting an effort that differs from actual business use may produce different behavior. No automatic reference-bank downloads occur.

## Logs and state

`history.json` retains the last 200 records, with atomic file replacement and fsync. File permissions are 0600 on supported systems. Warning records include `target_id`, requested/candidate models, two rounds of scores and a human-readable message. Sanitized HTTP status/error codes help diagnose incomplete probes without persisting upstream error bodies or URLs.

Warnings are emitted every cycle that independently meets the confirmation rule. A later `consistent` result is logged separately; there is no persistent account-state change to undo. No notifications are sent to external services.

`monitor.lock` prevents another process using the same state directory. Use only one instance for the same target set; different directories or hosts do not share a lock. After a crash, verify the recorded PID is no longer running before deleting a stale lock. SIGINT/SIGTERM cancels in-flight work and releases the lock. A corrupt history file stops startup rather than being overwritten.

## Docker

The image runs as UID 1000. Mount your configuration read-only and provide a writable `/data` directory with `state_dir: "/data"`. Pass each configured key using your orchestrator's secret/environment mechanism. For a local image and externally prepared config/state:

```sh
docker run --rm \
  --env MODELTRACE_EXAMPLE_KEY \
  --mount type=bind,src=/absolute/runtime/config.json,dst=/config.json,readonly \
  --mount type=bind,src=/absolute/runtime/state,dst=/data \
  modeltrace-monitor:local --run /config.json
```

The named environment variable must already be present in the invoking environment. The API address must be reachable from inside the container. No host-wide networking or gateway modifications are required by this project.

## Upgrade and stop

Stop the process or set `enabled: false` and restart. Accounts remain unchanged. Upgrade the monitor by reviewing source changes and running `npm test` plus `npm run check`. Update fingerprint data only with reviewed provenance, license, checksums and validation. API compatibility tests cannot establish live fingerprint accuracy.

For Sub2API, review the effective routing of each dedicated group after account or routing changes. There is no admin-side state read or configuration-revision check in this independent client.
