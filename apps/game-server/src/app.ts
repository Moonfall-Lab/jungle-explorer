import Fastify from 'fastify';
import cors from '@fastify/cors';
import { buildRiskMap, decideAction, updateAgentFromBio } from '@jungle/agent-core';
import {
  applyLocalization,
  applyMotionEstimate,
  grantCorrectHint,
  toObserverState,
  toPublicState,
} from '@jungle/game-core';
import {
  bioSignalSchema,
  createGameSchema,
  localizationSchema,
  playIntentSchema,
  roverResultSchema,
  updatePersonaSchema,
} from '@jungle/protocol';
import type { ActionPlan, GameEvent, Heading } from '@jungle/shared-types';
import { GameStore } from './store.js';
import {
  checkRoverConnection,
  dispatchPlan,
  roverBridgeSettingsForIp,
  roverBridgeSettingsFromEnv,
  stopPlan,
} from './rover-bridge.js';

function addEvent(state: ReturnType<GameStore['current']>, kind: GameEvent['kind'], message: string): void {
  state.events.push({
    id: `event-${state.events.length + 1}`,
    at: new Date().toISOString(),
    kind,
    message,
  });
}

function headingAfterPlan(initial: Heading, plan: ActionPlan): Heading {
  const headings: Heading[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
  let index = headings.indexOf(initial);
  for (const command of plan.commands) {
    if (command.action === 'TURN_LEFT') index = (index + 3) % 4;
    if (command.action === 'TURN_RIGHT') index = (index + 1) % 4;
  }
  return headings[index] ?? initial;
}

export async function buildServer(options: { logger?: boolean; roverMode?: 'virtual' | 'hardware' } = {}) {
  const server = Fastify({ logger: options.logger ?? false });
  const store = new GameStore();
  let roverMode = options.roverMode ?? (process.env.ROVER_MODE === 'hardware' ? 'hardware' : 'virtual');
  let roverBridge = roverMode === 'hardware' ? roverBridgeSettingsFromEnv() : undefined;
  await server.register(cors, {
    origin: [
      process.env.PLAYER_ORIGIN ?? 'http://localhost:5173',
      process.env.OBSERVER_ORIGIN ?? 'http://localhost:5174',
      process.env.BOARD_ORIGIN ?? 'http://localhost:5175',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5175',
    ],
  });

  server.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const name = error instanceof Error ? error.name : 'UnknownError';
    const statusCode = name === 'ZodError' ? 400 : message.includes('not found') ? 404 : 409;
    reply.status(statusCode).send({ error: message });
  });

  const roverOperatorState = () => ({
    roverMode,
    configured: roverMode === 'hardware' && Boolean(roverBridge),
    ip: roverBridge?.roverIp ?? null,
    localizationMode: roverBridge?.localizationMode ?? 'disabled',
  });

  server.get('/health', async () => ({ status: 'ok', ...roverOperatorState() }));

  server.get('/api/operator/rover', async () => roverOperatorState());

  server.post('/api/operator/rover/check', async (request) => {
    const { ip } = request.body as { ip?: unknown };
    return checkRoverConnection(String(ip ?? ''));
  });

  server.post('/api/operator/rover/connect', async (request, reply) => {
    const { ip } = request.body as { ip?: unknown };
    const connection = await checkRoverConnection(String(ip ?? ''));
    if (!connection.online) return reply.status(503).send(connection);
    roverBridge = roverBridgeSettingsForIp(connection.ip);
    roverMode = 'hardware';
    return reply.send({ ...roverOperatorState(), ...connection });
  });

  server.post('/api/operator/rover/virtual', async () => {
    roverBridge = undefined;
    roverMode = 'virtual';
    return roverOperatorState();
  });

  server.post('/api/games', async (request, reply) => {
    const input = createGameSchema.parse(request.body ?? {});
    const state = store.create(input.seed, input.persona, input.mode);
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

  server.patch('/api/games/:id/persona', async (request) => {
    const { id } = request.params as { id: string };
    const input = updatePersonaSchema.parse(request.body);
    const state = store.get(id);
    if (state.pendingPlan?.status === 'PENDING' || state.pendingPlan?.status === 'DISPATCHED') {
      throw new Error('小车任务执行期间不能切换人格');
    }
    state.agent.persona = input.persona;
    state.agent.explanation = `驾驶人格已切换为 ${input.persona}，下一轮将使用新的决策偏好。`;
    addEvent(state, 'AGENT_PERSONA_CHANGED', `驾驶人格切换为 ${input.persona}。`);
    return toPublicState(state);
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
    } else if (roverBridge) {
      try {
        await dispatchPlan(roverBridge, state.id, plan);
      } catch (error) {
        plan.status = 'FAILED';
        const message = error instanceof Error ? error.message : 'Unknown Rover Bridge error';
        addEvent(state, 'ROVER_FAILED', message);
        throw error;
      }
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

  server.post('/api/games/:id/rover-results', async (request, reply) => {
    const { id } = request.params as { id: string };
    const expectedToken = process.env.ROVER_BRIDGE_TOKEN ?? '';
    if (expectedToken && request.headers['x-rover-token'] !== expectedToken) {
      return reply.status(401).send({ error: 'Invalid Rover Bridge callback token' });
    }
    const input = roverResultSchema.parse(request.body);
    const state = store.get(id);
    if (input.gameId !== id) throw new Error('Rover result gameId does not match route');
    if (!state.pendingPlan || state.pendingPlan.id !== input.planId) {
      throw new Error(`Rover result does not match the pending plan: ${input.planId}`);
    }
    if (state.pendingPlan.status === 'CONFIRMED') return reply.send(toPublicState(state));
    if (input.status === 'MOTION_COMPLETED') {
      applyMotionEstimate(
        state,
        state.pendingPlan.target,
        headingAfterPlan(state.rover.heading, state.pendingPlan),
      );
    } else if (input.status === 'COMPLETED' && input.position) {
      applyLocalization(state, input.position, 1, input.heading ?? state.rover.heading);
    } else {
      state.pendingPlan.status = 'FAILED';
      addEvent(
        state,
        'ROVER_FAILED',
        input.error ?? `Rover mission ${input.planId} ended as ${input.status}.`,
      );
    }
    return reply.send(toPublicState(state));
  });

  server.post('/api/games/:id/rover-stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const state = store.get(id);
    if (!state.pendingPlan || state.pendingPlan.status !== 'DISPATCHED') {
      throw new Error('No dispatched rover plan can be stopped');
    }
    if (!roverBridge) throw new Error('Rover Bridge is not configured');
    await stopPlan(roverBridge, state.pendingPlan.id);
    addEvent(state, 'ROVER_FAILED', `Emergency stop requested for ${state.pendingPlan.id}.`);
    return reply.status(202).send({ accepted: true, planId: state.pendingPlan.id });
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
