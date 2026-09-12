"""One-off: search real CDSE Sentinel-1 IW GRD scenes over the Kurla-Sion AOI
around real, documented Mumbai flood-event dates (from mumbai_ifi_events.json)
so a single event+scene pair can be picked for a time-boxed validation
attempt. Prints results; does not download or process anything."""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger
from sentinel1_validation import get_access_token, search_scenes

log = get_logger("sentinel1_search_events")

KURLA_SION_BBOX = (72.8527, 19.0510, 72.9027, 19.1010)


def main():
    token, reason = get_access_token()
    if not token:
        print(f"AUTH FAILED: {reason}")
        return
    print("Auth OK.\n")

    with open(DATA_ROOT / "raw" / "validation" / "mumbai_ifi_events.json", encoding="utf-8") as f:
        events = json.load(f)

    recent = [e for e in events if e.get("start_date") and int(e["start_date"][6:10]) >= 2015]
    recent.sort(key=lambda e: e["start_date"], reverse=True)

    checked = 0
    for e in recent:
        if checked >= 8:
            break
        d = datetime.strptime(e["start_date"], "%d-%m-%Y %H:%M")
        date_from = (d - timedelta(days=3)).strftime("%Y-%m-%d")
        date_to = (d + timedelta(days=3)).strftime("%Y-%m-%d")
        try:
            scenes = search_scenes(token, KURLA_SION_BBOX, date_from, date_to)
        except Exception as ex:
            print(f"{e['start_date']}: SEARCH ERROR {ex}")
            continue
        checked += 1
        print(f"Event {e['start_date']} (fatalities={e.get('human_fatality')}): {len(scenes)} scene(s) within +/-3 days")
        for s in scenes:
            print(f"    {s['sensing_date']}  {s['name']}  id={s['id']}")


if __name__ == "__main__":
    main()
