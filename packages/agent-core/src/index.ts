import type {
  ActionPlan,
  AgentPersona,
  GameState,
  IntentCard,
  Position,
  TileKnowledge,
} from '@jungle/shared-types';
import { positionKey, samePosition } from '@jungle/shared-types';
import { findPath, neighbors, pathToCommands } from '@jungle/navigation';

export interface RiskCell {
  position: Position;
  risk: number;
}

interface PolicyWeights {
  risk: number;
  information: number;
  resource: number;
  progress: number;
  tensionResponse: number;
}

const personaWeights: Record<AgentPersona, PolicyWeights> = {
  CAUTIOUS: { risk: 0.62, information: 0.16, resource: 0.12, progress: 0.1, tensionResponse: 0.25 },
  DAREDEVIL: { risk: 0.2, information: 0.48, resource: 0.12, progress: 0.2, tensionResponse: -0.15 },
  FORAGER: { risk: 0.34, information: 0.18, resource: 0.36, progress: 0.12, tensionResponse: 0.1 },
  INSTINCT: { risk: 0.3, information: 0.28, resource: 0.12, progress: 0.3, tensionResponse: 0 },
};

const knowledgeAt = (state: GameState, position: Position): TileKnowledge | undefined =>
  state.knowledge.find((tile) => samePosition(tile.position, position));

export function buildRiskMap(state: GameState): RiskCell[] {
  const knownHazards = state.knowledge.filter((tile) => tile.hazard).length;
  const unknown = state.knowledge.filter((tile) => !tile.revealed).length;
  const baseRisk = Math.min(0.85, Math.max(0.05, (state.config.hazards - knownHazards) / Math.max(1, unknown)));
  const risks = new Map(state.knowledge.map((tile) => [positionKey(tile.position), tile.hazard ? 1 : tile.revealed ? 0 : baseRisk]));

  for (const clue of state.knowledge.filter(
    (tile) => tile.revealed && tile.nearbyHazards !== undefined && !tile.hazard,
  )) {
    const adjacent = neighbors(clue.position, {
      rows: state.config.rows,
      columns: state.config.columns,
      allowDiagonal: true,
    });
    const knownAdjacent = adjacent.filter((position) => knowledgeAt(state, position)?.hazard).length;
    const hiddenAdjacent = adjacent.filter((position) => !knowledgeAt(state, position)?.revealed);
    const inferred = Math.max(0, (clue.nearbyHazards! - knownAdjacent) / Math.max(1, hiddenAdjacent.length));
    for (const position of hiddenAdjacent) {
      const key = positionKey(position);
      risks.set(key, Math.min(1, Math.max(risks.get(key) ?? baseRisk, inferred)));
    }
  }
  for (const hint of state.pathHints) risks.set(positionKey(hint), 0);
  return state.knowledge.map((tile) => ({
    position: tile.position,
    risk: Number((risks.get(positionKey(tile.position)) ?? baseRisk).toFixed(3)),
  }));
}

function candidatePositions(state: GameState, intent: IntentCard): Position[] {
  const rover = state.rover.position;
  const radius = intent === 'EXPLORE' ? 2 : 1;
  return state.knowledge
    .map((tile) => tile.position)
    .filter((position) => !samePosition(position, rover))
    .filter((position) => {
      const rowDistance = Math.abs(position.row - rover.row);
      const colDistance = Math.abs(position.col - rover.col);
      if (intent === 'VERIFY') return rowDistance + colDistance === 1;
      return Math.max(rowDistance, colDistance) <= radius;
    });
}

function distanceTo(position: Position, target: Position): number {
  return Math.abs(position.row - target.row) + Math.abs(position.col - target.col);
}

function progressTarget(state: GameState): Position {
  if (state.rover.carryingRelic) return state.start;
  const hinted = state.pathHints.at(-1);
  if (hinted) return hinted;
  return { row: state.start.row, col: state.config.columns - 1 };
}

