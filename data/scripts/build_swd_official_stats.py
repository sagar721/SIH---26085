"""Digitizes REAL, OFFICIAL, published aggregate statistics from MCGM's own
Chief Engineer (Storm Water Drains) RTI Manual (data/raw/drainage/mcgm_swd_rti_manual.pdf,
downloaded from portal.mcgm.gov.in during the Priority-1/6 drainage
investigation). These are city/region-level TOTALS transcribed verbatim from
an official government publication — NOT geometry, NOT coordinates, and NOT
a substitute for the (still unavailable) spatial pipe/manhole network. Every
number here is directly citable back to the source PDF page.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("build_swd_official_stats")


def main():
    stats = {
        "title": "MCGM Storm Water Drainage (SWD) System — Official Aggregate Statistics",
        "status": "OFFICIAL",
        "geometry": "NONE — these are city/region-level totals, not spatial features. "
                    "Do not treat as, or convert into, point/line geometry.",
        "source": "Chief Engineer (Storm Water Drains) Department, MCGM — RTI Manual, Chapter 1",
        "source_url": "https://portal.mcgm.gov.in/irj/go/km/docs/documents/MCGM%20Department%20List/"
                       "Chief%20Engineer%20(Storm%20Water%20Drains)/RTI%20Manuals/Ch%20Engineer_SWD_RTI_E01.pdf",
        "local_copy": "data/raw/drainage/mcgm_swd_rti_manual.pdf",
        "department": {
            "name": "Chief Engineer (Storm Water Drains)",
            "administrative_jurisdiction": "Director (Engineering Services & Projects) and Additional Municipal "
                                            "Commissioner (City)",
            "legal_basis": "Section 61(a) and Sections 220-239 of the Mumbai Municipal Corporation Act, 1888",
            "established": "November 1993 (as a separate department, per BRIMSTOWAD recommendation)",
            "regional_sub_units": [
                "Dy.Ch.E. (S.W.D.) O&M", "Dy.Ch.E. (S.W.D.) City",
                "Dy.Ch.E. (S.W.D.) E.S. [Eastern Suburbs]", "Dy.Ch.E. (S.W.D.) W.S. [Western Suburbs]",
                "Dy.Ch.E. (S.W.D.) O&M (Mech.) — underground closed-drain maintenance in City area",
            ],
        },
        "area_covered_sq_km": 437.71,
        "drain_and_nalla_lengths_km": {
            "note": "Rows = City / Eastern Suburbs / Western Suburbs / Total, as published",
            "major_nalla_width_gt_1_5m": {"city": 8.545, "eastern": 90.200, "western": 101.509, "total": 200.254},
            "minor_nalla_width_lt_1_5m": {"city": 20.762, "eastern": 66.400, "western": 42.104, "total": 129.266},
            "arch_box_drains": {"city": 59.20, "eastern": 40.00, "western": 51.93, "total": 151.13},
            "roadside_open_drain": {"city": 20.00, "eastern": 669.48, "western": 1297.50, "total": 1986.98},
            "closed_pipe_or_dhapa_drains": {"city": 443.180, "eastern": 36.20, "western": 86.03, "total": 565.41},
        },
        "water_entrances_count": {"city": 27893, "eastern": 609, "western": 1706, "total": 30208},
        "outfalls_by_discharge_point": {
            "arabian_sea": {"city": 107, "western": 29, "eastern": 0, "total": 136},
            "mahim_creek": {"city": 4, "western": 14, "eastern": 8, "total": 26},
            "mahul_creek": {"city": 4, "western": 0, "eastern": 6, "total": 10},
            "thane_creek": {"city": 0, "western": 0, "eastern": 14, "total": 14},
            "grand_total_outfalls": 186,
        },
        "design_criteria": {
            "original_1985": "25 mm/hour rainfall intensity, runoff coefficient 0.5",
            "post_brimstowad_1993": "50 mm/hour rainfall intensity, runoff coefficient 1.0",
            "hydraulic_model_used": "WALLRUS (Hydraulics Research, UK)",
            "adopted_design_return_period": "2-in-1-year (per BRIMSTOWAD economic analysis)",
        },
        "brimstowad_history": {
            "consultant": "Watson Hawksley International Pvt. Ltd. (UK) with Associated Industrial Consultants (India) Pvt. Ltd.",
            "appointed_year": 1989,
            "report_year": 1993,
            "catchments_surveyed": 121,
            "estimated_cost_1991_92_crores": 616.30,
            "actually_completed_within_10_years_crores": 260,
            "reasons_incomplete": "non-availability of saltpan land, traffic diversion problems, encroachment, shortage of funds",
        },
        "honesty_note": "This is OFFICIAL published context (department structure, legal basis, city-wide "
                        "aggregate lengths/counts, historical BRIMSTOWAD facts) — it is NOT a spatial dataset. "
                        "It must never be rendered as map geometry or presented as equivalent to the (still "
                        "UNAVAILABLE) official pipe/manhole GIS network.",
        "generated_at": now_iso(),
    }

    out = DATA_ROOT / "processed" / "drainage" / "mcgm_swd_official_statistics.json"
    write_json(out, stats, log)
    log.info("Digitized official SWD aggregate statistics from the RTI manual (non-spatial).")


if __name__ == "__main__":
    main()
