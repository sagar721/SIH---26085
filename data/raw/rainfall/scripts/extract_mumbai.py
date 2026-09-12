import gzip
import numpy as np
import os

# ============================================================
# INPUT
# ============================================================

FILE = r"D:\SIH26085\data\raw\rainfall\gsmap\gsmap_gauge.20260906.1200.dat.gz"

# ============================================================
# READ GSMaP
# ============================================================

with gzip.open(FILE, "rb") as f:
    rainfall = np.frombuffer(f.read(), dtype="<f4").copy()

rainfall = rainfall.reshape((1200, 3600))

# -99 = missing / invalid
rainfall[rainfall < 0] = np.nan

# ============================================================
# GSMaP GRID
# ============================================================

# GSMaP v8 grid:
# 0.1 degree resolution
# Longitude: 0.05, 0.15, ..., 359.95
# Latitude:  -59.95, -59.85, ..., 59.95

lons = np.arange(0.05, 360.0, 0.1)
lats = np.arange(-59.95, 60.0, 0.1)

# ============================================================
# MUMBAI PILOT ZONES
# ============================================================

zones = {
    "kurla_sion_chunabhatti": {
        "lat_min": 19.00,
        "lat_max": 19.12,
        "lon_min": 72.82,
        "lon_max": 72.93
    },

    "hindmata_dadar_parel": {
        "lat_min": 18.98,
        "lat_max": 19.02,
        "lon_min": 72.82,
        "lon_max": 72.88
    }
}

# ============================================================
# EXTRACT EACH ZONE
# ============================================================

for name, box in zones.items():

    lat_mask = (
        (lats >= box["lat_min"]) &
        (lats <= box["lat_max"])
    )

    lon_mask = (
        (lons >= box["lon_min"]) &
        (lons <= box["lon_max"])
    )

    zone_data = rainfall[np.ix_(lat_mask, lon_mask)]

    print("\n======================================")
    print(name)
    print("======================================")

    print("Grid shape:", zone_data.shape)

    if np.all(np.isnan(zone_data)):
        print("No valid rainfall values found.")
    else:
        print(
            "Minimum:",
            np.nanmin(zone_data),
            "mm/hr"
        )

        print(
            "Maximum:",
            np.nanmax(zone_data),
            "mm/hr"
        )

        print(
            "Average:",
            np.nanmean(zone_data),
            "mm/hr"
        )

        print(
            "Valid grid cells:",
            np.sum(~np.isnan(zone_data))
        )

print("\nDONE!")