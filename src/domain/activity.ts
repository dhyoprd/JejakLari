/** Normalized activity domain. Engine code depends only on these types. */

export interface RawTrackPoint {
  lat: number;
  lng: number;
  timeMs?: number | null;
  ele?: number | null;
  hr?: number | null;
  cad?: number | null;
  distMeters?: number | null;
}

export interface RawActivity {
  name: string;
  points: RawTrackPoint[];
  sessionDistanceMeters?: number | null;
  sessionDurationSec?: number | null;
  source?: 'file' | 'strava';
}

export interface ActivityPoint {
  elapsedSec: number;
  timestamp: string;
  /** meters / second */
  speed: number;
  /** minutes / km */
  paceMinPerKm: number;
  paceFormatted: string;
  heartRate: number;
  distanceKm: number;
  elevationGain: number;
  altitude: number;
  cadence: number;
  lat: number;
  lng: number;
}

export interface Activity {
  activityName: string;
  dateFormatted: string;
  locationName: string;
  totalDistanceKm: number;
  totalDurationSec: number;
  totalElevationGain: number;
  avgPaceFormatted: string;
  avgHeartRate: number;
  avgCadence: number;
  timeline: ActivityPoint[];
  missingTimestamps: boolean;
  startTimeMs: number;
  source: 'file' | 'strava';
}


export class ActivityParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityParseError';
  }
}
