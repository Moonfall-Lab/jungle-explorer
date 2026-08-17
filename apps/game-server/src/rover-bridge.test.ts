import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionPlan } from '@jungle/shared-types';
import { dispatchPlan, stopPlan, type RoverBridgeSettings } from './rover-bridge.js';

const settings: RoverBridgeSettings = {
  url: 'http://127.0.0.1:8200',
  token: 'local-token',
  gameServerPublicUrl: 'http://127.0.0.1:3000',
  roverIp: '192.168.20.155',
  roverPort: 8888,
  localizerUrl: 'http://127.0.0.1:8098',
  tagId: 0,
  tagGapCm: 0,
  cellCm: 6.68,
  straightSpeed: 60,
  straightCmS: 8.91,
  turnSpeed: 40,
  leftTurnSec: 0.692,
  rightTurnSec: 0.901,
  settleSec: 0.25,
  localizationMode: 'disabled',
  gridMapping: 'landscape',
  headingOffsetDeg: 0,
};

const plan: ActionPlan = {
  id: 'plan-1',
  intent: 'VERIFY',
  target: { row: 2, col: 1 },
  path: [{ row: 2, col: 0 }, { row: 2, col: 1 }],
  commands: [{ action: 'FORWARD', cells: 1 }],
  expectedRisk: 0.1,
  explanation: 'test plan',
  status: 'DISPATCHED',
};

afterEach(() => vi.unstubAllGlobals());

describe('rover bridge client', () => {
  it('dispatches the exact plan, calibration and callback contract', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', request);
    await dispatchPlan(settings, 'game-1', plan);
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8200/missions');
    expect(init.headers).toMatchObject({ 'X-Rover-Token': 'local-token' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      planId: 'plan-1',
      gameId: 'game-1',
      commands: [{ action: 'FORWARD', cells: 1 }],
      rover: {
        ip: '192.168.20.155',
        cell_cm: 6.68,
        localization_mode: 'disabled',
        grid_mapping: 'landscape',
      },
      callbackUrl: 'http://127.0.0.1:3000/api/games/game-1/rover-results',
    });
  });

  it('calls the bridge emergency-stop endpoint', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', request);
    await stopPlan(settings, 'plan/unsafe');
    expect(request).toHaveBeenCalledWith(
      'http://127.0.0.1:8200/missions/plan%2Funsafe/stop',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
