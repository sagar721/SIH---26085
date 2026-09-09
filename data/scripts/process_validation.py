"""Extracts Mumbai-relevant events from the real India Flood Inventory v3
CSV (downloaded by download_validation.py from Zenodo record 11275211).

Distinguishes two honestly-different categories, since the raw "Districts"
field lists every district affected by a statewide event:
  - mumbai_specific: the district list is short and centers on Mumbai
    (a genuinely localized Mumbai flood, not incidental inclusion)
  - maharashtra_regional: Mumbai is one of many (sometimes 50+) districts
    listed for a broad state/national event — real context, but NOT a
    Mumbai-specific flood record and must not be presented as one.
"""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("process_validation")

RAW_CSV = DATA_ROOT / "raw" / "validation" / "India_Flood_Inventory_v3.csv"
MUMBAI_DISTRICT_NAMES = {"mumbai", "mumbai city", "mumbai suburban", "greater mumbai"}


def classify(districts_str: str) -> str | None:
    if not isinstance(districts_str, str) or "mumbai" not in districts_str.lower():
        return None
    parts = [p.strip().lower() for p in districts_str.split(",")]
    # "specific" if Mumbai is one of very few districts named (a localized event)
    return "mumbai_specific" if len(parts) <= 3 and any(p in MUMBAI_DISTRICT_NAMES for p in parts) else "maharashtra_regional"


def main():
    if not RAW_CSV.exists():
        log.error(f"BLOCKED: {RAW_CSV} not found — run download_validation.py first.")
        sys.exit(2)

    df = pd.read_csv(RAW_CSV, encoding="utf-8", low_memory=False)
    log.info(f"Loaded {len(df)} total India Flood Inventory events")

    df["_category"] = df["Districts"].apply(classify)
    mumbai_df = df[df["_category"].notna()].copy()
    log.info(f"Mumbai-relevant events: {len(mumbai_df)} "
             f"({(mumbai_df['_category'] == 'mumbai_specific').sum()} specific, "
             f"{(mumbai_df['_category'] == 'maharashtra_regional').sum()} regional)")

    events = []
    for _, row in mumbai_df.iterrows():
        events.append({
            "event_id": row.get("UEI"),
            "start_date": row.get("Start Date"),
            "end_date": row.get("End Date"),
            "duration_days": row.get("Duration(Days)") if pd.notna(row.get("Duration(Days)")) else None,
            "category": row["_category"],
            "severity": row.get("Severity") if pd.notna(row.get("Severity")) else None,
            "human_fatality": row.get("Human fatality") if pd.notna(row.get("Human fatality")) else None,
            "human_displaced": row.get("Human Displaced") if pd.notna(row.get("Human Displaced")) else None,
            "source": row.get("Event Source"),
            "location": row.get("Location") if pd.notna(row.get("Location")) else "Mumbai (Maharashtra)",
        })

    # Most recent / most specific first
    events.sort(key=lambda e: (e["category"] != "mumbai_specific", str(e["start_date"])), reverse=False)

    out = {
        "source": "India Flood Inventory v3 (Zenodo 11275211)",
        "total_national_events": len(df),
        "mumbai_relevant_events": len(events),
        "note": "mumbai_specific = Mumbai is one of at most 3 named districts (a localized event). "
                "maharashtra_regional = Mumbai is one of many districts in a broad state/national event — "
                "real context, not a Mumbai-specific flood record.",
        "events": events,
        "generated_at": now_iso(),
    }

    out_dir = DATA_ROOT / "processed" / "validation"
    out_dir.mkdir(parents=True, exist_ok=True)
    write_json(out_dir / "mumbai_flood_events.json", out, log)
    # Also drop a copy where download_validation.py's status file expects it, for the frontend copy step
    write_json(DATA_ROOT / "raw" / "validation" / "mumbai_ifi_events.json", events, log)
    log.info("Done.")


if __name__ == "__main__":
    main()
