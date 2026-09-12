import gzip
import numpy as np

FILE = r"D:\SIH26085\data\raw\rainfall\gsmap\gsmap_gauge.20260906.1200.dat.gz"

# ------------------------------------------------------------
# READ GSMaP
# ------------------------------------------------------------

with gzip.open(FILE, "rb") as f:
    rainfall = np.frombuffer(f.read(), dtype="<f4").copy()

rainfall = rainfall.reshape((1200, 3600))

# Missing / invalid values
rainfall[rainfall < 0] = np.nan

# ------------------------------------------------------------
# GSMaP GRID
# ------------------------------------------------------------

# JAXA GSMaP:
# First pixel = 0.05E, 59.95N
# Resolution = 0.1 degree
# Latitude decreases from north to south

def lat_to_row(lat):
    return int(round((59.95 - lat) / 0.1))


def lon_to_col(lon):
    return int(round((lon - 0.05) / 0.1))


# ------------------------------------------------------------
# MUMBAI
# ------------------------------------------------------------

mumbai_lat = 19.05
mumbai_lon = 72.88

row = lat_to_row(mumbai_lat)
col = lon_to_col(mumbai_lon)

print("GSMaP grid:", rainfall.shape)

print("\nMumbai:")
print("Latitude:", mumbai_lat)
print("Longitude:", mumbai_lon)

print("Grid row:", row)
print("Grid column:", col)

print("Rainfall at Mumbai:",
      rainfall[row, col],
      "mm/hr")

# ------------------------------------------------------------
# NEARBY GRID
# ------------------------------------------------------------

print("\nNearby Mumbai rainfall grid:")
print(
    rainfall[
        row - 2:row + 3,
        col - 2:col + 3
    ]
)