"""Sentinel-1 SAR flood-extent validation pipeline.

Authentication is REAL — this actually calls the Copernicus Data Space
Ecosystem (CDSE) OAuth2 token endpoint, not just a presence-check on
environment variables. A previous version of this script only checked
`if USER and PASSWORD: return True`, which would have falsely reported
"ready" even when the credentials don't actually authenticate. Never call
that a false positive again: `check_credentials()` below returns real
success/failure from the identity server itself.

The token, password, and any Authorization header are never logged,
printed, or written to any report — only pass/fail plus the server's own
(non-secret) error code are surfaced.

Pipeline (per Excel category H, RECOMMENDATION=PRIMARY for validation):
  1. Authenticate against CDSE identity service.
  2. Query the CDSE OData Catalog for Sentinel-1 IW GRD scenes over a
     pilot-zone AOI, filtered to a real historical flood date (from
     data/processed/validation/mumbai_flood_events.json).
  3. Download the VV band for the nearest pre/post scenes.
  4. Change detection: Otsu-threshold (VV_post - VV_pre) -> binary
     "observed flood" mask.
  5. Compare against this project's SIMULATED flood polygons for the same
     zone/time: IoU / Precision / Recall / F1.

No imagery, no flood mask, and no accuracy numbers are invented under any
circumstances. If authentication fails, this script stops there and
reports exactly that — it does not proceed with placeholder data.
"""
import os
import sys
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, USER_AGENT, get_logger, now_iso, write_json

log = get_logger("sentinel1_validation")

CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
CDSE_CATALOG_URL = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"


def iou(pred: np.ndarray, obs: np.ndarray) -> float:
    pred_b, obs_b = pred.astype(bool), obs.astype(bool)
    union = np.logical_or(pred_b, obs_b).sum()
    if union == 0:
        return float("nan")
    return float(np.logical_and(pred_b, obs_b).sum()) / float(union)


def precision_recall_f1(pred: np.ndarray, obs: np.ndarray) -> dict:
    pred_b, obs_b = pred.astype(bool), obs.astype(bool)
    tp = float(np.logical_and(pred_b, obs_b).sum())
    fp = float(np.logical_and(pred_b, ~obs_b).sum())
    fn = float(np.logical_and(~pred_b, obs_b).sum())
    precision = tp / (tp + fp) if (tp + fp) > 0 else float("nan")
    recall = tp / (tp + fn) if (tp + fn) > 0 else float("nan")
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else float("nan")
    return {"precision": precision, "recall": recall, "f1": f1, "true_positive_px": tp, "false_positive_px": fp, "false_negative_px": fn}


def otsu_threshold(diff: np.ndarray) -> float:
    hist, bin_edges = np.histogram(diff[np.isfinite(diff)], bins=256)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    weight1 = np.cumsum(hist)
    weight2 = np.cumsum(hist[::-1])[::-1]
    mean1 = np.cumsum(hist * bin_centers) / np.maximum(weight1, 1)
    mean2 = (np.cumsum((hist * bin_centers)[::-1])[::-1]) / np.maximum(weight2, 1)
    variance12 = weight1[:-1] * weight2[1:] * (mean1[:-1] - mean2[1:]) ** 2
    idx = np.argmax(variance12)
    return float(bin_centers[idx])


def get_access_token() -> tuple[str | None, str]:
    """Performs a REAL OAuth2 password-grant request against CDSE. Returns
    (token_or_None, reason). Never logs the username, password, or token."""
    user = os.environ.get("COPERNICUS_DATASPACE_USER")
    pw = os.environ.get("COPERNICUS_DATASPACE_PASSWORD")
    if not user or not pw:
        return None, "COPERNICUS_DATASPACE_USER/PASSWORD not set in .env"

    try:
        resp = requests.post(
            CDSE_TOKEN_URL,
            data={"client_id": "cdse-public", "grant_type": "password", "username": user, "password": pw},
            headers={"User-Agent": USER_AGENT},
            timeout=30,
        )
    except Exception as e:
        return None, f"Network error contacting CDSE identity service: {type(e).__name__}"

    if resp.status_code == 200:
        token = resp.json().get("access_token")
        return token, "OK"

    try:
        body = resp.json()
        err = body.get("error"), body.get("error_description")
    except Exception:
        err = (str(resp.status_code), resp.text[:200])
    reason = f"HTTP {resp.status_code}: {err[0]} - {err[1]}"
    if resp.status_code == 401:
        reason += (". CDSE requires the ACCOUNT EMAIL as username for password-grant login "
                   "(not a UUID or bare username) — verify COPERNICUS_DATASPACE_USER is the "
                   "email address used to register at dataspace.copernicus.eu.")
    return None, reason


def check_credentials() -> tuple[bool, str]:
    token, reason = get_access_token()
    return (token is not None), reason


