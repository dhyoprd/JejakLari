import { randomBytes } from 'node:crypto';
import type { StravaAthlete } from '../src/shared/strava';

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  athlete: StravaAthlete;
}

export interface StravaSession {
  tokens: StravaTokens;
  lastSeenAt: number;
  refreshPromise?: Promise<StravaTokens>;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;

/**
 * Local, in-memory token storage. Tokens never reach the browser; a restarted
 * server intentionally requires a fresh Strava authorization.
 */
export class StravaSessionStore {
  private readonly sessions = new Map<string, StravaSession>();

  create(tokens: StravaTokens, now = Date.now()): string {
    const id = randomBytes(24).toString('hex');
    this.sessions.set(id, { tokens, lastSeenAt: now });
    this.evict(now);
    return id;
  }

  get(id: string, now = Date.now()): StravaSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (now - session.lastSeenAt > SESSION_TTL_MS) {
      this.sessions.delete(id);
      return null;
    }
    session.lastSeenAt = now;
    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  private evict(now: number): void {
    for (const [id, session] of this.sessions) {
      if (now - session.lastSeenAt > SESSION_TTL_MS) this.sessions.delete(id);
    }
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }
  }
}
