import os
import glob
import pandas as pd
from pathlib import Path
import datetime
import logging
from gsmap_reader import GSMaPReader

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def parse_datetime_from_filename(filename: str) -> datetime.datetime:
    """Extract datetime from JAXA filename e.g. gsmap_gauge.20260906.1200.dat.gz"""
    # Filename format: gsmap_gauge.YYYYMMDD.HHNN.dat.gz
    parts = filename.split('.')
    date_str = parts[1] # YYYYMMDD
    time_str = parts[2] # HHNN
    return datetime.datetime.strptime(f"{date_str}{time_str}", "%Y%m%d%H%M").replace(tzinfo=datetime.timezone.utc)

def process_files(metadata_path: Path, data_dir: Path, output_dir: Path):
    reader = GSMaPReader(metadata_path)
    files = sorted(glob.glob(os.path.join(data_dir, "*.dat.gz")))
    
    if not files:
        logger.warning(f"No .dat.gz files found in {data_dir}")
        return

    records = []
    
    for fpath in files:
        file_path = Path(fpath)
        dt_utc = parse_datetime_from_filename(file_path.name)
        
        try:
            grid = reader.read_grid(file_path)
        except Exception as e:
            logger.error(f"Skipping {file_path.name}: {e}")
            continue
            
        mb_lat, mb_lon = reader.config['reference_points']['mumbai_center']['lat'], reader.config['reference_points']['mumbai_center']['lon']
        center_val = reader.extract_point(grid, mb_lat, mb_lon)
        
        row = {
            'timestamp_utc': dt_utc.isoformat(),
            'mumbai_center_mm_hr': center_val,
        }
        
        # Process configured zones
        for zone_id, zone_info in reader.config['pilot_zones'].items():
            zone_data = reader.extract_zone(grid, zone_id)
            stats = reader.calculate_spatial_statistics(zone_data)
            row[f'{zone_id}_mean_mm_hr'] = stats['mean_mm_hr']
            row[f'{zone_id}_max_mm_hr'] = stats['max_mm_hr']
            row[f'{zone_id}_valid_cells'] = stats['valid_cells']
            
        records.append(row)
        
    df = pd.DataFrame(records)
    df['timestamp_utc'] = pd.to_datetime(df['timestamp_utc'])
    df = df.sort_values('timestamp_utc').set_index('timestamp_utc')
    
    # Calculate Accumulations (assuming hourly frequency and continuous data for simplicity of test)
    # Note: Real implementation might need to handle missing hours more robustly
    for zone_id in reader.config['pilot_zones'].keys():
        mean_col = f'{zone_id}_mean_mm_hr'
        df[f'{zone_id}_accum_1h'] = df[mean_col]
        df[f'{zone_id}_accum_3h'] = df[mean_col].rolling(window=3, min_periods=1).sum()
        df[f'{zone_id}_accum_6h'] = df[mean_col].rolling(window=6, min_periods=1).sum()
        df[f'{zone_id}_accum_24h'] = df[mean_col].rolling(window=24, min_periods=1).sum()

    out_file = output_dir / "mumbai_processed_rainfall.csv"
    df.to_csv(out_file)
    logger.info(f"Processed {len(df)} hourly records. Saved to {out_file}")

if __name__ == '__main__':
    base_dir = Path(r"D:\SIH26085")
    metadata_path = base_dir / "data" / "processed" / "rainfall" / "metadata" / "mumbai_zones.json"
    data_dir = base_dir / "data" / "raw" / "rainfall" / "gsmap"
    output_dir = base_dir / "data" / "processed" / "rainfall" / "hourly"
    
    output_dir.mkdir(parents=True, exist_ok=True)
    process_files(metadata_path, data_dir, output_dir)
