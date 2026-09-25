# Model Assumptions & Prototype Classifications

1. **Urban Runoff Coefficient**: Set to $C = 0.75$ representing dense asphalt, concrete, and high-density informal settlements across Mumbai's Kurla and BKC catchment.
2. **Sub-catchment Drainage Removal**: Total drainage conveyance capacity is summed from real per-segment `capacity_m3s` attributes when the ingested GIS drain layer provides them; only when no source attributes exist at all does the system fall back to the explicitly-configured `DRAINAGE_OUTFALL_CAPACITY_M3S` environment variable. There is no hardcoded capacity constant — a simulation run raises an error rather than silently assuming a number if neither source is available.
3. **Terrain Elevation**: Documented topographic profile slopes from $15.0\text{m}$ ASL in the north-east down to $2.0\text{m}$ ASL near Mahim Bay and creek outlets.
4. **Manning Roughness**: Concrete lined storm drains assume $n = 0.015$ where field pipe roughness is unmeasured.
5. **Passenger Vehicle Cutoff**: Roads with simulated water depths $\ge 0.30\text{m}$ are assumed completely impassable for standard passenger vehicles and severed from routing graphs.
