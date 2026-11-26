import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RunningServer {
  baseUrl: string;
  close: () => Promise<void>;
}

// Ports rejected by the WHATWG fetch implementation. OS-chosen ephemeral
// ports can land on these; retry until a usable one is assigned.
const BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 5060, 5061, 6000, 6665, 6666, 6667, 6668, 6669, 6679, 6697,
  10080,
]);

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

export async function startServer(handler: RequestListener): Promise<RunningServer> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const server = createServer(handler);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    if (!BLOCKED_PORTS.has(address.port)) {
      return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => closeServer(server),
      };
    }
    await closeServer(server);
  }
  throw new Error('Tidak bisa mendapatkan port test yang diizinkan fetch.');
}

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  capture(response: Response): void {
    const setCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    for (const header of setCookies) {
      const pair = header.split(';')[0];
      const separator = pair.indexOf('=');
      if (separator < 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = /max-age=0/i.test(header);
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string): string | null {
    return this.cookies.get(name) ?? null;
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  clear(): void {
    this.cookies.clear();
  }
}

export async function request(
  baseUrl: string,
  path: string,
  jar: CookieJar,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set('Cookie', cookie);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    redirect: init.redirect ?? 'manual',
  });
  jar.capture(response);
  return response;
}
