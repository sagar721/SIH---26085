# FLOODWATCH V3 — Command Center Redesign Specification

## 0. What this document is, and isn't

This is the full UX strategy, information architecture, screen-by-screen specification, and design system for the redesign you described. A companion interactive artifact shows the three highest-value screens (Pilot Zone Command View, Mumbai Overview, Citizen Mobile View) plus the design-system sheet at high fidelity — that stands in for Figma, which this medium can't produce natively.

Two things are **deliberately out of scope here**, on your own instruction:

- **The 3D digital-twin engine choice** (MapLibre 3D buildings vs. deck.gl vs. CesiumJS). You said you'd rather see the design intent first and decide the engine after. Section 5 specifies exactly what the pilot-zone view must show; it does not commit to how.
- **Rebuilding the simulation system.** Every simulation described here — rainfall scenario multiplier, drainage blockage, flood-depth proxy, road/infra risk scoring, flood-aware routing, timeline playback — already exists and works in the current codebase (`useSimulationStore`, `riskModel.ts`, `routingEngine.ts`, `MockAdapter`). This redesign repositions and surfaces that engine inside a new IA; it does not propose a new one. Where the visual mockups show a number (65mm/hr, 40% coverage, a 356K population figure), those are illustrative placeholders in the pinned reference aesthetic, not new computed quantities — every one of them maps to a real field already computed somewhere in the current app, listed inline below.

---

## 1. Design thesis

**"Mission Control for Urban Flood Management."** Not a map with layers, not a GIS tool, not a hackathon dashboard. The test for every screen in this spec: a person under time pressure should be able to answer *what's happening, why, what's affected, what to do, and how sure we are* — in that order, before they touch a single control.

The current build already computes all five of those things (`riskSummary`, `zoneSeverity`, `roadImpact`/`infraExposure`, `computeRoutes`, and the OBSERVED/MODELLED/SIMULATED provenance tiers respectively). It just never says them in a sentence. V3's entire job is to say them in a sentence, first, and let the map and the charts back that sentence up — not the other way around.

---

## 2. Information architecture

### 2.1 The workflow spine

Every pilot-zone screen is organized top-to-bottom as **Situation → Impact → Response → Recovery**, matching the left-rail "Decision Flow" nav in the pinned reference:

| Rail item | Answers | Backed by (existing code) |
|---|---|---|
| **Situation** | What's happening right now, and how fast is it developing? | `effectiveRainfallMmHr`, `zoneSeverity`, `riskSummary.overallRisk`, the Snapshot/data-age badges |
| **Impact** | What's affected — roads, assets, people? | `roadImpact`, `infraExposure`, `affectedAssets`, `affectedRoads`, `affectedAreaKm2` |
| **Response & Routing** | How do people and vehicles move safely? | `computeRoutes` (fastest/safest/balanced), `AvoidedRoad` reasons |
| **Simulation** | What if conditions change? | `scenarioMultiplier`, `drainageBlockage`, the timeline scrubber |

A second rail group, **Reference**, holds the credibility material this project's whole identity is built on — Methodology & Evidence, Data Provenance, Validation Log — one click away, never in the primary flow. This is a direct continuation of the UX audit already done this session (`UX_INFORMATION_AUDIT.md`): those four modals were already classified IMPORTANT-not-CORE; V3 just gives that classification a permanent visual home (a rail section) instead of four equal-weight buttons in a top bar.

### 2.2 Two orthogonal switches, not four separate apps

The brief asks for Mumbai Overview vs. Pilot Zone, and Command vs. Citizen. These are **two independent axes**, not four screens to design separately:

```
                    COMMAND                    CITIZEN
              ┌─────────────────────┬─────────────────────┐
   MUMBAI     │ City-wide risk       │ "Is my area safe     │
   OVERVIEW   │ board, 2D, ward-     │  right now?" — one   │
              │ level, multi-zone    │  glance, one action  │
              ├─────────────────────┼─────────────────────┤
   PILOT      │ Full digital-twin    │ "Can I travel? Where │
   ZONE       │ decision console     │  do I go?" — safe    │
              │ (this spec's core)   │  route + shelters    │
              └─────────────────────┴─────────────────────┘
```

Command and Citizen share the same underlying data and the same zone selector — Citizen is not a separate app, it's the same state filtered down to four questions and rendered mobile-first. This matters for implementation: the toggle changes *what's rendered*, not *what's fetched*.

### 2.3 Top-level chrome (every Command screen)

Reading left to right, matching the pinned reference exactly:

