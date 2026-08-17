import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';

let server: FastifyInstance | undefined;
afterEach(async () => server?.close());

describe('game server', () => {
  it('runs a virtual authoritative turn end-to-end', async () => {
    server = await buildServer({ roverMode: 'virtual' });
    const created = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: { seed: 'api-test', persona: 'CAUTIOUS' },
    });
    expect(created.statusCode).toBe(201);
    const game = created.json();
    expect(game.truth).toBeUndefined();
    const turn = await server.inject({
      method: 'POST',
      url: `/api/games/${game.id}/intents`,
      payload: { card: 'VERIFY' },
    });
    expect(turn.statusCode).toBe(200);
    expect(turn.json().state.round).toBe(1);
    expect(turn.json().plan.status).toBe('CONFIRMED');
  });

  it('keeps a hardware move pending until camera localization arrives', async () => {
    server = await buildServer({ roverMode: 'hardware' });
    const created = await server.inject({ method: 'POST', url: '/api/games', payload: { seed: 'hardware' } });
    const game = created.json();
    const turn = await server.inject({
      method: 'POST',
      url: `/api/games/${game.id}/intents`,
      payload: { card: 'CAUTIOUS' },
    });
    expect(turn.json().state.round).toBe(0);
    expect(turn.json().plan.status).toBe('DISPATCHED');
  });
});
