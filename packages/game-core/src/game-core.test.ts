import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@jungle/shared-types';
import {
  STANDARD_CONFIG,
  advanceClock,
  applyLocalization,
  createGame,
  grantCorrectHint,
  toPublicState,
} from './index.js';

describe('game core', () => {
  it('creates a deterministic 5x8 hidden board with safe endpoints', () => {
    const first = createGame('same-seed');
    const second = createGame('same-seed');
    expect(first.truth).toEqual(second.truth);
    expect(first.truth).toHaveLength(40);
    expect(first.truth.find((tile) => tile.position.row === 2 && tile.position.col === 0)?.hazard).toBeUndefined();
    expect(first.truth.find((tile) => tile.position.row === 2 && tile.position.col === 7)?.hazard).toBeUndefined();
  });

  it('never leaks board truth into the player state', () => {
    const publicState = toPublicState(createGame('no-leaks'));
    expect('truth' in publicState).toBe(false);
    expect(publicState.knowledge.filter((tile) => !tile.revealed).every((tile) => !tile.hazard)).toBe(true);
  });

  it('uses camera localization as the authoritative final position', () => {
    const state = createGame('camera-referee');
    applyLocalization(state, { row: 1, col: 1 }, 0.94, 'NORTH');
    expect(state.rover.position).toEqual({ row: 1, col: 1 });
    expect(state.rover.heading).toBe('NORTH');
  });

  it('rejects unreliable physical localization', () => {
    const state = createGame('low-confidence');
    expect(() => applyLocalization(state, { row: 2, col: 1 }, 0.4)).toThrow(/confidence/);
  });

  it('accelerates time after the jungle awakens', () => {
    const state = createGame('clock');
    state.phase = 'AWAKENED';
    advanceClock(state, 1000);
    expect(state.elapsedMs).toBe(STANDARD_CONFIG.awakeningTimeMultiplier * 1000);
  });

  it('provides a safe, correct hint', () => {
    const state = createGame('hint');
    grantCorrectHint(state);
    expect(state.pathHints).toHaveLength(1);
    const hint = state.pathHints[0];
    expect(hint && state.truth.find((tile) => tile.position.row === hint.row && tile.position.col === hint.col)?.hazard).toBeUndefined();
  });

  it('wins only when carrying the relic at the exit with HP', () => {
    const config: GameConfig = { ...STANDARD_CONFIG, hazards: 0 };
    const state = createGame('victory', 'CAUTIOUS', config);
    state.rover.carryingRelic = true;
    applyLocalization(state, state.exit, 1);
    expect(state.phase).toBe('WON');
  });

  it('adds dynamic danger without mutating the shared standard config', () => {
    const state = createGame('awakening-danger');
    const relic = state.truth.find((tile) => tile.resource === 'LOST_RELIC');
    expect(relic).toBeDefined();
    state.cluesFound = state.config.requiredClues;
    applyLocalization(state, relic!.position, 1);
    expect(state.phase).toBe('AWAKENED');
    expect(state.config.hazards).toBe(STANDARD_CONFIG.hazards + 2);
    expect(STANDARD_CONFIG.hazards).toBe(9);
  });
});
