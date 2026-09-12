import gzip
import json
import logging
import numpy as np
from pathlib import Path

logger = logging.getLogger(__name__)

class GSMaPReader:
    """
    Robust reader for JAXA GSMaP Version 8 Gauge-calibrated hourly rainfall binary files.
    """
    
    def __init__(self, metadata_path: str):
        self.metadata_path = Path(metadata_path)
        with open(self.metadata_path, 'r') as f:
            self.config = json.load(f)
            
        self.meta = self.config['metadata']
        self.shape = tuple(self.meta['grid_shape'])
        self.res = self.meta['resolution_deg']
        self.first_lat = self.meta['first_pixel_lat']
        self.first_lon = self.meta['first_pixel_lon']
        self.missing_val = self.meta['missing_value']

    def validate_file(self, file_path: Path) -> bool:
        """Basic validation to ensure file exists and has correct uncompressed size (if possible)"""
        if not file_path.exists():
            logger.error(f"File not found: {file_path}")
            return False
        return True

    def lat_to_row(self, lat: float) -> int:
        """Convert latitude to 0-indexed row. JAXA grids decrease from North to South."""
        # Row 0 is 59.95. Row 1 is 59.85, etc.
        return int(round((self.first_lat - lat) / self.res))

    def lon_to_col(self, lon: float) -> int:
        """Convert longitude to 0-indexed column. JAXA grids increase from West to East."""
        return int(round((lon - self.first_lon) / self.res))

    def read_grid(self, file_path: Path) -> np.ndarray:
        """Reads the full 1200x3600 GSMaP grid, replacing missing values with NaN."""
        if not self.validate_file(file_path):
            raise FileNotFoundError(f"Missing or invalid GSMaP file: {file_path}")
            
        try:
            with gzip.open(file_path, "rb") as f:
                # GSMaP is Little-endian float32
                data = np.frombuffer(f.read(), dtype="<f4").copy()
            
            data = data.reshape(self.shape)
            # Anything less than 0 is missing/invalid data (e.g. -99)
            data[data < 0] = np.nan
            return data
            
        except Exception as e:
            logger.error(f"Failed reading {file_path}: {e}")
            raise

    def extract_point(self, grid: np.ndarray, lat: float, lon: float) -> float:
        """Extract rainfall at a specific coordinate."""
        row = self.lat_to_row(lat)
        col = self.lon_to_col(lon)
        return float(grid[row, col])

    def extract_bbox(self, grid: np.ndarray, lat_min: float, lat_max: float, lon_min: float, lon_max: float) -> np.ndarray:
        """
        Extract rainfall for a bounding box.
        Remember: higher latitude means a lower row index.
        """
        row_min = self.lat_to_row(lat_max) # North bound -> lower row index
        row_max = self.lat_to_row(lat_min) # South bound -> higher row index
        
        col_min = self.lon_to_col(lon_min)
        col_max = self.lon_to_col(lon_max)
        
        # Slicing is exclusive of the upper bound, so we add 1
        return grid[row_min:row_max+1, col_min:col_max+1]

    def extract_zone(self, grid: np.ndarray, zone_id: str) -> np.ndarray:
        """Extract rainfall for a pre-configured pilot zone from metadata."""
        if zone_id not in self.config['pilot_zones']:
            raise ValueError(f"Unknown zone: {zone_id}")
            
        bbox = self.config['pilot_zones'][zone_id]['bbox']
        return self.extract_bbox(
            grid, 
            bbox['lat_min'], 
            bbox['lat_max'], 
            bbox['lon_min'], 
            bbox['lon_max']
        )

    def calculate_spatial_statistics(self, zone_data: np.ndarray) -> dict:
        """Calculate mean, max, and valid cell counts for an extracted array."""
        if np.all(np.isnan(zone_data)):
            return {
                "mean_mm_hr": np.nan,
                "max_mm_hr": np.nan,
                "valid_cells": 0,
                "total_cells": zone_data.size
            }
            
        return {
            "mean_mm_hr": float(np.nanmean(zone_data)),
            "max_mm_hr": float(np.nanmax(zone_data)),
            "valid_cells": int(np.sum(~np.isnan(zone_data))),
            "total_cells": int(zone_data.size)
        }

if __name__ == '__main__':
    # Simple self-test
    logging.basicConfig(level=logging.INFO)
    metadata_file = Path(r"D:\SIH26085\data\processed\rainfall\metadata\mumbai_zones.json")
    if metadata_file.exists():
        reader = GSMaPReader(metadata_file)
        print("GSMaP Reader initialized successfully.")
