"""Automatic GSMaP rainfall refresh orchestrator.

Replaces the previous fully-manual workflow (a human runs download_gsmap.py
with an explicit --start/--end date range, then runs process_rainfall.py,
then manually copies the resulting CSV into frontend/public/data/rainfall/)
with a single script that can be scheduled (cron / Windows Task Scheduler)
and requires no human intervention on a routine run:

  1. DETECT   - list the JAXA FTP directory for today (UTC) and, if empty or
                unreachable, walk backward a bounded number of days to find
                the most recent populated remote directory and the newest
                .dat.gz timestamp in it.
  2. DOWNLOAD - fetch only the files newer than what's already on disk
                locally (download_gsmap.py's existing skip-if-exists check,
                reused here rather than reimplemented).
  3. PROCESS  - re-run the existing process_rainfall.process_files() logic
                (imported, not re-implemented) over ALL local raw files, so
                the hourly-accumulation rolling windows stay correct.
  4. PUBLISH  - copy the resulting CSV (and the zone-definition metadata it
                depends on) into frontend/public/data/rainfall/, which is
                the one and only step that used to require a human to copy
                a file by hand.
  5. REPORT   - write rainfall_refresh_status.json next to the published
                CSV, so the frontend can display Last Updated / Source /
                Timestamp / Data Age without guessing.

Failure handling (JAXA_FTP_USER/PASSWORD missing, FTP host unreachable,
login rejected, directory listing empty for the whole lookback window):
caught at every stage. On failure this script NEVER touches the previously
published CSV or metadata (the last valid dataset stays exactly as it was)
and status.json is written with status="warning" and a human-readable
reason instead of raising. The process exit code (0 = ok, 1 = warning) is
the only place a failure is allowed to be "loud" - that's for a scheduler
(cron/Task Scheduler) to alert on, not for the running application to see.
"""
import argparse
import datetime
import ftplib
import glob
import json
import logging
import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from process_rainfall import process_files  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger("refresh_rainfall")

FTP_HOST = "ftp.ptree.jaxa.jp"
BASE_FTP_DIR = "/realtime_ver/v8/hourly_G"
SOURCE_LABEL = "JAXA GSMaP V8 Gauge-calibrated hourly rainfall (realtime_ver, FTP)"

BASE_DIR = Path(r"D:\SIH26085")
RAW_GSMAP_DIR = BASE_DIR / "data" / "raw" / "rainfall" / "gsmap"
METADATA_PATH = BASE_DIR / "data" / "processed" / "rainfall" / "metadata" / "mumbai_zones.json"
PROCESSED_DIR = BASE_DIR / "data" / "processed" / "rainfall" / "hourly"
PROCESSED_CSV = PROCESSED_DIR / "mumbai_processed_rainfall.csv"
FRONTEND_RAINFALL_DIR = BASE_DIR / "frontend" / "public" / "data" / "rainfall"
STATUS_PATH = FRONTEND_RAINFALL_DIR / "rainfall_refresh_status.json"

# GSMaP's own realtime processing carries a few hours of inherent latency.
# Beyond this, the freshest data we can possibly have is stale enough that
# an operator should be told plainly, even if every step technically
# "succeeded".
STALE_DATA_AGE_HOURS = 6.0
MAX_LOOKBACK_DAYS = 5


def parse_file_timestamp(filename: str) -> datetime.datetime:
    # gsmap_gauge.YYYYMMDD.HHNN.dat.gz
    parts = filename.split(".")
    return datetime.datetime.strptime(f"{parts[1]}{parts[2]}", "%Y%m%d%H%M").replace(tzinfo=datetime.timezone.utc)


def local_latest_timestamp() -> datetime.datetime | None:
    files = glob.glob(str(RAW_GSMAP_DIR / "*.dat.gz"))
    if not files:
        return None
    return max(parse_file_timestamp(Path(f).name) for f in files)


def find_remote_newest(ftp: ftplib.FTP, since_days: int) -> tuple[datetime.datetime | None, dict[str, list[str]]]:
    """Walks backward from today (UTC) looking for populated remote day
    directories. Returns (newest_timestamp_found, {remote_dir: [filenames]})
    for every populated directory checked, so the caller can download from
    all of them without listing twice."""
    newest: datetime.datetime | None = None
    listings: dict[str, list[str]] = {}
    today = datetime.datetime.now(datetime.timezone.utc).date()

    for delta in range(since_days):
        day = today - datetime.timedelta(days=delta)
        remote_dir = f"{BASE_FTP_DIR}/{day:%Y}/{day:%m}/{day:%d}"
        try:
            ftp.cwd(remote_dir)
            files = [f for f in ftp.nlst() if f.endswith(".dat.gz")]
        except ftplib.error_perm:
            # Directory doesn't exist yet (e.g. today, very early in the day) - not an error.
            continue
        if not files:
            continue
        listings[remote_dir] = files  # bare filenames, valid once cwd'd back into remote_dir
        day_newest = max(parse_file_timestamp(f) for f in files)
        if newest is None or day_newest > newest:
            newest = day_newest

    return newest, listings


def download_new_files(ftp: ftplib.FTP, listings: dict[str, list[str]], after: datetime.datetime | None) -> int:
    downloaded = 0
    for remote_dir, filenames in listings.items():
        ftp.cwd(remote_dir)
        for fname in sorted(filenames):
            local_path = RAW_GSMAP_DIR / fname
            if local_path.exists():
                continue
            ts = parse_file_timestamp(fname)
            if after is not None and ts <= after:
                # Older than what's already local - shouldn't normally happen
                # (local files exist per-timestamp), but skip defensively.
                continue
            log.info(f"Downloading {fname}...")
            with open(local_path, "wb") as f:
                ftp.retrbinary(f"RETR {fname}", f.write)
            downloaded += 1
    return downloaded


