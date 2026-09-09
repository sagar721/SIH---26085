import gzip
import numpy as np

FILE = r"D:\SIH26085\data\raw\rainfall\gsmap\gsmap_gauge.20260906.1200.dat.gz"

with gzip.open(FILE, "rb") as f:
    rainfall = np.frombuffer(f.read(), dtype="<f4").copy()

rainfall = rainfall.reshape((1200, 3600))

# -99 = missing/invalid data
rainfall[rainfall < 0] = np.nan

print("SUCCESS!")
print("Grid shape:", rainfall.shape)
print("Minimum rainfall:", np.nanmin(rainfall), "mm/hr")
print("Maximum rainfall:", np.nanmax(rainfall), "mm/hr")
print("Average rainfall:", np.nanmean(rainfall), "mm/hr")