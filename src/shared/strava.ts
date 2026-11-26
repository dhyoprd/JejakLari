export interface StravaAthlete {
  id: number;
  firstname: string;
  lastname: string;
  profile?: string;
}

export interface StravaActivitySummary {
  id: string;
  name: string;
  sportType: string;
  distanceMeters: number;
  movingTimeSec: number;
  elapsedTimeSec: number;
  elevationGainMeters: number;
  startDate: string;
  startDateLocal: string;
}

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athlete?: StravaAthlete;
  expiresAt?: number;
  scopes?: string[];
}

export interface StravaStreamSeries<T> {
  data: T[];
  series_type?: string;
  original_size?: number;
  resolution?: string;
}

export interface StravaStreams {
  latlng?: StravaStreamSeries<[number, number]>;
  altitude?: StravaStreamSeries<number | null>;
  time?: StravaStreamSeries<number>;
  heartrate?: StravaStreamSeries<number | null>;
  cadence?: StravaStreamSeries<number | null>;
  distance?: StravaStreamSeries<number>;
}

export type StravaStreamsPayload =
  | StravaStreams
  | Array<{ type: string; data: unknown[]; series_type?: string; original_size?: number; resolution?: string }>;

export interface StravaStreamsResponse {
  activity: StravaActivitySummary;
  streams: StravaStreamsPayload;
}

export interface StravaActivitiesResponse {
  activities: StravaActivitySummary[];
}

export interface ApiErrorBody {
  error: string;
  code?: string;
}
