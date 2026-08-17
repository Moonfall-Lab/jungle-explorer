import type { ActionPlan } from '@jungle/shared-types';

export interface RoverBridgeSettings {
  url: string;
  token: string;
  gameServerPublicUrl: string;
  roverIp: string;
  roverPort: number;
  localizerUrl: string;
  tagId: number;
  tagGapCm: number;
  cellCm: number;
  straightSpeed: number;
  straightCmS: number;
  turnSpeed: number;
  leftTurnSec: number;
  rightTurnSec: number;
  settleSec: number;
  gridMapping: 'landscape' | 'legacy_transposed';
  headingOffsetDeg: number;
}

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
};

export function roverBridgeSettingsFromEnv(): RoverBridgeSettings | undefined {
  const url = process.env.ROVER_BRIDGE_URL?.replace(/\/$/, '');
  if (!url) return undefined;
  const roverIp = process.env.ROVER_IP;
  if (!roverIp) throw new Error('ROVER_IP is required when ROVER_BRIDGE_URL is configured');
  const gridMapping = process.env.SDK_GRID_MAPPING ?? 'landscape';
  if (gridMapping !== 'landscape' && gridMapping !== 'legacy_transposed') {
    throw new Error('SDK_GRID_MAPPING must be landscape or legacy_transposed');
  }
  return {
    url,
    token: process.env.ROVER_BRIDGE_TOKEN ?? '',
    gameServerPublicUrl: (process.env.GAME_SERVER_PUBLIC_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, ''),
    roverIp,
    roverPort: numberFromEnv('ROVER_PORT', 8888),
    localizerUrl: process.env.LOCALIZER_URL ?? 'http://127.0.0.1:8098',
    tagId: numberFromEnv('ROVER_TAG_ID', 0),
    tagGapCm: numberFromEnv('ROVER_TAG_GAP_CM', 0),
    cellCm: numberFromEnv('ROVER_CELL_CM', 6.68),
    straightSpeed: numberFromEnv('ROVER_STRAIGHT_SPEED', 60),
    straightCmS: numberFromEnv('ROVER_STRAIGHT_CM_S', 8.91),
    turnSpeed: numberFromEnv('ROVER_TURN_SPEED', 40),
    leftTurnSec: numberFromEnv('ROVER_LEFT_TURN_SEC', 0.692),
    rightTurnSec: numberFromEnv('ROVER_RIGHT_TURN_SEC', 0.901),
    settleSec: numberFromEnv('ROVER_SETTLE_SEC', 0.25),
    gridMapping,
    headingOffsetDeg: numberFromEnv('ROVER_HEADING_OFFSET_DEG', 0),
  };
}

export async function dispatchPlan(
  settings: RoverBridgeSettings,
  gameId: string,
  plan: ActionPlan,
): Promise<void> {
  const response = await fetch(`${settings.url}/missions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.token ? { 'X-Rover-Token': settings.token } : {}),
    },
    body: JSON.stringify({
      planId: plan.id,
      gameId,
      commands: plan.commands,
      rover: {
        ip: settings.roverIp,
        port: settings.roverPort,
        localizer_url: settings.localizerUrl,
        tag_id: settings.tagId,
        tag_gap_cm: settings.tagGapCm,
        cell_cm: settings.cellCm,
        straight_speed: settings.straightSpeed,
        straight_cm_s: settings.straightCmS,
        turn_speed: settings.turnSpeed,
        left_turn_sec: settings.leftTurnSec,
        right_turn_sec: settings.rightTurnSec,
        settle_sec: settings.settleSec,
        grid_mapping: settings.gridMapping,
        heading_offset_deg: settings.headingOffsetDeg,
      },
      callbackUrl: `${settings.gameServerPublicUrl}/api/games/${gameId}/rover-results`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Rover Bridge rejected plan ${plan.id}: ${response.status} ${await response.text()}`);
  }
}

export async function stopPlan(settings: RoverBridgeSettings, planId: string): Promise<void> {
  const response = await fetch(`${settings.url}/missions/${encodeURIComponent(planId)}/stop`, {
    method: 'POST',
    headers: settings.token ? { 'X-Rover-Token': settings.token } : {},
  });
  if (!response.ok) throw new Error(`Rover Bridge stop failed: ${response.status} ${await response.text()}`);
}
