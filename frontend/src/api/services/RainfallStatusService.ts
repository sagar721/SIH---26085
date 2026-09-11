export interface RainfallRefreshStatus {
  last_updated_utc: string;
  source: string;
  latest_data_timestamp_utc: string | null;
  data_age_hours: number | null;
  status: 'ok' | 'warning';
  message: string;
  new_files_downloaded: number;
}

class RainfallStatusService {
  /** Always a fresh fetch (no-store) — this file changes on disk between
   * polls without a new URL, so a cached response would show a stale
   * refresh status forever. Small file, cheap to re-fetch. */
  async fetchStatus(): Promise<RainfallRefreshStatus | null> {
    try {
      const res = await fetch('/data/rainfall/rainfall_refresh_status.json', { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as RainfallRefreshStatus;
    } catch {
      return null;
    }
  }
}

export const rainfallStatusService = new RainfallStatusService();
