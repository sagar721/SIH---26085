# System Limitations & Disclaimers

1. **Hydrodynamic Fidelity**: The inundation engine is a 2.5D mass-balance topographic volume redistribution model. It is NOT a certified 2D shallow-water Navier-Stokes hydraulic solver.
2. **Road Obstructions**: Road impedances are derived purely from predicted water depths. Real-time traffic congestion or ad-hoc barricades are not tracked unless an external traffic provider is integrated.
3. **No Certified Warnings**: Operational alerts are classified as `System-generated derived flood-risk alerts` and must not be portrayed as official disaster management warnings from the MCGM or NDMA.
4. **Calibration not yet active**: `app/simulation/calibration.py` implements the Nash-Sutcliffe Efficiency / RMSE math needed to calibrate the model against real observed hydrographs, but no real hydrograph data source is wired to any live endpoint or worker yet — this is documented methodology awaiting real data, not an active calibration loop.
5. **Frontend Demo Mode is intentionally hypothetical, not backend output**: the frontend's "Demo Mode" (see `PROJECT_MASTER_DOCUMENTATION.md`) is a self-contained, deterministic client-side simulation for presentation purposes — it never calls this backend. Backend simulation runs (`SCENARIO`/`LIVE`/`FORECAST` mode via `/api/v1/simulation/run`) are a separate, real pipeline.
