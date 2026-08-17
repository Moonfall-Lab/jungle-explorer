import type {
  AgentPersona,
  GameConfig,
  GameEvent,
  GameState,
  HazardType,
  ObserverGameState,
  Position,
  PublicGameState,
  ResourceType,
  Terrain,
  TileKnowledge,
  TileTruth,
} from '@jungle/shared-types';
import { HAZARD_TYPES, positionKey, samePosition } from '@jungle/shared-types';
import { findPath, neighbors } from '@jungle/navigation';

export const STANDARD_CONFIG: GameConfig = {
  rows: 5,
  columns: 8,
  durationMs: 20 * 60 * 1000,
  startingHp: 3,
  maxHp: 3,
  hazards: 5,
  relics: 2,
  relicMarkers: 2,
  waterSources: 3,
  rareFlowers: 2,
  victoryMode: 'RETURN_TO_BASE',
  awakeningTimeMultiplier: 1.8,
};

const terrains: Terrain[] = ['GRASSLAND', 'RAINFOREST', 'SWAMP', 'CLEARING'];

function seedHash(seed: string): number {
  let hash = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return (hash >>> 0) || 1;
}

export function createRandom(seed: string): () => number {
  let value = seedHash(seed);
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function now(): string {
  return new Date().toISOString();
}

function event(kind: GameEvent['kind'], message: string, sequence: number): GameEvent {
  return { id: `event-${sequence}`, at: now(), kind, message };
}

function allPositions(config: GameConfig): Position[] {
  return Array.from({ length: config.rows * config.columns }, (_, index) => ({
    row: Math.floor(index / config.columns),
    col: index % config.columns,
  }));
}

export function createGame(
  seed = `jungle-${Date.now()}`,
  persona: AgentPersona = 'CAUTIOUS',
  config: GameConfig = STANDARD_CONFIG,
): GameState {
  config = { ...config };
  const random = createRandom(seed);
  const start = { row: Math.floor(config.rows / 2), col: 0 };
  const truth: TileTruth[] = allPositions(config).map((position) => ({
    position,
    terrain: terrains[Math.floor(random() * terrains.length)] ?? 'RAINFOREST',
  }));
  const available = shuffle(
    truth.filter((tile) => !samePosition(tile.position, start)),
    random,
  );
  let cursor = 0;
  for (let index = 0; index < config.hazards; index += 1) {
    const tile = available[cursor++];
    const hazard = HAZARD_TYPES[index % HAZARD_TYPES.length];
    if (tile && hazard) tile.hazard = hazard;
  }
  const resources: ResourceType[] = [
    ...Array<ResourceType>(config.waterSources).fill('WATER'),
    ...Array<ResourceType>(config.rareFlowers).fill('RARE_FLOWER'),
    ...Array<ResourceType>(config.relicMarkers).fill('RELIC_MARKER'),
    ...Array<ResourceType>(config.relics).fill('RELIC'),
  ];
  for (const resource of resources) {
    while (available[cursor]?.hazard) cursor += 1;
    const tile = available[cursor++];
    if (tile) tile.resource = resource;
  }

  const knowledge: TileKnowledge[] = truth.map(({ position }) => ({
    position,
    revealed: false,
    forgotten: false,
  }));
  const timestamp = now();
  const state: GameState = {
    id: `game-${seedHash(`${seed}-${timestamp}`).toString(36)}`,
    seed,
    config,
    phase: 'EXPLORING',
    startedAt: timestamp,
    updatedAt: timestamp,
    elapsedMs: 0,
    start,
    rover: {
      id: 'rover-01',
      position: start,
      heading: 'EAST',
      hp: config.startingHp,
      maxHp: config.maxHp,
      batteryPercent: 100,
      carryingRelic: false,
    },
    truth,
    knowledge,
    relicMarkersFound: 0,
    pathHints: [],
    round: 0,
    agent: {
      persona,
      stance: 'EXPLORING',
      explanation: '藤蔓尚未拨开，我正在建立第一张风险地图。',
      teamTension: 0,
      riskAtRover: 0,
    },
    events: [event('GAME_STARTED', '探险队进入丛林，计时开始。', 1)],
  };
  return revealAt(state, start);
}

export function getTruth(state: GameState, position: Position): TileTruth | undefined {
  return state.truth.find((tile) => samePosition(tile.position, position));
}

export function getKnowledge(state: GameState, position: Position): TileKnowledge | undefined {
  return state.knowledge.find((tile) => samePosition(tile.position, position));
}

export function countNearbyHazards(state: GameState, position: Position): number {
  const adjacent = neighbors(position, {
    rows: state.config.rows,
    columns: state.config.columns,
    allowDiagonal: true,
  });
  return adjacent.filter((candidate) => getTruth(state, candidate)?.hazard).length;
}

function pushEvent(state: GameState, kind: GameEvent['kind'], message: string): void {
  state.events.push(event(kind, message, state.events.length + 1));
  state.events = state.events.slice(-80);
}

const hazardNarration: Record<HazardType, string> = {
  ROCKFALL: '树冠上方传来断裂声，落石砸中了探险车。',
  SNAKE_NEST: '毒蛇群突然从湿叶间窜出，车体受到冲击。',
  VINE_TRAP: '断裂藤蔓骤然收紧，探险车被拖进陷阱。',
  UNKNOWN_EVENT: '雾中响起陌生的低鸣，一场未知丛林事件袭来。',
};

function nearestSafeTarget(state: GameState, resources: ResourceType[]): Position | undefined {
  return state.truth
    .filter((tile) => !tile.hazard && tile.resource && resources.includes(tile.resource))
    .filter((tile) => !getKnowledge(state, tile.position)?.consumed)
    .map((tile) => ({
      position: tile.position,
      distance:
        Math.abs(tile.position.row - state.rover.position.row) +
        Math.abs(tile.position.col - state.rover.position.col),
    }))
    .sort((a, b) => a.distance - b.distance || positionKey(a.position).localeCompare(positionKey(b.position)))[0]
    ?.position;
}

export function grantCorrectHint(state: GameState): GameState {
  if (state.phase === 'WON' || state.phase === 'LOST') return state;
  const target = state.rover.carryingRelic ? state.start : nearestSafeTarget(state, ['RELIC']);
  if (!target) return state;
  const path = findPath(state.rover.position, target, {
    rows: state.config.rows,
    columns: state.config.columns,
    blocked: new Set(state.truth.filter((tile) => tile.hazard).map((tile) => positionKey(tile.position))),
  });
  const next = path[1] ?? target;
  if (!state.pathHints.some((hint) => samePosition(hint, next))) state.pathHints.push(next);
  pushEvent(
    state,
    'CLUE_GRANTED',
    `可靠线索：从当前位置前往第 ${next.row + 1} 行第 ${next.col + 1} 列是安全且有价值的一步。`,
  );
  state.updatedAt = now();
  return state;
}

function triggerAwakening(state: GameState): void {
  state.phase = 'AWAKENED';
  state.agent.stance = 'EVACUATING';
  const random = createRandom(`${state.seed}-awakening-${state.round}`);
  const dynamicCandidates = shuffle(
    state.truth.filter(
      (tile) =>
        !tile.hazard &&
        !tile.resource &&
        !getKnowledge(state, tile.position)?.revealed &&
        !samePosition(tile.position, state.rover.position) &&
        !samePosition(tile.position, state.start),
    ),
    random,
  ).slice(0, 2);
  for (const tile of dynamicCandidates) tile.hazard = 'UNKNOWN_EVENT';
  state.config.hazards += dynamicCandidates.length;
  const forgettable = state.knowledge.filter(
    (tile) =>
      tile.revealed &&
      !samePosition(tile.position, state.rover.position) &&
      !samePosition(tile.position, state.start) &&
      !tile.hazard,
  );
  for (const tile of forgettable.filter((_, index) => index % 3 === 0)) {
    tile.revealed = false;
    tile.forgotten = true;
    delete tile.nearbyHazards;
    delete tile.terrain;
  }
  pushEvent(
    state,
    'JUNGLE_AWAKENED',
    `遗迹离开祭台，丛林苏醒：时间流逝加速，部分安全记忆被迷雾吞没，${dynamicCandidates.length} 个动态危险开始活动。`,
  );
}

function dropRelic(state: GameState): void {
  const dropTarget = neighbors(state.rover.position, {
    rows: state.config.rows,
    columns: state.config.columns,
  })
    .map((position) => getTruth(state, position))
    .filter((tile): tile is TileTruth => Boolean(tile && !tile.hazard && !tile.resource))
    .sort((a, b) => positionKey(a.position).localeCompare(positionKey(b.position)))[0];
  state.rover.carryingRelic = false;
  if (!dropTarget) {
    state.phase = 'LOST';
    pushEvent(state, 'GAME_LOST', '重大事件将遗迹卷入裂隙，周围没有可恢复的落点。');
    return;
  }
  dropTarget.resource = 'RELIC';
  const knowledge = getKnowledge(state, dropTarget.position);
  if (knowledge) {
    knowledge.resource = 'RELIC';
    knowledge.consumed = false;
  }
  state.pathHints.push(dropTarget.position);
  pushEvent(
    state,
    'RESOURCE_FOUND',
    `重大事件令遗迹掉落在第 ${dropTarget.position.row + 1} 行第 ${dropTarget.position.col + 1} 列，必须重新取得。`,
  );
}

function revealLocalMap(state: GameState, center: Position): void {
  const localTiles = neighbors(center, {
    rows: state.config.rows,
    columns: state.config.columns,
    allowDiagonal: true,
  });
  for (const position of localTiles) {
    const truth = getTruth(state, position);
    const knowledge = getKnowledge(state, position);
    if (!truth || !knowledge) continue;
    knowledge.revealed = true;
    knowledge.forgotten = false;
    knowledge.terrain = truth.terrain;
    knowledge.nearbyHazards = countNearbyHazards(state, position);
    if (truth.hazard) knowledge.hazard = truth.hazard;
    if (truth.resource) knowledge.resource = truth.resource;
  }
}

function resolveResource(state: GameState, knowledge: TileKnowledge, resource: ResourceType): void {
  if (knowledge.consumed) return;
  knowledge.resource = resource;
  if (resource === 'WATER') {
    state.rover.hp = Math.min(state.rover.maxHp, state.rover.hp + 1);
    knowledge.consumed = true;
    pushEvent(state, 'RESOURCE_FOUND', '发现清洁水源，探险车恢复 1 HP。');
  } else if (resource === 'RARE_FLOWER') {
    knowledge.consumed = true;
    pushEvent(state, 'RESOURCE_FOUND', '发现稀有花朵，一条绝对正确的路径提示已解锁。');
    grantCorrectHint(state);
  } else if (resource === 'RELIC_MARKER') {
    knowledge.consumed = true;
    state.relicMarkersFound += 1;
    revealLocalMap(state, knowledge.position);
    pushEvent(
      state,
      'RESOURCE_FOUND',
      `找到遗迹标记（${state.relicMarkersFound}/${state.config.relicMarkers}），周围八格的局部地图已公开。`,
    );
  } else if (resource === 'RELIC') {
    if (!state.rover.carryingRelic) {
      knowledge.consumed = true;
      state.rover.carryingRelic = true;
      pushEvent(state, 'RESOURCE_FOUND', '遗迹已取得。');
      if (state.config.victoryMode === 'RELIC_ONLY') {
        state.phase = 'WON';
        pushEvent(state, 'GAME_WON', '探险队找到并取得任意一个遗迹，短模式胜利！');
      } else {
        triggerAwakening(state);
      }
    }
  }
}

export function revealAt(state: GameState, position: Position): GameState {
  const truth = getTruth(state, position);
  const knowledge = getKnowledge(state, position);
  if (!truth || !knowledge) return state;
  knowledge.revealed = true;
  knowledge.forgotten = false;
  knowledge.terrain = truth.terrain;
  knowledge.nearbyHazards = countNearbyHazards(state, position);
  pushEvent(
    state,
    'TILE_REVEALED',
    knowledge.nearbyHazards === 0
      ? '四周暂时寂静，没有侦测到相邻危险。'
      : knowledge.nearbyHazards >= 3
        ? `四周极度危险：相邻 ${knowledge.nearbyHazards} 格存在威胁。`
        : `藤叶下有异常动静：相邻 ${knowledge.nearbyHazards} 格存在威胁。`,
  );
  if (truth.hazard && !knowledge.hazard) {
    knowledge.hazard = truth.hazard;
    state.rover.hp = Math.max(0, state.rover.hp - 1);
    pushEvent(state, 'HAZARD_TRIGGERED', hazardNarration[truth.hazard]);
    if (truth.hazard === 'UNKNOWN_EVENT' && state.rover.carryingRelic && state.rover.hp > 0) {
      dropRelic(state);
    }
  }
  if (truth.resource) resolveResource(state, knowledge, truth.resource);
  state.updatedAt = now();
  checkEndConditions(state);
  return state;
}

export function applyLocalization(
  state: GameState,
  position: Position,
  confidence: number,
  heading = state.rover.heading,
): GameState {
  if (state.phase === 'WON' || state.phase === 'LOST') return state;
  if (confidence < 0.6) throw new Error('Localization confidence is below the 0.60 referee threshold');
  if (!getTruth(state, position)) throw new Error('Localized position is outside the game board');
  state.rover.position = position;
  state.rover.heading = heading;
  state.rover.batteryPercent = Math.max(0, state.rover.batteryPercent - 1);
  state.round += 1;
  if (state.pendingPlan) state.pendingPlan.status = 'CONFIRMED';
  pushEvent(
    state,
    'ROVER_LOCALIZED',
    `全局摄像头裁定探险车位于第 ${position.row + 1} 行第 ${position.col + 1} 列。`,
  );
  revealAt(state, position);
  checkEndConditions(state);
  return state;
}

export function advanceClock(state: GameState, realDeltaMs: number): GameState {
  if (state.phase === 'WON' || state.phase === 'LOST') return state;
  const multiplier = state.phase === 'AWAKENED' ? state.config.awakeningTimeMultiplier : 1;
  state.elapsedMs += Math.max(0, realDeltaMs) * multiplier;
  state.updatedAt = now();
  checkEndConditions(state);
  return state;
}

export function checkEndConditions(state: GameState): GameState {
  if (state.phase === 'WON' || state.phase === 'LOST') return state;
  if (state.rover.hp <= 0) {
    state.phase = 'LOST';
    pushEvent(state, 'GAME_LOST', '探险车 HP 归零，行动能力丧失。');
  } else if (state.elapsedMs >= state.config.durationMs) {
    state.phase = 'LOST';
    pushEvent(state, 'GAME_LOST', '倒计时归零，丛林封锁了撤离路线。');
  } else if (
    state.rover.carryingRelic &&
    samePosition(state.rover.position, state.start) &&
    state.rover.hp >= 1
  ) {
    state.phase = 'WON';
    pushEvent(state, 'GAME_WON', '探险队携带遗迹回到起点，成功撤离！');
  }
  return state;
}

export function toPublicState(state: GameState): PublicGameState {
  const publicState = structuredClone(state);
  delete (publicState as Partial<GameState>).truth;
  return {
    ...(publicState as unknown as Omit<GameState, 'truth'>),
    remainingMs: Math.max(0, state.config.durationMs - state.elapsedMs),
  };
}

export function toObserverState(
  state: GameState,
  riskMap: ObserverGameState['riskMap'],
): ObserverGameState {
  return { ...toPublicState(state), truth: structuredClone(state.truth), riskMap };
}
