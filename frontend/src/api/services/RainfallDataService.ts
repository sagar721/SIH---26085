export interface ProcessedRainfallRow {
  timestamp_utc: string;
  mumbai_center_mm_hr: number;
  
  kurla_sion_mean_mm_hr: number;
  kurla_sion_max_mm_hr: number;
  kurla_sion_accum_1h: number;
  kurla_sion_accum_3h: number;
  kurla_sion_accum_6h: number;
  kurla_sion_accum_24h: number;
  
  hindmata_dadar_mean_mm_hr: number;
  hindmata_dadar_max_mm_hr: number;
  hindmata_dadar_accum_1h: number;
  hindmata_dadar_accum_3h: number;
  hindmata_dadar_accum_6h: number;
  hindmata_dadar_accum_24h: number;
}

class RainfallDataService {
  private data: ProcessedRainfallRow[] | null = null;
  private loadPromise: Promise<ProcessedRainfallRow[]> | null = null;

  async loadData(): Promise<ProcessedRainfallRow[]> {
    if (this.data) return this.data;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = fetch('/data/rainfall/mumbai_processed_rainfall.csv')
      .then(res => res.text())
      .then(csv => {
        const lines = csv.trim().split('\n');
        
        const rows: ProcessedRainfallRow[] = lines.slice(1).map(line => {
          const values = line.split(',');
          return {
            timestamp_utc: values[0],
            mumbai_center_mm_hr: parseFloat(values[1]),
            
            kurla_sion_mean_mm_hr: parseFloat(values[2]),
            kurla_sion_max_mm_hr: parseFloat(values[3]),
            kurla_sion_accum_1h: parseFloat(values[8]),
            kurla_sion_accum_3h: parseFloat(values[9]),
            kurla_sion_accum_6h: parseFloat(values[10]),
            kurla_sion_accum_24h: parseFloat(values[11]),
            
            hindmata_dadar_mean_mm_hr: parseFloat(values[5]),
            hindmata_dadar_max_mm_hr: parseFloat(values[6]),
            hindmata_dadar_accum_1h: parseFloat(values[12]),
            hindmata_dadar_accum_3h: parseFloat(values[13]),
            hindmata_dadar_accum_6h: parseFloat(values[14]),
            hindmata_dadar_accum_24h: parseFloat(values[15]),
          };
        });
        
        this.data = rows;
        return rows;
      })
      .catch(err => {
        console.error("Failed to load real rainfall data", err);
        return [];
      });

    return this.loadPromise;
  }

  getLoadedData(): ProcessedRainfallRow[] {
    return this.data || [];
  }

  getDataForZone(zoneId: string): Array<{ timestamp_utc: string; rainfall_mm: number; accumulation_24h: number }> {
    const rows = this.data || [];
    return rows.map(r => ({
      timestamp_utc: r.timestamp_utc,
      rainfall_mm: zoneId === 'kurla_sion' ? r.kurla_sion_mean_mm_hr : r.hindmata_dadar_mean_mm_hr,
      accumulation_24h: zoneId === 'kurla_sion' ? r.kurla_sion_accum_24h : r.hindmata_dadar_accum_24h
    }));
  }

  async getRowForTime(timeIso: string): Promise<ProcessedRainfallRow | null> {
    const data = await this.loadData();
    // exact match or closest
    return data.find(d => d.timestamp_utc === timeIso) || data[0] || null;
  }
}

export const rainfallService = new RainfallDataService();