1. **Identity** — mark + "FLOODWATCH" + agency subtitle ("MoES · Urban Flood Intelligence" or your actual sponsoring-body line).
2. **Stage pill** — a single, always-present sentence-length status: `Stage 2 · Moderate — Kurla-Sion corridor at risk`. This is new: today the app has an Overall Risk badge but no city-wide "stage" concept. It should be the single worst `zoneSeverity`/`riskSummary.overallRisk` across whichever zones are in scope, phrased as one sentence — the first thing anyone reads.
3. **Pilot Zone chip** — current zone + its area, matching `PILOT_ZONES` already in `types.ts`.
4. **Command / Citizen segmented toggle.**
5. **Clock + Nowcast horizon + refresh cadence** — this replaces the current "Snapshot — NOT LIVE" amber badge's *position* but not its honesty: see §7 for how the two coexist without contradicting each other.

---

## 3. Screen: Mumbai Overview (Command, 2D)

Purpose per the brief: city-wide monitoring, kept deliberately 2D. This is a **new screen** — today's app has no city-wide view beyond the "overview" map mode, which just shows boundary/major-roads/water with no risk information layered on top.

**Layout:**
- Same chrome as §2.3, Stage pill computed across *all* zones with live data (today: the two pilot zones; designed to extend to more wards without a redesign).
- KPI strip: city-wide versions of the same five cards as the pilot-zone screen (§4.4) — rainfall (worst zone), flood coverage (sum), roads blocked (sum), critical assets at risk (sum), population exposed (sum) — every one a real aggregate over existing per-zone data, not a new model.
- Map: 2D, ward/pilot-zone boundaries colored by severity band (reusing the existing LOW/MODERATE/HIGH/SEVERE palette), pilot zones shown as clickable hotspots that transition into the Pilot Zone screen on click — this is the one navigation action that crosses the two screens.
- **Weather layer** (your idea, and a genuinely good scope boundary): a real weather/radar API (IMD, OpenWeatherMap, or a satellite radar tile service) rendered as a translucent animated overlay — rainfall bands, storm cells — the "like news channels" treatment you described. This is explicitly **additive, real-data** context for the city outside the two pilot zones, and must carry its own provenance badge (OBSERVED, third-party) exactly like every other layer in this app. It is not a substitute for the GSMaP-driven pilot-zone model — the two coexist at different resolutions, which the UI should say plainly rather than let a user assume they're the same feed.
- Right rail: same Situation Brief pattern as §6, phrased city-wide ("Two zones showing elevated risk; Kurla-Sion is worse and trending up").

---

## 4. Screen: Pilot Zone Command View

This is the screen in your first reference image, and the one that should get the most design attention — it's where a real operator spends their time.

### 4.1 Situation strip (replaces nothing — this is new)

One sentence, largest text on the screen, auto-generated from real numbers (§6 defines exactly how): *"Rainfall of {effectiveRainfallMmHr} mm/hr exceeds {zone} drainage capacity in ~{time-to-threshold} min."* Below it, one line of confidence + method: *"Confidence {Medium/High} · GSMaP + DEM-derived flow · not validated against observed flood"* — this is a direct, permanent surfacing of the honesty line this project already insists on everywhere else, just promoted to the most-read spot on the page instead of buried in a modal footer.

### 4.2 The "time-to-threshold" number is new — flag it honestly

The reference mockup's headline commits to a specific claim the current codebase does not yet compute: minutes until rainfall exceeds capacity. This is a genuinely valuable number, and it's a small addition, not a new model — `computeBaseDepthMeters`'s existing `capacity`/`excess` math (in `MockAdapter.ts`) already knows the gap between current effective rainfall and capacity; projecting it forward using the existing timeline's rainfall trajectory to find the crossing point is an extrapolation of an existing formula, not a new one. It must carry the same MODELLED/SIMULATED provenance as everything else it's built from, and must degrade honestly (a dash and "insufficient trend data," never a fabricated number) when the trend doesn't support an estimate.

### 4.3 KPI strip

Five cards, each mapped to a real, already-computed field:

| Card | Existing source |
|---|---|
| Rainfall Intensity | `effectiveRainfallMmHr` (+ real delta since last timeline tick) |
| Flood Coverage | `affectedAreaKm2` ÷ zone area, as % |
| Roads Blocked | count of `blocked` edges in `RoadGraph` ÷ `totalEdges` |
| Critical Assets | `affectedAssets.length` ÷ total infra count, with the CRITICAL subset called out |
| Population Exposed | **new** — not currently modelled. Needs a real population-density source (WorldPop or census ward data) intersected with the flood-extent polygon. Until that source is wired in, this card must show "Population data not yet integrated" rather than a placeholder number — the one card on this screen with no existing backing data, called out explicitly rather than quietly faked. |

