"""Fail closed until a validated DEM download/ingestion workflow is configured."""
import sys


def main() -> int:
    print("UNAVAILABLE: no validated Copernicus DEM ingestion adapter is configured.")
    print("No output is created; synthetic elevation values are prohibited.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