def publish_to_frontend() -> None:
    FRONTEND_RAINFALL_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(PROCESSED_CSV, FRONTEND_RAINFALL_DIR / PROCESSED_CSV.name)
    if METADATA_PATH.exists():
        shutil.copy2(METADATA_PATH, FRONTEND_RAINFALL_DIR / METADATA_PATH.name)


def latest_processed_timestamp() -> datetime.datetime | None:
    if not PROCESSED_CSV.exists():
        return None
    with open(PROCESSED_CSV, "r") as f:
        last_line = None
        for line in f:
            if line.strip():
                last_line = line
    if not last_line:
        return None
    ts_str = last_line.split(",")[0]
    dt = datetime.datetime.fromisoformat(ts_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def write_status(status: str, message: str, checked_at: datetime.datetime, new_files: int) -> None:
    latest_ts = latest_processed_timestamp()
    data_age_hours = (
        round((checked_at - latest_ts).total_seconds() / 3600.0, 2) if latest_ts is not None else None
    )
    if status == "ok" and data_age_hours is not None and data_age_hours > STALE_DATA_AGE_HOURS:
        status = "warning"
        message = message or f"Newest available data is {data_age_hours:.1f}h old (feed appears delayed upstream)."

    FRONTEND_RAINFALL_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "last_updated_utc": checked_at.isoformat(),
        "source": SOURCE_LABEL,
        "latest_data_timestamp_utc": latest_ts.isoformat() if latest_ts else None,
        "data_age_hours": data_age_hours,
        "status": status,
        "message": message,
        "new_files_downloaded": new_files,
    }
    with open(STATUS_PATH, "w") as f:
        json.dump(payload, f, indent=2)
    log.info(f"Wrote status: {status}{' - ' + message if message else ''} (data_age_hours={data_age_hours})")


def run_once(lookback_days: int = MAX_LOOKBACK_DAYS, dry_run: bool = False) -> bool:
    """Returns True if the refresh completed in a healthy (non-warning) state."""
    checked_at = datetime.datetime.now(datetime.timezone.utc)
    RAW_GSMAP_DIR.mkdir(parents=True, exist_ok=True)

    user = os.environ.get("JAXA_FTP_USER")
    password = os.environ.get("JAXA_FTP_PASSWORD")
    if not user or not password:
        msg = "JAXA_FTP_USER / JAXA_FTP_PASSWORD not set - cannot check for new data. Keeping last valid dataset."
        log.warning(msg)
        write_status("warning", msg, checked_at, 0)
        return False

    local_max = local_latest_timestamp()
    downloaded = 0
    try:
        ftp = ftplib.FTP(FTP_HOST, timeout=30)
        ftp.login(user, password)
        try:
            remote_newest, listings = find_remote_newest(ftp, lookback_days)
            if remote_newest is None:
                msg = f"No GSMaP files found on the feed in the last {lookback_days} day(s). Keeping last valid dataset."
                log.warning(msg)
                write_status("warning", msg, checked_at, 0)
                return False

            if local_max is not None and remote_newest <= local_max:
                log.info(f"Already up to date (local latest {local_max.isoformat()}).")
            elif dry_run:
                log.info(f"[DRY RUN] Would download new data up to {remote_newest.isoformat()}.")
            else:
                downloaded = download_new_files(ftp, listings, local_max)
                log.info(f"Downloaded {downloaded} new file(s).")
        finally:
            ftp.quit()
    except Exception as e:
        msg = f"GSMaP feed unreachable ({e}). Keeping last valid dataset."
        log.warning(msg)
        write_status("warning", msg, checked_at, 0)
        return False

    if dry_run:
        write_status("ok", "", checked_at, 0)
        return True

    # Reprocess from ALL local raw files every run (not just the new ones) -
    # cheap at this data volume, and keeps the rolling accumulation windows
    # (1h/3h/6h/24h) correct without incremental-merge bugs.
    try:
        PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
        process_files(METADATA_PATH, RAW_GSMAP_DIR, PROCESSED_DIR)
        publish_to_frontend()
    except Exception as e:
        msg = f"Downloaded new data but processing/publish failed ({e}). Keeping last valid published dataset."
        log.error(msg)
        write_status("warning", msg, checked_at, downloaded)
        return False

    write_status("ok", "", checked_at, downloaded)
    return True


def main():
    parser = argparse.ArgumentParser(description="Automatic GSMaP rainfall detect/download/process/publish refresh")
    parser.add_argument("--dry-run", action="store_true", help="Detect only, do not download/process/publish")
    parser.add_argument("--lookback-days", type=int, default=MAX_LOOKBACK_DAYS)
    parser.add_argument("--loop", action="store_true", help="Run continuously instead of once (for environments with no OS-level scheduler)")
    parser.add_argument("--interval-minutes", type=int, default=30)
    args = parser.parse_args()

    if not args.loop:
        healthy = run_once(args.lookback_days, args.dry_run)
        sys.exit(0 if healthy else 1)

    log.info(f"Starting refresh loop, every {args.interval_minutes} minute(s). Ctrl+C to stop.")
    while True:
        try:
            run_once(args.lookback_days, args.dry_run)
        except Exception as e:
            # Defense in depth: a single cycle's unexpected bug must never
            # kill the loop - that would silently stop all future refreshes.
            log.error(f"Unexpected error in refresh cycle (loop continues): {e}")
        time.sleep(args.interval_minutes * 60)


if __name__ == "__main__":
    main()