Two actions sit at the end of the strip: **+ New scenario** (opens the existing Scenario Mode controls, relabeled and promoted from a buried sidebar slider) and **Brief NDRF & MCGM** (see §6.4 — generates the shareable version of the Situation Brief; this is new UI over existing data, not a new integration, since actually transmitting to NDRF/MCGM systems is the "no real alerting integration" gap already disclosed in `RESILIENCE_REPORT.md`).

### 4.4 Left rail — Decision Flow + Reference

Exactly the nav from §2.1. Badge counts (the small numbers next to "Impact," "11" in the reference) should be real — count of currently-affected assets/roads, not decorative.

### 4.5 Map stage

- **Base layer**: light, muted "Institutional" basemap — a deliberate move away from the current dark theme (see §8) for the reason the brief states directly: warm, high-legibility, low-drama reads as "trustworthy instrument," where a dark neon basemap reads as "hacker tool" regardless of what data is on it.
- **Layers panel**: same real 13-layer set already fixed in this session's clutter audit (`UX_INFORMATION_AUDIT.md`) — boundary, roads, buildings, water, landcover, infrastructure, rainfall, DEM, slope, inferred drainage, flood extent, susceptibility, plus the one disclosed-but-kept "Official Drainage (unavailable)" row — restyled with the OBS/INF/SIM/MODELLED provenance tags from `DataStatusBadge`, now shown as compact 3-letter chips instead of full words, matching the reference's `SIM`/`INF`/`OBS`/`OFF` chip style. No new layers are invented; "Safe corridor" and "At-risk roads" are the existing routing-engine output and flood-graph blocked-edge set, respectively, given their own toggle rather than being bundled invisibly into "roads."
- **Segment popup**: clicking a road segment shows exactly the fields `routingEngine.ts` already computes per edge — simulated depth, the fixed 0.3m impassable threshold, onset time (new, same time-to-threshold extrapolation as §4.2 but per-segment), and a confidence label. This is the single most information-dense, highest-trust moment on the map — get this card's typography and real-vs-modelled labeling right before anything else on this screen.
- **3D toggle** (top-right, next to the basemap selector): present as an affordance in this spec — clicking it is where the deferred 3D digital-twin engine plugs in later (§5). Until that engine is chosen and built, this screen ships and is fully usable in 2D; the toggle can ship disabled with a "Coming soon" state rather than block the rest of the redesign on a 3D decision.
- **Legend + system-status footer**: kept from the reference — simulated-depth gradient, line-style legend, and a real (not decorative — see the ENGINE:ONLINE removal earlier this session) ingest/model/sync status strip, sourced from the same `useDataHealthStore` + rainfall-refresh-status machinery already built.

### 4.6 Bottom dock — Scenario + Timeline, unified

