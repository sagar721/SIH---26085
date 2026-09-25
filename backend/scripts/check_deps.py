import sys

packages = [
    ("fastapi", "fastapi"),
    ("uvicorn[standard]", "uvicorn"),
    ("pydantic", "pydantic"),
    ("pydantic-settings", "pydantic_settings"),
    ("python-dotenv", "dotenv"),
    ("httpx", "httpx"),
    ("sqlalchemy", "sqlalchemy"),
    ("geoalchemy2", "geoalchemy2"),
    ("psycopg[binary]", "psycopg"),
    ("geopandas", "geopandas"),
    ("shapely", "shapely"),
    ("rasterio", "rasterio"),
    ("pyproj", "pyproj"),
    ("numpy", "numpy"),
    ("pandas", "pandas"),
    ("networkx", "networkx"),
    ("pytest", "pytest"),
]

print(f"{'Package':<22} | {'Import Module':<20} | {'Status':<8} | {'Version':<16}")
print("-" * 75)

all_ok = True
for pkg, mod_name in packages:
    try:
        mod = __import__(mod_name)
        ver = getattr(mod, "__version__", "Installed")
        print(f"{pkg:<22} | {mod_name:<20} | {'OK':<8} | {str(ver):<16}")
    except Exception as e:
        all_ok = False
        print(f"{pkg:<22} | {mod_name:<20} | {'FAILED':<8} | {str(e):<16}")

if all_ok:
    print("\nAll 17 packages verified successfully!")
else:
    print("\nSome packages failed verification.")
    sys.exit(1)