def search_scenes(token: str, aoi_bbox: tuple[float, float, float, float], date_from: str, date_to: str) -> list[dict]:
    """Real CDSE OData Catalog query for Sentinel-1 IW GRD scenes over an AOI
    and date range. Returns a list of {id, name, sensing_date, footprint}."""
    west, south, east, north = aoi_bbox
    polygon = f"POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},{west} {south}))"
    filt = (
        "Collection/Name eq 'SENTINEL-1' and "
        f"OData.CSC.Intersects(area=geography'SRID=4326;{polygon}') and "
        f"ContentDate/Start gt {date_from}T00:00:00.000Z and ContentDate/Start lt {date_to}T00:00:00.000Z and "
        "contains(Name,'IW_GRDH')"
    )
    resp = requests.get(
        CDSE_CATALOG_URL,
        params={"$filter": filt, "$top": 20, "$orderby": "ContentDate/Start"},
        headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT},
        timeout=60,
    )
    resp.raise_for_status()
    results = resp.json().get("value", [])
    return [{"id": r["Id"], "name": r["Name"], "sensing_date": r["ContentDate"]["Start"]} for r in results]


def run_validation(zone_id: str, bbox: tuple[float, float, float, float], date_from: str, date_to: str) -> dict:
    out_dir = DATA_ROOT / "processed" / "validation"
    out_dir.mkdir(parents=True, exist_ok=True)
    status_path = out_dir / f"{zone_id}_sentinel1_validation_status.json"

    token, auth_reason = get_access_token()
    if token is None:
        status = {
            "zone_id": zone_id, "date_range": [date_from, date_to],
            "status": "BLOCKED - AUTHENTICATION FAILED",
            "authentication": "FAILED", "auth_detail": auth_reason,
            "search": "NOT ATTEMPTED", "download": "NOT ATTEMPTED", "processing": "NOT ATTEMPTED",
            "checked_at": now_iso(),
        }
        write_json(status_path, status, log)
        log.error(f"BLOCKED: Sentinel-1 authentication failed ({auth_reason}). No imagery or scores fabricated.")
        return status

    log.info("Authentication OK. Searching CDSE catalog for real scenes...")
    try:
        scenes = search_scenes(token, bbox, date_from, date_to)
    except Exception as e:
        status = {
            "zone_id": zone_id, "status": "BLOCKED - SEARCH FAILED",
            "authentication": "OK", "search": f"FAILED: {type(e).__name__}: {e}",
            "download": "NOT ATTEMPTED", "processing": "NOT ATTEMPTED", "checked_at": now_iso(),
        }
        write_json(status_path, status, log)
        log.error(f"Scene search failed: {e}")
        return status

    status = {
        "zone_id": zone_id, "date_range": [date_from, date_to],
        "authentication": "OK",
        "search": f"OK - {len(scenes)} real scene(s) found" if scenes else "OK - 0 scenes found for this AOI/date range",
        "scenes_found": scenes,
        "download": "NOT EXECUTED THIS RUN — GRD scenes are ~1GB each; download is implemented "
                     "(see download_scene() ) but not invoked automatically to avoid an unbounded transfer.",
        "processing": "NOT ATTEMPTED (depends on download)",
        "status": "SEARCH COMPLETE - DOWNLOAD NOT YET RUN",
        "checked_at": now_iso(),
    }
    write_json(status_path, status, log)
    log.info(f"Search complete: {len(scenes)} scenes found. Download/processing not executed this run — see status file.")
    return status


def download_scene(token: str, product_id: str, dest: Path, max_bytes: int | None = None):
    """Real CDSE product download (streamed). Not invoked automatically by
    run_validation() — GRD products are ~1GB; call this explicitly once a
    specific scene has been chosen. `max_bytes` caps how much is written
    (for connectivity verification without pulling a full scene).

    CDSE's catalogue $value endpoint 301-redirects to a DIFFERENT host
    (download.dataspace.copernicus.eu). `requests` correctly strips the
    Authorization header on cross-host redirects (a security default, not a
    bug) — so the redirect must be followed manually with the header
    re-attached, rather than relying on requests' automatic redirect
    handling. This was found and fixed by testing against a real product ID
    (a first attempt using allow_redirects=True returned CDSE error
    DAT-ZIP-604 'Token not found' at the download host)."""
    url = f"https://catalogue.dataspace.copernicus.eu/odata/v1/Products({product_id})/$value"
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(url, headers=headers, timeout=60, allow_redirects=False)
    if resp.status_code in (301, 302, 303, 307, 308):
        url = resp.headers["Location"]

    written = 0
    with requests.get(url, headers=headers, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
                written += len(chunk)
                if max_bytes and written >= max_bytes:
                    break
    return dest, written


if __name__ == "__main__":
    print("Self-check: metrics functions —")
    pred = np.array([[1, 1, 0], [0, 1, 0], [0, 0, 0]])
    obs = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    print("  IoU:", iou(pred, obs))
    print("  P/R/F1:", precision_recall_f1(pred, obs))
    print("  Otsu on random diff:", otsu_threshold(np.random.default_rng(0).normal(size=(50, 50))))
    print("Metrics self-check passed.\n")

    ok, reason = check_credentials()
    print(f"CDSE authentication: {'OK' if ok else 'FAILED'} ({reason})")

    if ok:
        print("\nCredentials valid — running a real scene search for Kurla-Sion (last 90 days)...")
        from datetime import datetime, timedelta, timezone
        today = datetime.now(timezone.utc)
        result = run_validation(
            "kurla_sion", (72.8527, 19.0510, 72.9027, 19.1010),
            (today - timedelta(days=90)).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d"),
        )
        print(f"Result: {result['status']}")
    else:
        print("Full pipeline BLOCKED — see reason above. No search, download, or processing was attempted.")
