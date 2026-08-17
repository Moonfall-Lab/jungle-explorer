import Fastify from 'fastify';
import cors from '@fastify/cors';
import { buildRiskMap, decideAction, updateAgentFromBio } from '@jungle/agent-core';
import {
  applyLocalization,
  grantCorrectHint,
  toObserverState,
  toPublicState,
} from '@jungle/game-core';
import {
  bioSignalSchema,
  createGameSchema,
  localizationSchema,
  playIntentSchema,
} from '@jungle/protocol';
import type { GameEvent } from '@jungle/shared-types';
import { GameStore } from './store.js';

function addEvent(state: ReturnType<GameStore['current']>, kind: GameEvent['kind'], message: string): void {
  state.events.push({
    id: `event-${state.events.length + 1}`,
    at: new Date().toISOString(),
    kind,
    message,
  });
}

export async function buildServer(options: { logger?: boolean; roverMode?: 'virtual' | 'hardware' } = {}) {
  const server = Fastify({ logger: options.logger ?? false });
  const store = new GameStore();
  const roverMode = options.roverMode ?? (process.env.ROVER_MODE === 'hardware' ? 'hardware' : 'virtual');
  await server.register(cors, {
    origin: [
      process.env.PLAYER_ORIGIN ?? 'http://localhost:5173',
      process.env.OBSERVER_ORIGIN ?? 'http://localhost:5174',
    ],
  });

  server.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const name = error instanceof Error ? error.name : 'UnknownError';
    const statusCode = name === 'ZodError' ? 400 : message.includes('not found') ? 404 : 409;
    reply.status(statusCode).send({ error: message });
  });

  server.get('/health', async () => ({ status: 'ok', roverMode }));

  server.post('/api/games', async (request, reply) => {
    const input = createGameSchema.parse(request.body ?? {});
    const state = store.create(input.seed, input.persona);
    return reply.status(201).send(toPublicState(state));
  });

  server.get('/api/games/current', async () => toPublicState(store.current()));
  server.get('/api/games/current/observer', async () => {
    const state = store.current();
    return toObserverState(state, buildRiskMap(state));
  });

  server.get('/api/games/:id', async (request) => {
    const { id } = request.params as { id: string };
    return toPublicState(store.get(id));
  });

  server.post('/api/games/:id/intents', async (request) => {
    const { id } = request.params as { id: string };
    const input = playIntentSchema.parse(request.body);
    const state = store.get(id);
    if (input.card === 'FIND_CLUE') grantCorrectHint(state);
    const plan = decideAction(state, input.card);
    state.pendingPlan = plan;
    state.agent.lastIntent = input.card;
    state.agent.explanation = plan.explanation;
    state.agent.riskAtRover = plan.expectedRisk;
    state.agent.stance = state.phase === 'AWAKENED' ? 'EVACUATING' : input.card === 'CAUTIOUS' || input.card === 'VERIFY' ? 'CAUTIOUS' : 'EXPLORING';
    addEvent(state, 'INTENT_PLAYED', `玩家打出 ${input.card} 意图卡。`);
    addEvent(state, 'AGENT_PLANNED', plan.explanation);
    plan.status = 'DISPATCHED';

    if (roverMode === 'virtual') {
      applyLocalization(state, plan.target, 1, state.rover.heading);
    }
    return { state: toPublicState(state), plan, roverMode };
  });

  server.post('/api/games/:id/localizations', async (request) => {
    const { id } = request.params as { id: string };
    const input = localizationSchema.parse(request.body);
    const state = store.get(id);
    applyLocalization(state, input.position, input.confidence, input.heading ?? state.rover.heading);
    return toPublicState(state);
  });

  server.post('/api/games/:id/bio-signals', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = bioSignalSchema.parse(request.body);
    const state = store.get(id);
    state.latestBio = {
      heartRate: input.heartRate,
      tension: input.tension,
      confidence: input.confidence,
      capturedAt: input.capturedAt,
      ...(input.hrv === undefined ? {} : { hrv: input.hrv }),
    };
    if (input.confidence >= 0.6) updateAgentFromBio(state, input.tension);
    return reply.status(202).send({
      accepted: input.confidence >= 0.6,
      teamTension: state.agent.teamTension,
      note: '生理信号仅作为 Agent 情境输入，不直接改变胜负。',
    });
  });

  return server;
}
