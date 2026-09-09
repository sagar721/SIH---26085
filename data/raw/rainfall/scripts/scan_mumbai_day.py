import gzip
import glob
import os
import numpy as np

FOLDER = r"D:\SIH26085\data\raw\rainfall\gsmap"

# Mumbai center
MUMBAI_LAT = 19.05
MUMBAI_LON = 72.88

# GSMaP v8 grid
def lat_to_row(lat):
    return int(round((59.95 - lat) / 0.1))

def lon_to_col(lon):
    return int(round((lon - 0.05) / 0.1))

row = lat_to_row(MUMBAI_LAT)
col = lon_to_col(MUMBAI_LON)

files = sorted(glob.glob(os.path.join(FOLDER, "*.dat.gz")))

print("Mumbai grid:", row, col)
print("Files found:", len(files))
print()

for file in files:

    with gzip.open(file, "rb") as f:
        rainfall = np.frombuffer(
            f.read(),
            dtype="<f4"
        ).copy()

    rainfall = rainfall.reshape((1200, 3600))
    rainfall[rainfall < 0] = np.nan

    # 5x5 area around Mumbai
    nearby = rainfall[
        row - 2:row + 3,
        col - 2:col + 3
    ]

    center = rainfall[row, col]

    print(
        f"{os.path.basename(file)}"
        f"  | Mumbai: {center:.3f}"
        f"  | Nearby max: {np.nanmax(nearby):.3f}"
        f" mm/hr"
    )