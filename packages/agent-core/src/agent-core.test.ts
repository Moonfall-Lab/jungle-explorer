import { describe, expect, it } from 'vitest';
import { createGame, grantCorrectHint } from '@jungle/game-core';
import { buildRiskMap, decideAction, updateAgentFromBio } from './index.js';

describe('agent core', () => {
  it('builds a bounded risk estimate for every tile', () => {
    const state = createGame('risk-map');
    const risks = buildRiskMap(state);
    expect(risks).toHaveLength(40);
    expect(risks.every(({ risk }) => risk >= 0 && risk <= 1)).toBe(true);
  });

  it('keeps VERIFY to one cardinal cell', () => {
    const state = createGame('verify');
    const plan = decideAction(state, 'VERIFY');
    expect(plan.path).toHaveLength(2);
    expect(plan.commands.at(-1)?.action).toBe('FORWARD');
  });

  it('uses a guaranteed hint for FIND_CLUE', () => {
    const state = createGame('find-clue');
    grantCorrectHint(state);
    const plan = decideAction(state, 'FIND_CLUE');
    expect(plan.target).toEqual(state.pathHints[0]);
    expect(plan.expectedRisk).toBe(0);
  });

  it('smooths noisy bio-signal input instead of directly deciding outcomes', () => {
    const state = createGame('bio');
    updateAgentFromBio(state, 1);
    expect(state.agent.teamTension).toBe(0.35);
    expect(state.phase).toBe('EXPLORING');
  });

  it('keeps card movement limits while evacuating', () => {
    const state = createGame('evacuation-scope');
    state.phase = 'AWAKENED';
    state.rover.carryingRelic = true;
    const plan = decideAction(state, 'EXPLORE');
    expect(Math.max(
      Math.abs(plan.target.row - state.rover.position.row),
      Math.abs(plan.target.col - state.rover.position.col),
    )).toBeLessThanOrEqual(2);
  });
});
