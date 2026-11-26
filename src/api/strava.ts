import type {
  StravaActivitiesResponse,
  StravaStatus,
  StravaStreamsResponse,
} from '../shared/strava';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON responses usually mean the API bridge is not running.
  }
  if (!response.ok) {
    if (body && typeof body === 'object' && 'error' in body) {
      const message = body.error;
      throw new Error(typeof message === 'string' ? message : `HTTP ${response.status}`);
    }
    throw new Error(
      response.status === 404
        ? 'API Strava tidak aktif. Jalankan server lokal (npm run dev).'
        : `Strava API HTTP ${response.status}`,
    );
  }
  return body as T;
}

export function fetchStravaStatus(): Promise<StravaStatus> {
  return requestJson<StravaStatus>('/api/strava/status');
}

export function fetchStravaActivities(page = 1, perPage = 30): Promise<StravaActivitiesResponse> {
  return requestJson<StravaActivitiesResponse>(
    `/api/strava/activities?page=${page}&per_page=${perPage}`,
  );
}

export function fetchStravaStreams(id: string): Promise<StravaStreamsResponse> {
  return requestJson<StravaStreamsResponse>(
    `/api/strava/activities/${encodeURIComponent(id)}/streams`,
  );
}

export async function disconnectStrava(): Promise<void> {
  await requestJson<{ ok: boolean }>('/api/strava/disconnect', { method: 'POST' });
}
