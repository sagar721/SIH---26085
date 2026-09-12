import os
import glob
from pathlib import Path
from gsmap_reader import GSMaPReader

def main():
    metadata_path = r"D:\SIH26085\data\processed\rainfall\metadata\mumbai_zones.json"
    data_dir = r"D:\SIH26085\data\raw\rainfall\gsmap"
    
    reader = GSMaPReader(metadata_path)
    files = sorted(glob.glob(os.path.join(data_dir, "*.dat.gz")))
    
    print(f"Validating {len(files)} files...")
    
    for fpath in files:
        grid = reader.read_grid(Path(fpath))
        
        # Extract Mumbai center
        mb_lat, mb_lon = 19.05, 72.88
        center_rain = reader.extract_point(grid, mb_lat, mb_lon)
        
        # Extract zones
        kurla = reader.extract_zone(grid, "kurla_sion")
        hindmata = reader.extract_zone(grid, "hindmata_dadar")
        
        kurla_stats = reader.calculate_spatial_statistics(kurla)
        hindmata_stats = reader.calculate_spatial_statistics(hindmata)
        
        print(f"{os.path.basename(fpath)}")
        print(f"  Mumbai Center: {center_rain:.3f} mm/hr")
        print(f"  Kurla Zone    - Mean: {kurla_stats['mean_mm_hr']:.3f}, Max: {kurla_stats['max_mm_hr']:.3f}")
        print(f"  Hindmata Zone - Mean: {hindmata_stats['mean_mm_hr']:.3f}, Max: {hindmata_stats['max_mm_hr']:.3f}")

if __name__ == "__main__":
    main()
