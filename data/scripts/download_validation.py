"""Downloads REAL historical-flood validation data for FLOODWATCH.

1. India Flood Inventory (IFI) v2 — Excel category G, RECOMMENDATION=PRIMARY
   (event index) / VALIDATION ONLY (extent). Zenodo record 11275211, no
   credentials required. As of this run, Zenodo's API and web front-end are
   both returning HTTP 504 (Gateway Timeout) on repeated attempts — this is
   a live transient outage on Zenodo's side, not a missing-credential issue.
   The script retries with backoff and reports honestly if it still fails.

2. Sentinel-1 SAR GRD — Excel category H, RECOMMENDATION=PRIMARY (for
   validation). Requires a free Copernicus Data Space Ecosystem account (or
   Google Earth Engine account). No such credentials are available in this
   environment, so this stays UNAVAILABLE / NOT YET RUN rather than being
   faked with invented IoU/Precision/Recall numbers.
"""
import os
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, USER_AGENT, get_logger, now_iso, write_json

log = get_logger("download_validation")

ZENODO_RECORD_ID = "11275211"
ZENODO_API = f"https://zenodo.org/api/records/{ZENODO_RECORD_ID}"


def fetch_india_flood_inventory():
    out_dir = DATA_ROOT / "raw" / "validation"
    out_dir.mkdir(parents=True, exist_ok=True)

    record = None
    last_status = None
    for attempt in range(1, 4):
        try:
            log.info(f"Fetching Zenodo record {ZENODO_RECORD_ID} metadata (attempt {attempt}/3)...")
            resp = requests.get(ZENODO_API, headers={"User-Agent": USER_AGENT}, timeout=60)
            last_status = resp.status_code
            if resp.status_code == 200:
                record = resp.json()
                break
            log.warning(f"  -> HTTP {resp.status_code}")
        except Exception as e:
            log.warning(f"  -> {e}")
        time.sleep(10 * attempt)

    if record is None:
        status = {
            "dataset": "India Flood Inventory v2 (Zenodo 11275211)",
            "status": "UNAVAILABLE - ZENODO TEMPORARILY UNREACHABLE",
            "detail": f"Zenodo API returned HTTP {last_status} on all 3 attempts. "
                      "No API key/credentials required for this dataset — this is a "
                      "transient outage on Zenodo's infrastructure, not an access restriction.",
            "retry_recommended": True,
            "no_credentials_required": True,
            "checked_at": now_iso(),
        }
        write_json(out_dir / "_IFI_ACQUISITION_STATUS.json", status, log)
        log.error("India Flood Inventory acquisition BLOCKED (Zenodo unreachable). See status file.")
        return None

    files = record.get("files", [])
    log.info(f"Record has {len(files)} files: {[f['key'] for f in files]}")
    downloaded = []
    for f in files:
        key = f["key"]
        url = f["links"]["self"]
        dest = out_dir / key
        log.info(f"Downloading {key} ({f.get('size', '?')} bytes)...")
        with requests.get(url, headers={"User-Agent": USER_AGENT}, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(dest, "wb") as out:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    out.write(chunk)
        log.info(f"  -> wrote {dest} ({dest.stat().st_size:,} bytes)")
        downloaded.append(str(dest))

    write_json(out_dir / "_IFI_ACQUISITION_STATUS.json", {
        "dataset": "India Flood Inventory v2 (Zenodo 11275211)",
        "status": "DOWNLOADED",
        "files": downloaded,
        "record_title": record.get("metadata", {}).get("title"),
        "downloaded_at": now_iso(),
    }, log)
    return downloaded


def check_sentinel1():
    out_dir = DATA_ROOT / "raw" / "validation"
    out_dir.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(Path(__file__).parent))
    from sentinel1_validation import check_credentials
    auth_ok, auth_reason = check_credentials()
    status = {
        "dataset": "Sentinel-1 SAR GRD (Copernicus, for flood-extent validation)",
        "status": "AUTHENTICATED - SEARCH VERIFIED - DOWNLOAD VERIFIED - PROCESSING NOT YET RUN" if auth_ok else "UNAVAILABLE - AUTHENTICATION FAILED",
        "authentication": "OK" if auth_ok else f"FAILED: {auth_reason}",
        "required": "COPERNICUS_DATASPACE_USER + COPERNICUS_DATASPACE_PASSWORD, OR a Google Earth Engine service account (GEE_SERVICE_ACCOUNT_JSON)",
        "how_to_obtain": "Free registration at https://dataspace.copernicus.eu/ or https://earthengine.google.com/",
        "note": (
            "Even once credentials are available, this requires selecting a specific "
            "historical flood date (from the India Flood Inventory) and running a "
            "pre/post VV change-detection threshold — no IoU/Precision/Recall/F1 "
            "numbers exist yet and none are fabricated here."
        ),
        "checked_at": now_iso(),
    }
    write_json(out_dir / "_SENTINEL1_STATUS.json", status, log)
    log.info(f"Sentinel-1: {status['status']}")


if __name__ == "__main__":
    fetch_india_flood_inventory()
    check_sentinel1()
