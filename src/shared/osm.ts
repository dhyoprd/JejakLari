export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface OsmBuilding {
  id: number;
  heightMeters: number;
  colorHex: string;
  polygon: GeoPoint[];
}

export interface OsmBuildingsResponse {
  source: 'openstreetmap';
  buildings: OsmBuilding[];
  truncated: boolean;
  fetchedAt: string;
  cached?: boolean;
  stale?: boolean;
}