Today these are two separate things: the Scenario Mode sliders (left sidebar) and the Simulation Timeline (bottom overlay). The reference design correctly treats them as one instrument: **"Active Scenario: Heavy Rain 65mm/hr sustained, drainage blockage 0%, duration 3h"** as a persistent summary line, with the existing play/pause/1x/2x/5x timeline scrubber directly below it, and a zone-severity sparkline across the scrubber (a cheap, high-value addition — it's just `zoneSeverity.score` at each timeline tick, already computed, never before charted inline with the scrubber itself).

### 4.7 Right rail — Situation Brief

Covered fully in §6; it is the single newest, highest-value piece of this redesign.

---

## 5. Screen: Pilot Zone Digital Twin (3D) — requirements, not implementation

Deferred engine choice notwithstanding, here is exactly what the 3D mode must show once built, so that whichever engine gets chosen (MapLibre GL 3D buildings/terrain, deck.gl, or CesiumJS) is scoped against the same requirements rather than three different visions:

1. **Buildings**: real OSM footprints already loaded (`{zone}_buildings.geojson`) extruded by a real height estimate (OSM `building:levels` where present, a reasonable per-type default elsewhere — never a fabricated exact height), colored by the same risk-band palette as everything else, not a separate 3D-only color scheme.
2. **Flood water**: animated, not static — depth from the existing `floodDepth`/blocked-edge data, water surface height interpolated between the current and next timeline tick so scrubbing feels continuous. This is a rendering technique over existing data, not a new hydraulic model.
3. **Rainfall visualization**: four discrete visual intensities (light / heavy / cloudburst / extreme) mapped directly from the existing `effectiveRainfallMmHr` bands already used for risk labeling — no new thresholds to invent.
4. **Infrastructure markers**: real points from `{zone}_infrastructure_risk.geojson`, rendered as 3D icons at building height, not floating at ground level regardless of the structure beneath them.
5. **Road conditions**: four states — open / congested (new: would need a real traffic-proxy or can be omitted honestly until one exists) / flooded (`blocked`) / part of the current safe corridor (`computeRoutes('safest')` path) — colored consistently with the 2D map, not a 3D-only palette.
6. **Routing overlay**: the three existing route modes rendered as 3D-draped lines, with the "roads avoided and why" list from the current `RoutingPanel` surfaced as a click target on the line itself.
7. **Timeline**: identical scrubber and playback state as the 2D dock (§4.6) — 3D is a camera/render mode on the same simulation state, never a separately-clocked view.

**Recommendation for the follow-up research task**: evaluate engines against these seven requirements specifically, plus one constraint the current stack imposes — the app already renders through MapLibre GL for the 2D case, so MapLibre's own 3D buildings/terrain extension is the lowest-integration-risk option and should be the first one ruled in or out before evaluating deck.gl or Cesium.

---

## 6. The AI Situation Brief

This is the single feature the brief describes that doesn't exist in any form today, and it's the one most likely to make a judge say "this understands the problem." Two design decisions matter more than the visual layout:

### 6.1 Deterministic generation, not a black-box model call

Given this project's entire identity is built on never asserting a number it can't trace back to a real source, the Situation Brief must be a **template-driven generator over real computed fields**, not a live LLM call synthesizing free text. Every sentence it produces should be assemblable, in the Methodology modal, back to the exact fields that produced it:

```
"Rainfall over {zone_a} and {zone_b} has {trend_phrase} since {time}.
 Terrain and drainage capacity suggest surface accumulation begins in
 ~{minutes} minutes along the {top_risk_road} corridor."

trend_phrase   ← real % change in effectiveRainfallMmHr over the last N timeline ticks
minutes        ← the §4.2 threshold-crossing extrapolation
top_risk_road  ← highest-riskFactor named road currently in the RoadGraph
```

This is more constrained than a generic LLM summary, and that constraint is the point: a constrained template can be *proven* correct against its inputs; a free-generation model cannot, and this project does not fabricate what it can't verify. If a genuinely free-text, more natural-sounding version is wanted later, it should be an LLM call that is *given* these exact pre-computed facts as its only allowed inputs and instructed never to introduce a number not present in them — a phrasing layer over the honest computation, not a replacement for it.

### 6.2 Recommended Action card

Same discipline: the action ("Activate 6 pumping stations," "Restrict non-essential traffic") must be derivable from a real rule over real state (e.g., pumping-station count from real MCGM drainage infrastructure points whose `capacity`/`current load` proxy crosses a threshold), not a generic canned message. Where the underlying rule doesn't exist yet (most of them don't, today), the card must say "Recommended action model not yet implemented" rather than show a plausible-sounding but fabricated recommendation — this is the highest-stakes place in the entire redesign for the project's honesty discipline to hold, precisely because it's the most persuasive-looking card on the screen.

### 6.3 Confidence, always

Every Situation Brief and every Recommended Action carries the same Low/Medium/High confidence label already established for the rainfall-adjusted risk model, computed from the same thing confidence has always meant in this app: how many of the inputs are OBSERVED/OFFICIAL vs. MODELLED/SIMULATED, and how stale the newest of them is (reusing the rainfall-refresh Data Age work already shipped this session).

### 6.4 "Brief NDRF & MCGM"

Produces a shareable, printable version of the current Situation Brief + Recommended Action + KPI snapshot — this is a real, valuable, low-effort feature: it's the existing `exportUtils.ts` print/export pattern (already used for the Right Panel's CSV/GeoJSON/print-summary) pointed at the new brief content instead of raw data. It is explicitly **not** a live transmission to any NDRF/MCGM system — that remains the disclosed communications-integration gap from `RESILIENCE_REPORT.md`, and the button's own label and confirmation text must say so ("Prepares a shareable brief — does not notify NDRF or MCGM automatically").

---

## 7. Reconciling "Nowcast T+0 · Refresh 30s" with "Snapshot — Not Live"

The reference top bar's clock reads "Nowcast T+0 · Refresh 30s," which implies live operation. The current, real state of this project is a fixed historical snapshot (per `RESILIENCE_REPORT.md` and the "Snapshot — NOT LIVE" badge built earlier this session) — that fact does not change just because the IA around it got better. **Both must be shown, and they must not contradict each other**:

