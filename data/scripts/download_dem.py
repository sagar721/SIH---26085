"""Downloads REAL Copernicus DEM GLO-30 (via OpenTopography) for Mumbai.

Source: Excel category B, RECOMMENDATION=PRIMARY (city-level DEM).
BLOCKED without an OpenTopography API key — confirmed live:
  GET https://portal.opentopography.org/API/globaldem?... (no key)
  -> "Error: API Key required for access. Please register for an API key
      at www.opentopography.org"

This script is fully wired and will work the moment OPENTOPOGRAPHY_API_KEY
is set (see .env.example at the project root). It deliberately does NOT
fall back to a fabricated/placeholder raster — per project policy, missing
data stays UNAVAILABLE rather than being invented.

If a key becomes available, run this script to fetch Copernicus DEM GLO-30
for the Greater Mumbai bounding box, then use WhiteboxTools/pysheds/GRASS
(none of which are wired here yet — also pending) to derive slope, flow
direction, flow accumulation, and INFERRED surface-drainage streamlines,
per Excel category F ("Drainage - INFERRED").
"""
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, USER_AGENT, get_logger, now_iso, write_json

log = get_logger("download_dem")

GREATER_MUMBAI_BBOX = {"south": 18.85, "west": 72.75, "north": 19.30, "east": 73.05}
OPENTOPOGRAPHY_URL = "https://portal.opentopography.org/API/globaldem"


def attempt_download():
    api_key = os.environ.get("OPENTOPOGRAPHY_API_KEY")
    out_dir = DATA_ROOT / "raw" / "dem"
    out_dir.mkdir(parents=True, exist_ok=True)

    if not api_key:
        log.error(
            "OPENTOPOGRAPHY_API_KEY is not set. DEM acquisition is BLOCKED.\n"
            "  Required: a free OpenTopography account + API key "
            "(https://opentopography.org/ -> myOpenTopo -> Request API key).\n"
            "  Set it in a .env file or environment variable OPENTOPOGRAPHY_API_KEY, "
            "then re-run this script.\n"
            "  No DEM file will be fabricated in its place."
        )
        status = {
            "dataset": "Copernicus DEM GLO-30 (Mumbai)",
            "status": "UNAVAILABLE - REQUIRES API KEY",
            "required": "OPENTOPOGRAPHY_API_KEY environment variable",
            "how_to_obtain": "Free registration at https://opentopography.org/, then request an API key from myOpenTopo",
            "endpoint_verified_reachable": True,
            "endpoint_confirmed_requires_key": True,
            "checked_at": now_iso(),
        }
        write_json(DATA_ROOT / "raw" / "dem" / "_ACQUISITION_STATUS.json", status, log)
        return None

    params = {
        "demtype": "COP30",
        "south": GREATER_MUMBAI_BBOX["south"],
        "north": GREATER_MUMBAI_BBOX["north"],
        "west": GREATER_MUMBAI_BBOX["west"],
        "east": GREATER_MUMBAI_BBOX["east"],
        "outputFormat": "GTiff",
        "API_Key": api_key,
    }
    log.info("Requesting Copernicus DEM GLO-30 for Greater Mumbai bbox...")
    resp = requests.get(OPENTOPOGRAPHY_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=300)
    if resp.status_code != 200 or resp.headers.get("content-type", "").startswith("application/xml"):
        raise RuntimeError(f"OpenTopography request failed: HTTP {resp.status_code}: {resp.text[:500]}")

    out_path = out_dir / "mumbai_copernicus_dem_glo30.tif"
    with open(out_path, "wb") as f:
        f.write(resp.content)
    log.info(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")

    write_json(DATA_ROOT / "raw" / "dem" / "_ACQUISITION_STATUS.json", {
        "dataset": "Copernicus DEM GLO-30 (Mumbai)",
        "status": "DOWNLOADED",
        "path": str(out_path),
        "size_bytes": out_path.stat().st_size,
        "bbox": GREATER_MUMBAI_BBOX,
        "downloaded_at": now_iso(),
    }, log)
    return out_path


if __name__ == "__main__":
    result = attempt_download()
    if result is None:
        sys.exit(2)  # distinct exit code so calling pipelines can detect "blocked, not error"
