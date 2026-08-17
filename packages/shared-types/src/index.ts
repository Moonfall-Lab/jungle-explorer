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
export type VictoryMode = 'RETURN_TO_BASE' | 'RELIC_ONLY';

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