- If the automatic rainfall refresh pipeline (shipped this session, `RAINFALL_AUTOMATION_ARCHITECTURE.md`) is live and healthy, "Nowcast T+0 · Refresh 30s" is honest and can be shown as-is, sourced from the real `rainfall_refresh_status.json` age.
- If it is not running, degraded, or the dataset is a fixed historical window (today's actual state), the clock area must instead read something like **"Snapshot — {date} · Not Live"**, exactly the existing badge, in exactly the existing amber, in the exact same position. The two are mutually exclusive states of the same UI slot, switched on the real `RainfallRefreshStatus`, never shown together and never softened to "mostly live."

This is the one place in the whole redesign where the pinned reference image's literal content (a live-looking clock) must be corrected against this project's own data, not copied — the visual position and treatment are exactly what the reference shows, filled with whichever of the two honest states actually applies.

---

## 8. Design system

Full token/type/component detail lives in the artifact's Design System tab; summarized here for reference:

**Palette** — warm parchment ground, navy authority accent, semantic status colors kept separate from the accent (per the "semantic color is not your accent" rule): `--bg #F3EFE4` (parchment), `--surface #FFFFFF`, `--ink #1C2333` (near-navy body text), `--navy #1F2A44` (brand/primary actions, selected states, "safe" semantics), `--amber #B9762E` (moderate/warning), `--red #B23B2E` (critical/blocked), `--green #3D7A5C` (observed/low-risk/safe-corridor).

**Type** — Source Serif 4 for the Situation headline and modal titles (the one place the page is *read* rather than scanned — a serif earns its place there and nowhere else); IBM Plex Sans for all UI chrome, labels, and body copy; IBM Plex Mono for every number that lines up in a column (KPI values, coordinates, timestamps, depth readings) — tabular figures throughout.

**Components** — status stage-pill, KPI tile, provenance chip (3-letter, color-coded), decision-flow rail item (with real badge count), situation-brief card, recommended-action card, layer-toggle row, route-mode segmented control, vulnerable-asset row (score + severity chip). Each is specified with real states (default/hover/active/disabled) in the artifact.

This is a deliberate, near-total departure from the current dark cyan-on-charcoal theme. That's intentional and matches the brief's own diagnosis: the current look reads as "GIS tool," the new one is built to read as "trusted instrument," and color is doing a large share of that work.

---

## 9. Clutter re-classification against the new IA

The clutter pass already done this session (`UX_INFORMATION_AUDIT.md`) classified panels against the *current* IA. Re-run against V3's Situation→Impact→Response→Recovery spine, three further consolidations fall out:

| Item | Old classification | V3 classification | Why |
|---|---|---|---|
| Analytics / Provenance / Validation / Methodology top-bar buttons | IMPORTANT, 4 equal-weight buttons | IMPORTANT, collapsed into the single "Reference" rail group | Same content, one less top-bar row competing with the Stage pill for first-glance attention |
| Scenario sliders + Timeline scrubber | Two separate always-visible surfaces | One unified bottom dock (§4.6) | They drive the same mental model ("what if / when") and were already adjacent; merging removes a seam, not content |
| Export buttons (Roads GeoJSON / Infra CSV / Print Summary) | OPTIONAL, always-visible in Right Panel | OPTIONAL, moved under "Brief NDRF & MCGM" as a secondary menu | Three low-frequency actions no longer compete for space with the new Situation Brief, which now owns the right rail |
| Population Exposed KPI | *(did not exist)* | **REMOVE until real population data is integrated** | See §4.4 — the one new card this spec proposes that has no real backing data yet; the honest move is to omit it, not fake it |

---

## 10. Phasing

1. **IA + visual system**, on the existing 2D map and existing data hooks: new chrome, rail, unified scenario/timeline dock, design-system restyle. No new data, no new engine — a restructuring of what's proven to already work. Highest value-to-effort ratio; should ship first.
2. **Situation Brief + Recommended Action**, deterministic template engine per §6, over existing computed fields. Second-highest value; still no new data source required.
3. **Mumbai Overview** (§3), including the real weather-API overlay — the one piece of this phase needing a new external integration decision (which API, licensing, rate limits).
4. **Pilot Zone 3D digital twin** (§5) — gated on the separate engine-feasibility research track you already planned to run before committing build time.

Citizen View (mobile) is not its own phase — it's a rendering mode of whichever data phase 1–3 already expose, and should ship alongside phase 1 since it's the smallest new surface (four cards + a list, per the pinned mobile reference) built entirely from data phase 1 already has.
