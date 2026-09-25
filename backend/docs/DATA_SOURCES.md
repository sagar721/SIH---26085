# Data Sources & Ingestion Catalog

| Provider | Dataset | Type | Coverage | Ingestion Path | Attribution |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Open-Meteo** | GFS/ECMWF Seamless Forecast | `FORECAST` | Global / Mumbai Study Area | Live HTTP API (`/v1/forecast`) | Open-Meteo.com (CC-BY 4.0) |
| **Brihanmumbai Municipal Corporation (BMC)** | Storm Water Drains, Manholes, Flooding Spots, Critical Infra | `STATIC_GIS` | Greater Mumbai / Kurla-BKC Corridor | ArcGIS REST MapServer export to GeoJSON | Municipal Corporation of Greater Mumbai (MCGM) |
| **OpenStreetMap** | Roads (`highway=*`), Waterways (`waterway=*`), Buildings | `STATIC_GIS` | Mithi River Study Basin | Overpass API / osm2geojson | OpenStreetMap contributors (ODbL) |
| **Tomorrow.io** | Precipitation Nowcast | `NOWCAST` | Mumbai Point / Bounding Box | Live HTTP API (Requires `TOMORROW_API_KEY`) | Tomorrow.io API |
| **IMD** | Radar & Station Rainfall | `OBSERVED` | Mumbai Santacruz & Colaba | Live HTTP API (Requires `IMD_API_KEY`) | India Meteorological Department |
| **NASA GPM** | IMERG Half-Hourly Rain Rates | `SATELLITE_ESTIMATE` | Global 0.1° Gridded | NASA Earthdata Cloud API | NASA GES DISC |
| **Copernicus** | GLO-30 Global DSM | `STATIC_GIS` / `ASSUMED_FOR_PROTOTYPE` | Mumbai Catchment | GeoTIFF / Documented basin profile | European Space Agency (ESA) |

---

## Data Integrity Rules
- Live providers failing return explicit `UNAVAILABLE` or `NOT_CONFIGURED` without mock substitution.
- Stale cached responses are tagged `cached: True` with explicit `cache_timestamp`.
