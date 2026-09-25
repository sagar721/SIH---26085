// Client-side export helpers: CSV, GeoJSON, and a print-friendly summary
// report. No backend — everything is built from data already loaded in the
// browser and downloaded via a Blob object URL.
import type { FeatureCollection } from 'geojson';

function downloadBlob(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(rows.reduce((set, r) => {
    Object.keys(r).forEach((k) => set.add(k));
    return set;
  }, new Set<string>()));
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  downloadBlob(filename.endsWith('.csv') ? filename : `${filename}.csv`, rowsToCSV(rows), 'text/csv;charset=utf-8');
}

export function downloadGeoJSON(filename: string, fc: FeatureCollection) {
  downloadBlob(filename.endsWith('.geojson') ? filename : `${filename}.geojson`, JSON.stringify(fc, null, 2), 'application/geo+json');
}

// Flattens a FeatureCollection's properties (+ a geometry summary column)
// into CSV rows — used for exporting roads/infra risk data as a spreadsheet.
export function featureCollectionToCSVRows(fc: FeatureCollection): Record<string, unknown>[] {
  return fc.features.map((f) => {
    const geomSummary = f.geometry.type === 'Point'
      ? `${(f.geometry.coordinates as [number, number])[0].toFixed(6)},${(f.geometry.coordinates as [number, number])[1].toFixed(6)}`
      : f.geometry.type;
    return { ...f.properties, geometry: geomSummary };
  });
}

export interface SummaryReportData {
  zoneName: string;
  generatedAt: string;
  realRainfallMmHr: number;
  effectiveRainfallMmHr: number;
  scenarioActive: boolean;
  zoneSeverity: { score: number; label: string };
  roadImpact: { count: number; highRiskCount: number; meanAdjustedRisk: number };
  infraExposure: { count: number; highRiskCount: number; weightedMeanAdjustedRisk: number };
  affectedAreaKm2: number;
  affectedRoadsCount: number;
  affectedAssetsCount: number;
}

// Opens a new window with a formatted, print-ready summary and triggers the
// browser print dialog — the closest a static SPA can get to a "report"
// without a server-side PDF pipeline. Every figure is labeled with its
// provenance tier so the printed page carries the same honesty rules as the UI.
export function openPrintSummaryReport(data: SummaryReportData) {
  const win = window.open('', '_blank', 'width=800,height=1000');
  if (!win) return;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>FLOODCAST Summary Report — ${data.zoneName}</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; color: #111; padding: 32px; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 12px; margin-bottom: 24px; }
  .section { margin-bottom: 20px; }
  .section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #444; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 5px 0; border-bottom: 1px solid #eee; }
  td.label { color: #555; width: 60%; }
  td.value { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 8px; border: 1px solid #999; color: #555; margin-left: 6px; }
  .disclaimer { font-size: 11px; color: #777; background: #f7f7f7; border-radius: 6px; padding: 10px 12px; margin-top: 24px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>FLOODCAST Summary Report</h1>
  <p class="subtitle">${data.zoneName} &middot; Generated ${data.generatedAt}</p>

  <div class="section">
    <h2>Current Conditions</h2>
    <table>
      <tr><td class="label">Real rainfall intensity <span class="badge">OBSERVED</span></td><td class="value">${data.realRainfallMmHr.toFixed(1)} mm/h</td></tr>
      ${data.scenarioActive ? `<tr><td class="label">Scenario rainfall driving this report <span class="badge">SIMULATED</span></td><td class="value">${data.effectiveRainfallMmHr.toFixed(1)} mm/h</td></tr>` : ''}
      <tr><td class="label">Zone flood severity <span class="badge">MODELLED</span></td><td class="value">${data.zoneSeverity.label} (${data.zoneSeverity.score.toFixed(2)})</td></tr>
      <tr><td class="label">Affected area <span class="badge">SIMULATED</span></td><td class="value">${data.affectedAreaKm2.toFixed(2)} km&sup2;</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Road Impact <span class="badge">MODELLED</span></h2>
    <table>
      <tr><td class="label">Road segments scored</td><td class="value">${data.roadImpact.count}</td></tr>
      <tr><td class="label">High-risk segments (adjusted risk &gt; 0.5)</td><td class="value">${data.roadImpact.highRiskCount}</td></tr>
      <tr><td class="label">Mean rainfall-adjusted risk</td><td class="value">${data.roadImpact.meanAdjustedRisk.toFixed(3)}</td></tr>
      <tr><td class="label">Flood-affected segments <span class="badge">SIMULATED</span></td><td class="value">${data.affectedRoadsCount}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Infrastructure Exposure <span class="badge">MODELLED, criticality-weighted</span></h2>
    <table>
      <tr><td class="label">Assets scored</td><td class="value">${data.infraExposure.count}</td></tr>
      <tr><td class="label">High-risk assets (adjusted risk &gt; 0.5)</td><td class="value">${data.infraExposure.highRiskCount}</td></tr>
      <tr><td class="label">Weighted mean adjusted risk</td><td class="value">${data.infraExposure.weightedMeanAdjustedRisk.toFixed(3)}</td></tr>
      <tr><td class="label">Currently flagged assets <span class="badge">SIMULATED</span></td><td class="value">${data.affectedAssetsCount}</td></tr>
    </table>
  </div>

  <p class="disclaimer">
    This report combines OBSERVED real-time rainfall (JAXA GSMaP) with a MODELLED, DEM-derived susceptibility index
    and a SIMULATED flood-depth proxy. It has not been calibrated or validated against any observed flood extent.
    No accuracy metric (IoU, F1, or otherwise) is claimed. See the Methodology panel in FLOODCAST for full provenance.
  </p>

  <script>window.onload = () => setTimeout(() => window.print(), 200);</script>
</body>
</html>`;

  win.document.write(html);
  win.document.close();
}
