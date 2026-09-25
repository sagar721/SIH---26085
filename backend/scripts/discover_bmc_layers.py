import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import httpx

# Add backend directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from app.core.config import settings

OUTPUT_FILE = BASE_DIR / "data" / "processed" / "bmc_discovered_layers.json"


def discover_bmc_layers():
    url = settings.BMC_GIS_URL
    print(f"Connecting to BMC GIS MapServer: {url}")

    headers = {"User-Agent": "M-FLOOD-Nowcaster/0.1"}
    try:
        with httpx.Client(timeout=15.0, headers=headers) as client:
            resp = client.get(f"{url}?f=pjson")
            if resp.status_code != 200:
                print(f"Failed to fetch BMC metadata: HTTP {resp.status_code}")
                return False

            data = resp.json()
            layers = data.get("layers", [])
            print(f"Discovered {len(layers)} total layers from BMC GIS MapServer.")

            target_keywords = [
                "drain", "storm", "manhole", "flood", "sensor", "road",
                "water", "hospital", "police", "fire", "river", "nullah", "culvert"
            ]

            matched_layers = []
            for layer in layers:
                name = layer.get("name", "")
                layer_id = layer.get("id")
                name_lower = name.lower()

                if any(kw in name_lower for kw in target_keywords):
                    matched_layers.append({
                        "id": layer_id,
                        "name": name,
                        "parentLayerId": layer.get("parentLayerId"),
                        "minScale": layer.get("minScale"),
                        "maxScale": layer.get("maxScale"),
                    })
                    print(f"  -> Found Layer [{layer_id}]: {name}")

            # Inspect fields for the key matched layers (first 10 key layers)
            detailed_layers = []
            for m in matched_layers[:15]:
                try:
                    ld_resp = client.get(f"{url}/{m['id']}?f=pjson", timeout=5.0)
                    if ld_resp.status_code == 200:
                        ld = ld_resp.json()
                        m["geometryType"] = ld.get("geometryType")
                        m["fields"] = [
                            {"name": f.get("name"), "type": f.get("type"), "alias": f.get("alias")}
                            for f in ld.get("fields", [])
                        ]
                    detailed_layers.append(m)
                except Exception as e:
                    detailed_layers.append(m)

            discovery_result = {
                "source_url": url,
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "total_layers_found": len(layers),
                "matched_layers_count": len(matched_layers),
                "layers": detailed_layers
            }

            OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump(discovery_result, f, indent=2)

            print(f"Saved discovery result with {len(matched_layers)} relevant layers to: {OUTPUT_FILE}")
            return True

    except Exception as e:
        print(f"Discovery error: {e}")
        return False


if __name__ == "__main__":
    success = discover_bmc_layers()
    sys.exit(0 if success else 1)
