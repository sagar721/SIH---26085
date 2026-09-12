export type DataCategory =
  | 'Rainfall'
  | 'DEM / Terrain'
  | 'Buildings'
  | 'Roads'
  | 'Land Cover'
  | 'Drainage & Hydro'
  | 'Water / Nallas'
  | 'Critical Infrastructure'
  | 'Historical Flood Validation'
  | 'Flood Model'
  | 'Tide & Coastal';

export type ProvenanceStatus =
  | 'OBSERVED'
  | 'MODEL_DERIVED'
  | 'MODELLED'
  | 'INFERRED'
  | 'SYNTHETIC'
  | 'OFFICIAL'
  | 'UNAVAILABLE';

export type RecommendationTier = 
  | 'PRIMARY'
  | 'SECONDARY'
  | 'FALLBACK'
  | 'VALIDATION ONLY'
  | 'NOT SUITABLE';

export interface DataProvenanceItem {
  id: string;
  category: DataCategory;
  name: string;
  provider: string;
  website: string;
  directLink?: string;
  spatialResolution: string;
  temporalResolution: string;
  dataType: 'Historical' | 'Real-time' | 'Forecast' | 'Static' | 'Dynamic';
  mumbaiCoverage: string;
  pilotCoverage: string;
  fileFormat: string;
  programmaticDownload: boolean;
  accessMethod: string;
  license: string;
  dataQuality: string;
  status: ProvenanceStatus;
  recommendation: RecommendationTier;
  howWeUseIt: string;
  notes: string;
}
