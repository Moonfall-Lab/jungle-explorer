import type { AgentPersona, GameState } from '@jungle/shared-types';
import { STANDARD_CONFIG, advanceClock, createGame } from '@jungle/game-core';

interface StoredGame {
  state: GameState;
  lastTick: number;
}

export class GameStore {
  private active?: StoredGame;

  create(
    seed?: string,
    persona: AgentPersona = 'CAUTIOUS',
    mode: 'standard' | 'demo' = 'standard',
  ): GameState {
    const state = createGame(seed, persona, {
      ...STANDARD_CONFIG,
      victoryMode: mode === 'demo' ? 'RELIC_ONLY' : 'RETURN_TO_BASE',
    });
    this.active = { state, lastTick: Date.now() };
    return state;
  }

  current(): GameState {
    if (!this.active) return this.create(process.env.GAME_SEED ?? 'jungle-demo');
    const currentTime = Date.now();
    advanceClock(this.active.state, currentTime - this.active.lastTick);
    this.active.lastTick = currentTime;
    return this.active.state;
  }

  get(id: string): GameState {
    const state = this.current();
    if (state.id !== id) throw new Error(`Game ${id} was not found`);
    return state;
  }
}
