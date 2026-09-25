# Hydrologic & Hydraulic Modeling Specification

## 1. Surface Runoff: The Rational Method

Discharge $Q$ is computed using the physically consistent metric formulation:

$$Q = 0.00278 \cdot C \cdot I \cdot A$$

Where:
- $Q$: Peak stormwater discharge in cubic meters per second ($\text{m}^3/\text{s}$).
- $C$: Dimensionless runoff coefficient ($0.0 \le C \le 1.0$, default $0.75$ for urban Mumbai).
- $I$: Rainfall intensity in millimeters per hour ($\text{mm/hr}$).
- $A$: Catchment area in metric hectares ($\text{ha}$).

*(Note: The $0.278$ factor is used when area is in $\text{km}^2$; with hectares ($1\text{ ha} = 0.01\text{ km}^2$), the factor is $0.00278$).*

---

## 2. Drainage Overflow Formulation

Surface ponding overflow is calculated as the positive residual between runoff rate and drainage conveyance capacity:

$$Q_{\text{overflow}} = \max(Q_{\text{runoff}} - Q_{\text{drain\_capacity}}, 0.0)$$

Utilization Ratio:

$$\text{Utilization} = \frac{Q_{\text{runoff}}}{Q_{\text{drain\_capacity}}}$$

- Normal: $\text{Utilization} \le 0.70$
- Stressed: $0.70 < \text{Utilization} \le 1.00$
- Overloaded: $1.00 < \text{Utilization} \le 1.30$
- Critical: $\text{Utilization} > 1.30$

---

## 3. Local-Inertial 2D Overland Flow (`app/simulation/inundation.py`)

Accumulated excess water volume over time step $\Delta t$:

$$V_{\text{excess}} = Q_{\text{overflow}} \cdot \Delta t \quad (\text{m}^3)$$

Rather than redistributing this volume in one shot by a static depression-susceptibility weight, the solver advances a **local-inertial finite-volume shallow-water approximation** over the analysis grid in substeps (≤10s each):

- **Source injection**: excess volume enters the grid at the cells nearest the real drainage/outfall/manhole point locations (`source_cell_ids`) — not spread uniformly across the whole grid — so surcharging water enters the terrain where the drainage network's real outfalls actually are.
- **Inter-cell transfer**: for each pair of neighboring cells, a discharge is computed from the head difference (elevation + water depth) between them, `discharge = width × mean_depth × sqrt(g × mean_depth) × head_difference / distance`, and the corresponding volume moves from the higher-head cell to the lower one each substep.
- **Tidal boundary**: cells on the grid boundary exchange volume with a configurable tidal stage (`TIDAL_STAGE_M`), both inflow (stage rising above local elevation) and outflow (excess head draining back to the boundary).
- **Mass balance**: `final_volume - (initial_volume + source_volume + tidal_inflow - boundary_outflow)` is computed and reported every run as `mass_balance_error_m3` — a real internal-consistency check, not a hydraulic-accuracy claim (this is still a prototype solver, not a certified Saint-Venant model).

Road/infrastructure impact then comes from real Shapely `LineString`/`Polygon` geometric intersection between the flooded cells and the actual OSM road/BMC infrastructure geometry, along the segment's full length (reporting `affected_length_ratio`) — not a single sampled point.
