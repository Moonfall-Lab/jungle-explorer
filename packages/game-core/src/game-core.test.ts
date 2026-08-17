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
  it('creates a deterministic 5x8 hidden board with two relics and a safe base', () => {
    const first = createGame('same-seed');
    const second = createGame('same-seed');
    expect(first.truth).toEqual(second.truth);
    expect(first.truth).toHaveLength(40);
    expect(first.truth.find((tile) => tile.position.row === 2 && tile.position.col === 0)?.hazard).toBeUndefined();
    expect(first.truth.filter((tile) => tile.hazard)).toHaveLength(5);
    expect(first.truth.filter((tile) => tile.resource === 'RELIC')).toHaveLength(2);
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

  it('resolves only the final localized cell, not diagonal transit cells', () => {
    const config: GameConfig = {
      ...STANDARD_CONFIG,
      hazards: 0,
      waterSources: 0,
      rareFlowers: 0,
      relicMarkers: 0,
    };
    const state = createGame('final-cell-only', 'CAUTIOUS', config);
    applyLocalization(state, { row: 1, col: 1 }, 1);
    expect(state.knowledge.find((tile) => tile.position.row === 2 && tile.position.col === 1)?.revealed).toBe(false);
    expect(state.knowledge.find((tile) => tile.position.row === 1 && tile.position.col === 1)?.revealed).toBe(true);
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

  it('points a relic carrier safely back toward base', () => {
    const state = createGame('return-hint', 'CAUTIOUS', { ...STANDARD_CONFIG, hazards: 0 });
    applyLocalization(state, { row: state.start.row, col: 2 }, 1);
    state.rover.carryingRelic = true;
    grantCorrectHint(state);
    expect(state.pathHints.at(-1)).toEqual({ row: state.start.row, col: 1 });
  });

  it('wins standard mode only after carrying a relic back to base with HP', () => {
    const config: GameConfig = { ...STANDARD_CONFIG, hazards: 0 };
    const state = createGame('victory', 'CAUTIOUS', config);
    applyLocalization(state, { row: state.start.row, col: 1 }, 1);
    state.rover.carryingRelic = true;
    applyLocalization(state, state.start, 1);
    expect(state.phase).toBe('WON');
  });

  it('wins demo mode immediately after taking either relic', () => {
    const state = createGame('short-victory', 'CAUTIOUS', {
      ...STANDARD_CONFIG,
      victoryMode: 'RELIC_ONLY',
    });
    const relic = state.truth.find((tile) => tile.resource === 'RELIC');
    expect(relic).toBeDefined();
    applyLocalization(state, relic!.position, 1);
    expect(state.phase).toBe('WON');
    expect(state.rover.carryingRelic).toBe(true);
  });

  it('adds dynamic danger without mutating the shared standard config', () => {
    const state = createGame('awakening-danger');
    const relic = state.truth.find((tile) => tile.resource === 'RELIC');
    expect(relic).toBeDefined();
    applyLocalization(state, relic!.position, 1);
    expect(state.phase).toBe('AWAKENED');
    expect(state.config.hazards).toBe(STANDARD_CONFIG.hazards + 2);
    expect(STANDARD_CONFIG.hazards).toBe(5);
  });
});
