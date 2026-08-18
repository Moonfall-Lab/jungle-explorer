export const INTENT_CARDS = ['CAUTIOUS', 'EXPLORE', 'VERIFY', 'FIND_CLUE'] as const;
export type IntentCard = (typeof INTENT_CARDS)[number];

export const HAZARD_TYPES = ['ROCKFALL', 'SNAKE_NEST', 'VINE_TRAP', 'UNKNOWN_EVENT'] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

export const RESOURCE_TYPES = [
  'WATER',
  'RARE_FLOWER',
  'RELIC_MARKER',
  'RELIC',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type Terrain = 'GRASSLAND' | 'RAINFOREST' | 'SWAMP' | 'CLEARING';
export type GamePhase = 'EXPLORING' | 'AWAKENED' | 'WON' | 'LOST';
export type Heading = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';
export type AgentPersona = 'CAUTIOUS' | 'DAREDEVIL' | 'FORAGER' | 'INSTINCT';
export interface AgentPersonaProfile {
  name: string;
  title: string;
  description: string;
  credo: string;
  preference: string;
  weights: {
    risk: number;
    information: number;
    resource: number;
    progress: number;
    tensionResponse: number;
  };
}
export const AGENT_PERSONA_PROFILES: Record<AgentPersona, AgentPersonaProfile> = {
  CAUTIOUS: {
    name: '守望者', title: '谨慎型探索者', description: '尽量避开未知区域，优先选择已知、低风险且便于撤退的路线。', credo: '看清前路，再稳步前进。', preference: '低风险路径优先',
    weights: { risk: 0.62, information: 0.16, resource: 0.12, progress: 0.1, tensionResponse: 0.25 },
  },
  DAREDEVIL: {
    name: '开路者', title: '丛林冒险家', description: '偏好高风险路径，愿意用更大胆的探索换取速度与新发现。', credo: '越过危险，才能发现新的道路。', preference: '未知信息优先',
    weights: { risk: 0.2, information: 0.48, resource: 0.12, progress: 0.2, tensionResponse: -0.15 },
  },
  FORAGER: {
    name: '寻迹者', title: '资源采集者', description: '优先寻找水源与花朵，并在规划路线时更重视沿途资源。', credo: '每一份资源，都可能改变远征。', preference: '资源收益优先',
    weights: { risk: 0.34, information: 0.18, resource: 0.36, progress: 0.12, tensionResponse: 0.1 },
  },
  INSTINCT: {
    name: '逐风者', title: '直觉型智能体', description: '基于附近的局部信息快速决策，及时选择当前最有利的方向。', credo: '信息有限，也要果断前行。', preference: '目标进度优先',
    weights: { risk: 0.3, information: 0.28, resource: 0.12, progress: 0.3, tensionResponse: 0 },
  },
};
export type VictoryMode = 'RETURN_TO_BASE' | 'RELIC_ONLY';
export type MockFieldScenario = 'NORMAL' | 'DRIFT' | 'FAILURE';

export interface Position {
  row: number;
  col: number;
}

export interface TileTruth {
  position: Position;
  terrain: Terrain;
  hazard?: HazardType;
  resource?: ResourceType;
}

export interface TileKnowledge {
  position: Position;
  terrain?: Terrain;
  revealed: boolean;
  forgotten: boolean;
  nearbyHazards?: number;
  hazard?: HazardType;
  resource?: ResourceType;
  consumed?: boolean;
}

export interface RoverState {
  id: string;
  position: Position;
  heading: Heading;
  hp: number;
  maxHp: number;
  batteryPercent: number;
  carryingRelic: boolean;
}

export interface BioSignal {
  heartRate: number;
  hrv?: number;
  tension: number;
  confidence: number;
  capturedAt: string;
}

export interface AgentState {
  persona: AgentPersona;
  stance: 'CAUTIOUS' | 'EXPLORING' | 'EVACUATING';
  explanation: string;
  lastIntent?: IntentCard;
  teamTension: number;
  riskAtRover: number;
}

export interface GameEvent {
  id: string;
  at: string;
  kind:
    | 'GAME_STARTED'
    | 'INTENT_PLAYED'
    | 'AGENT_PLANNED'
    | 'AGENT_PERSONA_CHANGED'
    | 'ROVER_MOVED'
    | 'ROVER_FAILED'
    | 'ROVER_LOCALIZED'
    | 'TILE_REVEALED'
    | 'HAZARD_TRIGGERED'
    | 'RESOURCE_FOUND'
    | 'CLUE_GRANTED'
    | 'JUNGLE_AWAKENED'
    | 'GAME_WON'
    | 'GAME_LOST';
  message: string;
}

export interface MotionCommand {
  action: 'FORWARD' | 'TURN_LEFT' | 'TURN_RIGHT';
  cells?: number;
  degrees?: 90;
}

export interface ActionPlan {
  id: string;
  intent: IntentCard;
  target: Position;
  path: Position[];
  commands: MotionCommand[];
  expectedRisk: number;
  explanation: string;
  status: 'PENDING' | 'DISPATCHED' | 'CONFIRMED' | 'FAILED';
}

export interface FieldFeedback {
  source: 'MOCK' | 'HARDWARE';
  scenario?: MockFieldScenario;
  status: 'IDLE' | 'MOVING' | 'SCANNING' | 'LOCKED' | 'FAILED';
  actualPath: Position[];
  progress: number;
  robotOnline: boolean;
  localizationOnline: boolean;
  cameraOnline: boolean;
  message: string;
  confidence?: number;
}

export interface GameConfig {
  rows: number;
  columns: number;
  durationMs: number;
  startingHp: number;
  maxHp: number;
  hazards: number;
  relics: number;
  relicMarkers: number;
  waterSources: number;
  rareFlowers: number;
  victoryMode: VictoryMode;
  awakeningTimeMultiplier: number;
}

export interface GameState {
  id: string;
  seed: string;
  config: GameConfig;
  phase: GamePhase;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  start: Position;
  rover: RoverState;
  truth: TileTruth[];
  knowledge: TileKnowledge[];
  relicMarkersFound: number;
  pathHints: Position[];
  round: number;
  pendingPlan?: ActionPlan;
  fieldFeedback?: FieldFeedback;
  agent: AgentState;
  latestBio?: BioSignal;
  events: GameEvent[];
}

export interface PublicGameState extends Omit<GameState, 'truth'> {
  remainingMs: number;
}

export interface ObserverGameState extends PublicGameState {
  truth: TileTruth[];
  riskMap: Array<{ position: Position; risk: number }>;
}

export const positionKey = ({ row, col }: Position): string => `${row}:${col}`;
export const samePosition = (a: Position, b: Position): boolean => a.row === b.row && a.col === b.col;