function explanationFor(
  state: GameState,
  intent: IntentCard,
  target: Position,
  risk: number,
): string {
  const tension = state.agent.teamTension;
  const coordinate = `第 ${target.row + 1} 行第 ${target.col + 1} 列`;
  if (state.phase === 'AWAKENED') return `丛林已经苏醒。我会压缩试探，沿风险 ${(risk * 100).toFixed(0)}% 的路线返回起点。`;
  if (intent === 'CAUTIOUS') return `我接受谨慎意图。${coordinate} 的估计风险为 ${(risk * 100).toFixed(0)}%，是近邻中更稳妥的落点。`;
  if (intent === 'EXPLORE') return `藤蔓遮挡视线，但${coordinate}能带来更多未知信息；我愿意承担 ${(risk * 100).toFixed(0)}% 的估计风险。`;
  if (intent === 'VERIFY') return `我只做一次正交试探，前往${coordinate}验证当前危险约束，避免扩大误差。`;
  if (tension > 0.7) return `团队紧张度偏高，我会沿已确认的正确线索前进，同时保留回撤余地。`;
  return `花粉留下了可靠痕迹。我将把正确线索转化为一步可执行的移动，而不是盲目服从。`;
}

export function decideAction(state: GameState, intent: IntentCard): ActionPlan {
  if (state.phase === 'WON' || state.phase === 'LOST') throw new Error('The game has already ended');
  if (state.pendingPlan?.status === 'PENDING' || state.pendingPlan?.status === 'DISPATCHED') {
    throw new Error('A rover plan is still awaiting localization');
  }
  const riskMap = buildRiskMap(state);
  const risks = new Map(riskMap.map((cell) => [positionKey(cell.position), cell.risk]));
  const weights = personaWeights[state.agent.persona];
  const targetForProgress = progressTarget(state);
  const candidates = candidatePositions(state, intent);
  const maxDistance = state.config.rows + state.config.columns;
  const scored = candidates
    .map((position) => {
      const knowledge = knowledgeAt(state, position);
      const risk = risks.get(positionKey(position)) ?? 0.5;
      const information = knowledge?.revealed ? 0 : 1;
      const resource = knowledge?.resource && !knowledge.consumed ? 1 : 0;
      const progress = 1 - distanceTo(position, targetForProgress) / maxDistance;
      const tensionRisk = weights.tensionResponse * state.agent.teamTension * risk;
      let score =
        -weights.risk * risk +
        weights.information * information +
        weights.resource * resource +
        weights.progress * progress -
        tensionRisk;
      if (intent === 'CAUTIOUS') score -= risk * 0.45;
      if (intent === 'EXPLORE') score += information * 0.42;
      if (intent === 'VERIFY') score += (knowledge?.revealed ? 0.3 : 0.1) - risk * 0.25;
      if (intent === 'FIND_CLUE' && state.pathHints.some((hint) => samePosition(hint, position))) score += 2;
      return { position, risk, score };
    })
    .sort((a, b) => b.score - a.score || positionKey(a.position).localeCompare(positionKey(b.position)));
  const selection = scored[0];
  if (!selection) throw new Error('No legal movement candidates');

  const knownBlocked = new Set(
    state.knowledge.filter((tile) => tile.hazard).map((tile) => positionKey(tile.position)),
  );
  const path = findPath(state.rover.position, selection.position, {
    rows: state.config.rows,
    columns: state.config.columns,
    blocked: knownBlocked,
    cost: (position) => (risks.get(positionKey(position)) ?? 0.5) * 4,
  });
  if (path.length === 0) throw new Error('No navigable path to selected target');
  const expectedRisk = Math.max(...path.slice(1).map((position) => risks.get(positionKey(position)) ?? 0.5), 0);
  const explanation = explanationFor(state, intent, selection.position, expectedRisk);
  return {
    id: `${state.id}-plan-${state.round + 1}-${positionKey(selection.position).replace(':', '-')}`,
    intent,
    target: selection.position,
    path,
    commands: pathToCommands(path, state.rover.heading),
    expectedRisk,
    explanation,
    status: 'PENDING',
  };
}

export function updateAgentFromBio(state: GameState, tension: number): void {
  const previous = state.agent.teamTension;
  state.agent.teamTension = Number((previous * 0.65 + tension * 0.35).toFixed(3));
}
