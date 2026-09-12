# Automatic Rainfall Refresh — Architecture

## What changed

Before this change, getting a new hour of rainfall into FLOODWATCH required a human to run two scripts by hand with explicit date ranges (`download_gsmap.py --start ... --end ...`, then `process_rainfall.py`) and then manually copy the resulting CSV into `frontend/public/data/rainfall/`. There was no detection of what was already available, no update to the copy the frontend actually serves without that manual copy step, and no way for the UI to know whether the data it was showing was fresh or how it had been produced.

This change adds one orchestrator script, `data/raw/rainfall/scripts/refresh_rainfall.py`, that performs the entire detect → download → process → publish → report cycle on its own, plus a small frontend polling layer that surfaces the result and reloads the dataset in the browser when it changes. **No manual file upload or copy step remains** in the normal operating path — the only manual input is deciding how often the orchestrator runs (a scheduler, covered below).

## Pipeline

```
JAXA GSMaP FTP (ftp.ptree.jaxa.jp)
        │  1. DETECT — list today's (and a bounded lookback of) remote day
        │     directories, find the newest .dat.gz timestamp available
        ▼
data/raw/rainfall/gsmap/*.dat.gz
        │  2. DOWNLOAD — fetch only files newer than what's already local
        │     (skip-if-exists, same rule the original manual script used)
        ▼
data/raw/rainfall/scripts/process_rainfall.py::process_files()
        │  3. PROCESS — re-run over ALL local raw files (not just the new
        │     ones), so the 1h/3h/6h/24h rolling accumulations stay correct
        ▼
data/processed/rainfall/hourly/mumbai_processed_rainfall.csv
        │  4. PUBLISH — copy CSV + zone metadata into the one place the
        │     frontend actually fetches from
        ▼
frontend/public/data/rainfall/mumbai_processed_rainfall.csv
frontend/public/data/rainfall/rainfall_refresh_status.json   ← 5. REPORT
        │
        ▼
Browser: useRainfallRefreshStatus() polls the status file every 5 minutes
        │
        ├─ feed advanced to a newer hour → rainfallService.refresh()
        │  (bypasses the in-memory CSV cache) → useSimulationStore's
        │  availableTimestamps is extended → every hook that derives risk
        │  from rainfall (useRainfallAwareRisk, useFloodData, the routing
        │  engine) re-runs automatically on next render, because none of
        │  them cache rainfall→risk output — risk is always computed live
        │  from whatever the store currently holds. This is why there is
        │  no separate "refresh the risk model" step: the model was never
        │  a thing that gets stale on its own, only its rainfall input was.
        │
        └─ feed degraded → reports into the existing useDataHealthStore
           (the same mechanism the resilience audit built for any other
           data-layer failure) → the existing red top banner + System
           Status dropdown both surface it, and the last valid CSV is left
           completely untouched on disk.
```

## Why the frontend never needs an explicit "refresh the risk model" step

