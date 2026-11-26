import { Router } from 'express';
import type { Request, Response } from 'express';
import { OverpassError, OverpassService, type OverpassBbox } from './overpass-service';

function numberField(body: object, key: string): number {
  return Number(Reflect.get(body, key));
}

function parseBbox(body: unknown): OverpassBbox {
  if (!body || typeof body !== 'object') {
    throw new OverpassError(400, 'Bounding box tidak valid.');
  }
  return {
    south: numberField(body, 'south'),
    west: numberField(body, 'west'),
    north: numberField(body, 'north'),
    east: numberField(body, 'east'),
  };
}

export function createOverpassRouter(service: OverpassService | null): Router {
  const router = Router();

  router.post('/buildings', async (request: Request, response: Response) => {
    if (!service) {
      response.status(503).json({ error: 'Layanan Overpass tidak aktif.' });
      return;
    }
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const body: unknown = request.body;
      const refresh = Boolean(
        body && typeof body === 'object' && 'refresh' in body && body.refresh === true,
      );
      const result = await service.getBuildings(parseBbox(body), {
        signal: controller.signal,
        refresh,
      });
      response.json(result);
    } catch (error) {
      if (error instanceof OverpassError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('Overpass route failed:', error instanceof Error ? error.message : error);
      response.status(502).json({ error: 'Gagal mengambil bangunan OSM.' });
    }
  });

  router.use((_request: Request, response: Response) => {
    response.status(404).json({ error: 'Endpoint OSM tidak ditemukan.' });
  });

  return router;
}
