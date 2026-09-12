import os
import ftplib
import argparse
import datetime
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

FTP_HOST = "ftp.ptree.jaxa.jp"
BASE_FTP_DIR = "/realtime_ver/v8/hourly_G"

def download_gsmap(start_date: str, end_date: str, dry_run: bool):
    user = os.environ.get("JAXA_FTP_USER")
    password = os.environ.get("JAXA_FTP_PASSWORD")
    
    if not user or not password:
        logger.error("JAXA_FTP_USER and JAXA_FTP_PASSWORD environment variables are required.")
        return

    start_dt = datetime.datetime.strptime(start_date, "%Y-%m-%d")
    end_dt = datetime.datetime.strptime(end_date, "%Y-%m-%d")
    
    current_dt = start_dt
    expected_files_count = 0
    
    base_out_dir = Path(r"D:\SIH26085\data\raw\rainfall\gsmap")
    
    logger.info(f"Target Period: {start_dt.strftime('%Y-%m-%d')} to {end_dt.strftime('%Y-%m-%d')}")
    logger.info(f"Dry Run Mode: {dry_run}")
    
    if not dry_run:
        try:
            ftp = ftplib.FTP(FTP_HOST)
            ftp.login(user, password)
        except Exception as e:
            logger.error(f"FTP Login Failed: {e}")
            return
            
    while current_dt <= end_dt:
        yyyy = current_dt.strftime("%Y")
        mm = current_dt.strftime("%m")
        dd = current_dt.strftime("%d")
        
        remote_dir = f"{BASE_FTP_DIR}/{yyyy}/{mm}/{dd}"
        
        if dry_run:
            logger.info(f"[DRY RUN] Would check remote directory: {remote_dir}")
            # Assume 24 hours per day for dry run estimation
            expected_files_count += 24
        else:
            try:
                ftp.cwd(remote_dir)
                files = ftp.nlst()
                dat_files = [f for f in files if f.endswith(".dat.gz")]
                
                for f_name in dat_files:
                    local_path = base_out_dir / f_name
                    if not local_path.exists():
                        logger.info(f"Downloading {f_name}...")
                        with open(local_path, "wb") as f:
                            ftp.retrbinary(f"RETR {f_name}", f.write)
                    else:
                        logger.debug(f"Skipping {f_name}, already exists.")
                        
                expected_files_count += len(dat_files)
            except ftplib.error_perm as e:
                logger.warning(f"Could not access {remote_dir}: {e}")
        
        current_dt += datetime.timedelta(days=1)

    if not dry_run:
        ftp.quit()
        
    logger.info(f"Total expected files in range: ~{expected_files_count}")
    logger.info(f"Estimated storage size: ~{expected_files_count * 1.4} MB")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download JAXA GSMaP v8 Hourly Gauge Data")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="Calculate totals without downloading")
    
    args = parser.parse_args()
    download_gsmap(args.start, args.end, args.dry_run)