Flood/road/infrastructure risk in this app has never been a pre-computed, cached artifact — `flood_susceptibility_metadata.json` deliberately keeps rainfall out of the static susceptibility layer, and every risk number (`computeRainfallAdjustedRisk`, `useRainfallAwareRisk`, the routing engine's edge costs) is a pure function of *(static susceptibility, current rainfall)* evaluated at render time. Once new rainfall data is in `useSimulationStore`, React's normal re-render cycle recomputes every risk figure, map layer color, and route cost against it — there is no separate cache to invalidate. This was true before this change and is the reason step 5 in the pipeline above is "extend the timestamp list," not "recompute and store a risk value."

## Detection logic

`find_remote_newest()` walks backward from today (UTC) through up to `--lookback-days` (default 5) day directories on the FTP server, `cwd`-ing into each and listing `.dat.gz` files. A directory that doesn't exist yet (e.g. today, checked very early UTC before JAXA has published anything) is treated as "not yet populated," not an error. The newest timestamp found across all populated directories checked is compared against the newest timestamp already present in `data/raw/rainfall/gsmap/` locally; only files strictly newer than the local maximum are downloaded.

## Failure handling — "do not crash, keep last valid dataset"

Every external-dependency step (credentials present, FTP reachable, login accepted, directory listing succeeds, processing succeeds, publish succeeds) is wrapped so a failure at any point:

1. Is caught inside `run_once()` — never raises out of the script.
2. Leaves `data/processed/rainfall/hourly/mumbai_processed_rainfall.csv` and its published copy in `frontend/public/data/rainfall/` **completely unmodified** — the publish step only runs after processing succeeds, and processing only runs after download succeeds.
3. Still writes `rainfall_refresh_status.json` with `"status": "warning"` and a specific, human-readable `message` (missing credentials, FTP unreachable, empty feed for the whole lookback window, or a processing/publish exception) plus the **age of the dataset that's still being served**, computed from the last successfully processed CSV — so the frontend can say "this is now 4.3 days old" rather than going silent.
4. A dataset that is technically freshly re-processed but whose newest hour is already more than `STALE_DATA_AGE_HOURS` (6h, configurable in the script) old is *also* reported as `"warning"` — a technically-successful run against a feed that is itself lagging upstream is still something an operator should be told about.

The process's **exit code** (0 = healthy, 1 = warning) is the one place this is allowed to be loud — that's for whatever launches the script (Task Scheduler / cron) to alert on, which is a different concern from the running web application ever crashing. The frontend never sees an exit code; it only ever sees the status JSON, and a missing/unreadable status JSON (e.g. automation not deployed at all) is treated as "unknown," not as an error worth alarming a user about.

## Scheduling — this script does not run itself

There is no backend process in this project (a standing gap already disclosed in `RESILIENCE_REPORT.md`), so "automatic" here means *the script requires no manual steps when it runs*, not that a server is always running it. Two supported ways to trigger it periodically:

**Windows Task Scheduler** (matches this project's dev environment):
```
schtasks /create /tn "FloodwatchRainfallRefresh" /tr "python D:\SIH26085\data\raw\rainfall\scripts\refresh_rainfall.py" /sc minute /mo 30
```

**cron** (Linux/Mac deployment target):
```
*/30 * * * * JAXA_FTP_USER=... JAXA_FTP_PASSWORD=... python3 /path/to/data/raw/rainfall/scripts/refresh_rainfall.py
```

**Convenience loop mode**, for a demo box or any environment without OS-level scheduling available:
```
python refresh_rainfall.py --loop --interval-minutes 30
```
Every cycle inside the loop is wrapped in its own `try/except` so one bad cycle (a transient FTP hiccup) logs and continues rather than killing the whole loop.

GSMaP's hourly product doesn't benefit from checking much faster than every 15–30 minutes; the frontend's own poll interval (5 minutes) is independently tunable and just needs to be at least as fast as an operator would want to notice a change, not tied to the backend schedule.

## What is deliberately unchanged

- `download_gsmap.py` and `process_rainfall.py` are untouched and still work standalone — they remain the right tools for a manual historical backfill (e.g. "get me the last 30 days for a report"), which is a different job from "keep today's data current." `refresh_rainfall.py` imports `process_files()` from `process_rainfall.py` rather than duplicating it.
- `gsmap_reader.py`'s binary-format parsing is untouched.
- The static GIS pipeline (`data/scripts/prepare_frontend_data.py`, DEM/roads/buildings/susceptibility) is a separate, one-time build step for data that doesn't change hour-to-hour; it is not part of this refresh cycle and was never the "manually uploaded" data this task targeted.

## Verification performed

- `refresh_rainfall.py --dry-run` run with no credentials set: correctly refused to guess, left the existing processed/published CSV untouched, and wrote a `"warning"` status with an accurate `data_age_hours` computed from the real last-known dataset (confirmed live: 103+ hours, matching the real Sept 6 dataset's age at test time).
- Frontend build (`npx tsc -b --noEmit`, `npm run build`) both pass with the new services/hook/store.
- Live Playwright verification against the running dev server, both states:
  - **Warning state** (real current condition — no JAXA credentials configured in this environment): top red banner reads *"1 data layer failed to load"*, System Status dropdown's new "RAINFALL FEED (auto-refresh)" section shows `WARNING` plus all four required fields (Last Updated, Source, Timestamp, Data Age) and the specific reason text, zero console errors.
  - **OK state** (synthetic status file swapped in to prove the healthy path renders distinctly): no top banner, dropdown shows `OK` in green with the same four fields and a positive, correctly-formatted data age.
- Restored the honest current status afterward (no credentials configured in this environment → real "warning" state, real ~4.3-day-old last-known dataset) rather than leaving the synthetic test fixture in place.
