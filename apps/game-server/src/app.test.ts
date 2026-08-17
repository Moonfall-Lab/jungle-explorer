import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';

let server: FastifyInstance | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await server?.close();
  server = undefined;
});

describe('game server', () => {
  it('allows the local 127.0.0.1 player origin', async () => {
    server = await buildServer({ roverMode: 'virtual' });
    const response = await server.inject({
      method: 'GET',
      url: '/api/games/current',
      headers: { origin: 'http://127.0.0.1:5173' },
    });
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
  });

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

  it('changes the active agent persona without restarting the game', async () => {
    server = await buildServer({ roverMode: 'virtual' });
    const current = await server.inject({ method: 'GET', url: '/api/games/current' });
    const game = current.json();
    const changed = await server.inject({
      method: 'PATCH',
      url: `/api/games/${game.id}/persona`,
      payload: { persona: 'FORAGER' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().id).toBe(game.id);
    expect(changed.json().agent.persona).toBe('FORAGER');
    expect(changed.json().events.at(-1).kind).toBe('AGENT_PERSONA_CHANGED');
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
    const planned = turn.json();
    expect(planned.state.round).toBe(0);
    expect(planned.plan.status).toBe('DISPATCHED');

    const callbackPayload = {
      planId: planned.plan.id,
      gameId: game.id,
      status: 'COMPLETED',
      sequence: 'F1',
      position: planned.plan.target,
      heading: 'EAST',
      sdkTelemetry: { sample_count: 3 },
    };
    const localized = await server.inject({
      method: 'POST',
      url: `/api/games/${game.id}/rover-results`,
      payload: callbackPayload,
    });
    expect(localized.statusCode).toBe(200);
    expect(localized.json().round).toBe(1);
    expect(localized.json().pendingPlan.status).toBe('CONFIRMED');

    const duplicate = await server.inject({
      method: 'POST',
      url: `/api/games/${game.id}/rover-results`,
      payload: callbackPayload,
    });
    expect(duplicate.json().round).toBe(1);
  });

  it('mirrors a completed hardware motion to the virtual board', async () => {
    server = await buildServer({ roverMode: 'hardware' });
    const created = await server.inject({ method: 'POST', url: '/api/games', payload: { seed: 'motion-only' } });
    const game = created.json();
    const turn = await server.inject({
      method: 'POST',
      url: `/api/games/${game.id}/intents`,
      payload: { card: 'VERIFY' },
    });
    const planned = turn.json();

    const callback = await server.inject({
      method: 'POST',
      url: `/api/games/${game.id}/rover-results`,
      payload: {
        planId: planned.plan.id,
        gameId: game.id,
        status: 'MOTION_COMPLETED',
        sequence: 'F1',
        sdkTelemetry: { movement_duration_sec: 0.75 },
      },
    });

    expect(callback.statusCode).toBe(200);
    expect(callback.json().round).toBe(1);
    expect(callback.json().rover.position).toEqual(planned.plan.target);
    expect(callback.json().pendingPlan.status).toBe('CONFIRMED');
    expect(callback.json().events.some((event: { kind: string }) => event.kind === 'ROVER_MOVED')).toBe(true);
  });

  it('connects a reachable private-network rover and can return to virtual mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://192.168.20.155/status');
      return new Response(JSON.stringify({ L: 0, R: 0, spd: 80 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    server = await buildServer({ roverMode: 'virtual' });

    const connected = await server.inject({
      method: 'POST',
      url: '/api/operator/rover/connect',
      payload: { ip: '192.168.20.155' },
    });
    expect(connected.statusCode).toBe(200);
    expect(connected.json()).toMatchObject({
      roverMode: 'hardware',
      configured: true,
      ip: '192.168.20.155',
      online: true,
      localizationMode: 'disabled',
      motors: { left: 0, right: 0, speed: 80 },
    });

    const virtual = await server.inject({ method: 'POST', url: '/api/operator/rover/virtual' });
    expect(virtual.json()).toMatchObject({ roverMode: 'virtual', configured: false, ip: null });
  });
});
