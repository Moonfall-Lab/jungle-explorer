import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ActionPlan, AgentPersona, HazardType, IntentCard, MockFieldScenario, Position, PublicGameState, ResourceType } from '@jungle/shared-types';
import { AGENT_PERSONA_PROFILES, samePosition } from '@jungle/shared-types';
import { BioHud, EventFeed, JungleMap, RoverHud, time } from '@jungle/ui-components';
import { CardScanner, type CardScanResult } from './CardScanner';
import { ModelViewer, type ScanAsset } from './ModelViewer.js';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type StrategyCard = { id: IntentCard; title: string; english: string; description: string; image: string; physicalImage: string };
const cards: StrategyCard[] = [
  { id: 'CAUTIOUS', title: '谨慎推进', english: 'CAUTIOUS', description: '优先沿低风险、已知区域推进', image: '/cards/cautious-action.jpg', physicalImage: '/cards/cautious.webp' },
  { id: 'EXPLORE', title: '深入探索', english: 'EXPLORE', description: '深入未知区域，换取更多地图信息', image: '/cards/explore-action.jpg', physicalImage: '/cards/explore.webp' },
  { id: 'VERIFY', title: '验证路径', english: 'VERIFY', description: '小范围试探，确认附近危险线索', image: '/cards/verify-action.jpg', physicalImage: '/cards/verify.webp' },
  { id: 'FIND_CLUE', title: '寻找线索', english: 'FIND CLUE', description: '获得一条可靠的下一步方向', image: '/cards/clue-action.jpg', physicalImage: '/cards/clue.webp' },
];

type PresentationStage = 'OBSERVE' | 'CHOOSE' | 'THINKING' | 'MOVING' | 'VERIFYING' | 'REVEAL';

const cardGuidance: Record<IntentCard, { range: string; reaction: string }> = {
  CAUTIOUS: { range: '周围一格 · 优先低风险', reaction: '我会先排除危险，再选择便于撤退的落点。' },
  EXPLORE: { range: '两格范围 · 高信息', reaction: '更远意味着更多未知，但也可能找到突破口。' },
  VERIFY: { range: '上下左右 · 验证线索', reaction: '我会用一次可控试探，确认已有判断。' },
  FIND_CLUE: { range: '一步提示 · 确定安全', reaction: '先取得可靠方向，再决定后续路线。' },
};

const stageCopy: Record<PresentationStage, { kicker: string; title: string; copy: string }> = {
  OBSERVE: { kicker: 'OBSERVE THE JUNGLE', title: '观察丛林', copy: '阅读地图，与队友讨论下一步策略。' },
  CHOOSE: { kicker: 'CHOOSE INTENT', title: '选择你希望 Agent 采取的探索策略', copy: '和队友讨论，并表达下一轮探索倾向。' },
  THINKING: { kicker: 'AGENT THINKING', title: 'Agent 正在权衡候选位置', copy: '地图中的候选格会依次接受评估。' },
  MOVING: { kicker: 'EXECUTING PLAN', title: '探索机器人正在执行路线', copy: '虚线为规划路线；实际位置将随定位结果更新。' },
  VERIFYING: { kicker: 'POSITION LOCK', title: '正在确认机器人最终位置', copy: '途经格不会结算，仅最终落点会被揭示。' },
  REVEAL: { kicker: 'CELL CONFIRMED', title: '新区域已确认', copy: '迷雾退散，正在结算格子信息。' },
};

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const TURN_TIMING = {
  thinking: 650,
  moving: 450,
  verifying: 250,
  reveal: 400,
  observe: 250,
} as const;

function positionsForIntent(state: PublicGameState, intent: IntentCard): Position[] {
  if (intent === 'FIND_CLUE' && state.pathHints.length > 0) return state.pathHints;
  const positions: Position[] = [];
  for (let row = 0; row < state.config.rows; row += 1) {
    for (let col = 0; col < state.config.columns; col += 1) {
      const rowDistance = Math.abs(row - state.rover.position.row);
      const colDistance = Math.abs(col - state.rover.position.col);
      const isCurrent = rowDistance === 0 && colDistance === 0;
      const included = intent === 'EXPLORE'
        ? Math.max(rowDistance, colDistance) <= 2
        : intent === 'VERIFY'
          ? rowDistance + colDistance === 1
          : Math.max(rowDistance, colDistance) <= 1;
      if (!isCurrent && included) positions.push({ row, col });
    }
  }
  return positions;
}

const itemNames: Partial<Record<HazardType | ResourceType, string>> = {
  ROCKFALL: '落石区', SNAKE_NEST: '毒蛇巢穴', VINE_TRAP: '藤蔓陷阱', UNKNOWN_EVENT: '未知危险',
  WATER: '清洁水源', RARE_FLOWER: '稀有花朵', RELIC_MARKER: '遗迹标记', RELIC: '远古遗迹',
};

const scanAssets: ScanAsset[] = [
  { id: 'ROCKFALL', title: '落石区', subtitle: '危险样本 HZ-01', url: '/assets/models/rockfall.glb', textureUrl: '/assets/textures/rockfall.jpg', tone: 'warning' },
  { id: 'SNAKE_NEST', title: '毒蛇巢穴', subtitle: '危险样本 HZ-02', url: '/assets/models/snake-nest.glb', textureUrl: '/assets/textures/snake-nest.jpg', tone: 'warning' },
  { id: 'VINE_TRAP', title: '断裂藤蔓', subtitle: '危险样本 HZ-03', url: '/assets/models/vine-trap.glb', textureUrl: '/assets/textures/vine-trap.jpg', tone: 'warning' },
  { id: 'WATER', title: '清洁水源', subtitle: '补给样本 RS-01', url: '/assets/models/water.glb', textureUrl: '/assets/textures/water.jpg', tone: 'safe' },
  { id: 'RARE_FLOWER', title: '稀有花朵', subtitle: '线索样本 RS-02', url: '/assets/models/rare-flower.glb', textureUrl: '/assets/textures/rare-flower.jpg', tone: 'safe' },
  { id: 'RELIC_MARKER', title: '遗迹标记', subtitle: '遗迹样本 AR-01', url: '/assets/models/relic-marker.glb', textureUrl: '/assets/textures/relic-marker.jpg', tone: 'relic' },
];

const mapArtwork: Partial<Record<HazardType | ResourceType, string>> = {
  ROCKFALL: '/assets/map-items/rockfall.webp',
  SNAKE_NEST: '/assets/map-items/snake-nest.webp',
  VINE_TRAP: '/assets/map-items/vine-trap.webp',
  UNKNOWN_EVENT: '/assets/map-items/vine-trap.webp',
  WATER: '/assets/map-items/water.webp',
  RARE_FLOWER: '/assets/map-items/rare-flower.webp',
  RELIC_MARKER: '/assets/map-items/relic-marker.webp',
  RELIC: '/assets/map-items/relic-marker.webp',
};

const assetForTile = (hazard?: HazardType, resource?: ResourceType): ScanAsset | undefined => {
  const id = hazard ?? resource;
  if (id === 'UNKNOWN_EVENT') return scanAssets.find((asset) => asset.id === 'VINE_TRAP');
  if (id === 'RELIC') return scanAssets.find((asset) => asset.id === 'RELIC_MARKER');
  return scanAssets.find((asset) => asset.id === id);
};

function AgentPersonaPanel({
  state,
  stage,
  intent,
  candidates,
  target,
}: {
  state: PublicGameState;
  stage: PresentationStage;
  intent?: IntentCard;
  candidates: Position[];
  target?: Position;
}) {
  const persona = AGENT_PERSONA_PROFILES[state.agent.persona];
  const hasRouteAssessment = Boolean(state.agent.lastIntent);
  const riskBand = state.agent.riskAtRover < .22 ? 'LOW RISK' : state.agent.riskAtRover < .5 ? 'UNCERTAIN' : 'HIGH RISK';
  const isThinking = stage === 'THINKING';
  const isExecuting = stage === 'MOVING' || stage === 'VERIFYING';
  return (
    <section className={`panel compact-panel agent-mind persona-panel stage-${stage.toLowerCase()}`}>
      <div className="panel-title-row">
        <div><p className="eyebrow">AGENT MIND</p><h3>{persona.name}</h3></div>
        <span className={`stance ${state.agent.stance.toLowerCase()}`}>{isThinking ? 'WEIGHING' : isExecuting ? 'EXECUTING' : state.agent.stance}</span>
      </div>
      <p className="agent-strategy">{intent ? cards.find((card) => card.id === intent)?.title : state.agent.stance === 'EVACUATING' ? '安全撤离' : '评估下一步'}</p>
      {isThinking ? (
        <div className="candidate-stack">
          <small>正在权衡</small>
          {candidates.map((position, index) => <div key={`${position.row}:${position.col}`}><b>{String.fromCharCode(65 + index)}</b><span>R{position.row + 1} C{position.col + 1}</span><em>{index === 0 ? '风险较低' : index === 1 ? '信息价值高' : '可验证判断'}</em></div>)}
        </div>
      ) : null}
      <p className="agent-copy">“{intent ? cardGuidance[intent].reaction : state.agent.explanation}”</p>
      {target && (stage === 'MOVING' || stage === 'VERIFYING' || stage === 'REVEAL') ? <div className="decision-lock"><span>DECISION LOCKED</span><strong>R{target.row + 1} · C{target.col + 1}</strong></div> : null}
      <div className="agent-status-grid">
        <span><small>当前人格</small><b>{persona.title}</b></span>
        <span><small>行为偏好</small><b>{persona.preference}</b></span>
        <span><small>当前路线风险</small><b className={`risk-language risk-${riskBand.toLowerCase().replace(' ', '-')}`}>{hasRouteAssessment ? `${riskBand} · ${Math.round(state.agent.riskAtRover * 100)}%` : '待评估'}</b></span>
      </div>
      {state.fieldFeedback?.status === 'FAILED' ? <p className="agent-field-alert">{state.fieldFeedback.message}</p> : null}
    </section>
  );
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new Error((await response.json()).error ?? `Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

interface RoverConnection {
  roverMode: 'virtual' | 'hardware' | 'mock';
  configured: boolean;
  ip: string | null;
  localizationMode: 'required' | 'disabled';
  mockScenario?: MockFieldScenario;
  online?: boolean;
  motors?: { left: number; right: number; speed: number };
  error?: string;
}

function RoverConnectionPanel() {
  const [connection, setConnection] = useState<RoverConnection>();
  const [ip, setIp] = useState('192.168.20.155');
  const [message, setMessage] = useState('');
  const [mockScenario, setMockScenario] = useState<MockFieldScenario>('NORMAL');
  const [busy, setBusy] = useState<'check' | 'connect' | 'virtual' | 'mock'>();

  const loadConnection = useCallback(async () => {
    const next = await jsonRequest<RoverConnection>('/api/operator/rover');
    setConnection(next);
    if (next.ip) setIp(next.ip);
  }, []);

  useEffect(() => {
    void loadConnection().catch((reason: unknown) => {
      setMessage(reason instanceof Error ? reason.message : '无法读取小车配置');
    });
    const timer = window.setInterval(() => void loadConnection().catch(() => undefined), 3000);
    return () => window.clearInterval(timer);
  }, [loadConnection]);

  const run = async (action: 'check' | 'connect' | 'virtual' | 'mock') => {
    setBusy(action);
    setMessage('');
    try {
      const result = await jsonRequest<RoverConnection>(`/api/operator/rover/${action}`, {
        method: 'POST',
        body: action === 'virtual' ? '{}' : action === 'mock' ? JSON.stringify({ scenario: mockScenario }) : JSON.stringify({ ip }),
      });
      if (action === 'check') {
        setConnection((current) => current ? { ...current, ...result } : result);
        setMessage(result.online ? '探索机器人在线，状态接口响应正常' : result.error || '探索机器人离线');
      } else {
        setConnection(result);
        setMessage(action === 'connect' ? '实体探索机器人已连接，后续任务将发送到该 IP' : action === 'mock' ? `现场 Mock 已启用：${mockScenario}` : '已切回虚拟探索机器人');
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setBusy(undefined);
    }
  };

  const hardwareConnected = connection?.roverMode === 'hardware' && connection.configured;
  const mockConnected = connection?.roverMode === 'mock' && connection.configured;
  return (
    <section className="panel rover-connect-panel">
      <div className="rover-connect-heading">
        <div><p className="eyebrow">EXPLORER LINK</p><h2>探索机器人连接</h2></div>
        <span className={`connection-state ${hardwareConnected || mockConnected ? 'connected' : 'virtual'}`}>
          {hardwareConnected ? '实体机器人' : mockConnected ? `现场 Mock · ${connection.mockScenario}` : '虚拟机器人'}
        </span>
      </div>
      <div className="rover-connect-controls">
        <label>
          <span>探索机器人 IP</span>
          <input aria-label="探索机器人 IP" inputMode="decimal" value={ip} onChange={(event) => setIp(event.target.value)} placeholder="192.168.20.155" />
        </label>
        <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void run('check')}>
          {busy === 'check' ? '检查中…' : '检查'}
        </button>
        <button className="primary-button" disabled={Boolean(busy)} onClick={() => void run('connect')}>
          {busy === 'connect' ? '连接中…' : '连接实体机器人'}
        </button>
        <button className="secondary-button" disabled={Boolean(busy) || (!hardwareConnected && !mockConnected)} onClick={() => void run('virtual')}>
          切回虚拟机器人
        </button>
        <label className="mock-scenario-field">
          <span>现场 Mock 预设</span>
          <select aria-label="现场 Mock 预设" value={mockScenario} onChange={(event) => setMockScenario(event.target.value as MockFieldScenario)}>
            <option value="NORMAL">NORMAL · 正常定位</option>
            <option value="DRIFT">DRIFT · 落点漂移</option>
            <option value="FAILURE">FAILURE · 摄像头失败</option>
          </select>
        </label>
        <button className="mock-button" disabled={Boolean(busy)} onClick={() => void run('mock')}>
          {busy === 'mock' ? '启动中…' : '启用现场 Mock'}
        </button>
      </div>
      <div className="rover-connect-status" aria-live="polite">
        <span>{hardwareConnected ? `${connection.ip} · 仅运动模式` : mockConnected ? `${connection.mockScenario} · 异步轨迹与摄像定位反馈` : '尚未连接实体探索机器人'}</span>
        {connection?.motors && <span>电机 L {connection.motors.left} · R {connection.motors.right} · SPD {connection.motors.speed}</span>}
        {message && <strong>{message}</strong>}
      </div>
    </section>
  );
}

export function App() {
  const [state, setState] = useState<PublicGameState>();
  const [busy, setBusy] = useState(false);
  const [presentationStage, setPresentationStage] = useState<PresentationStage>('CHOOSE');
  const [hoveredCard, setHoveredCard] = useState<IntentCard>();
  const [activeIntent, setActiveIntent] = useState<IntentCard>();
  const [presentationPlan, setPresentationPlan] = useState<ActionPlan>();
  const [revealedPosition, setRevealedPosition] = useState<Position>();
  const [awakeningFx, setAwakeningFx] = useState(false);
  const [playingCard, setPlayingCard] = useState<IntentCard>();
  const [controlTab, setControlTab] = useState<'cards' | 'scanner'>(() => (
    new URLSearchParams(window.location.search).get('control') === 'scanner' ? 'scanner' : 'cards'
  ));
  const [scanFeedback, setScanFeedback] = useState('');
  const [playedEffect, setPlayedEffect] = useState<{ id: number; card: IntentCard; origin: { x: number; y: number } }>();
  const [scanArrival, setScanArrival] = useState<{ id: number; card: IntentCard }>();
  const [cardOutcome, setCardOutcome] = useState<{ id: number; card: IntentCard; label: string }>();
  const [selected, setSelected] = useState<Position>();
  const [scanAsset, setScanAsset] = useState<ScanAsset>();
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const sequenceActiveRef = useRef(false);
  const sequenceIdRef = useRef(0);
  const previousPhaseRef = useRef<PublicGameState['phase'] | undefined>(undefined);
  const refresh = useCallback(async () => {
    if (sequenceActiveRef.current) return;
    try { setState(await jsonRequest<PublicGameState>('/api/games/current')); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法连接 Game Server'); }
  }, []);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 1000); return () => window.clearInterval(timer); }, [refresh]);

  useEffect(() => {
    if (!state) return;
    setSelected(state.rover.position);
    const tile = state.knowledge.find((candidate) => samePosition(candidate.position, state.rover.position));
    setScanAsset(assetForTile(tile?.hazard, tile?.resource));
  }, [state?.round]);

  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = state?.phase;
    if (previous !== 'EXPLORING' || state?.phase !== 'AWAKENED') return;
    setAwakeningFx(true);
    const timer = window.setTimeout(() => setAwakeningFx(false), 2400);
    return () => window.clearTimeout(timer);
  }, [state?.phase]);

  const play = async (card: IntentCard, origin?: { x: number; y: number }) => {
    if (!state || busy || state.phase === 'WON' || state.phase === 'LOST'
      || state.pendingPlan?.status === 'PENDING' || state.pendingPlan?.status === 'DISPATCHED') return;
    const sequenceId = sequenceIdRef.current + 1;
    sequenceIdRef.current = sequenceId;
    sequenceActiveRef.current = true;
    setBusy(true);
    setPlayingCard(card);
    setActiveIntent(card);
    setHoveredCard(undefined);
    setPresentationPlan(undefined);
    setRevealedPosition(undefined);
    setPresentationStage('THINKING');
    setPlayedEffect({
      id: Date.now(),
      card,
      origin: origin ?? { x: window.innerWidth / 2, y: window.innerHeight - 40 },
    });
    try {
      const thinkingStartedAt = Date.now();
      const result = await jsonRequest<{ state: PublicGameState; plan: ActionPlan }>(`/api/games/${state.id}/intents`, { method: 'POST', body: JSON.stringify({ card }) });
      if (sequenceIdRef.current !== sequenceId) return;
      setPresentationPlan(result.plan);
      setState(result.state);
      await sleep(Math.max(0, TURN_TIMING.thinking - (Date.now() - thinkingStartedAt)));
      if (sequenceIdRef.current !== sequenceId) return;
      setError('');
      setPresentationStage('MOVING');
      await sleep(result.state.pendingPlan?.status === 'DISPATCHED' ? 120 : TURN_TIMING.moving);

      let finalState = result.state;
      for (let attempt = 0; finalState.pendingPlan?.status === 'PENDING' || finalState.pendingPlan?.status === 'DISPATCHED'; attempt += 1) {
        if (sequenceIdRef.current !== sequenceId) return;
        if (attempt > 120) throw new Error('探索机器人长时间未返回定位结果');
        await sleep(finalState.fieldFeedback ? 220 : 700);
        finalState = await jsonRequest<PublicGameState>(`/api/games/${state.id}`);
        setState(finalState);
        if (finalState.fieldFeedback?.status === 'SCANNING') setPresentationStage('VERIFYING');
      }
      if (finalState.pendingPlan?.status === 'FAILED') throw new Error('探索机器人未能完成本轮任务');
      if (sequenceIdRef.current !== sequenceId) return;

      setPresentationStage('VERIFYING');
      await sleep(TURN_TIMING.verifying);
      setState(finalState);
      setSelected(finalState.rover.position);
      const revealedTile = finalState.knowledge.find((tile) => samePosition(tile.position, finalState.rover.position));
      setScanAsset(assetForTile(revealedTile?.hazard, revealedTile?.resource));
      await sleep(100);
      setRevealedPosition(finalState.rover.position);
      setPresentationStage('REVEAL');
      await sleep(TURN_TIMING.reveal);
      setPresentationStage('OBSERVE');
      await sleep(TURN_TIMING.observe);
      if (sequenceIdRef.current !== sequenceId) return;
      setPresentationStage('CHOOSE');
      setPresentationPlan(undefined);
      setRevealedPosition(undefined);
      setActiveIntent(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '行动失败');
      setCardOutcome({ id: Date.now(), card, label: '指令未执行 · 卡牌退回' });
      setPresentationStage('CHOOSE');
      setPresentationPlan(undefined);
      setActiveIntent(undefined);
    }
    finally {
      if (sequenceIdRef.current === sequenceId) {
        sequenceActiveRef.current = false;
        setBusy(false);
        setPlayingCard(undefined);
      }
    }
  };

  const changePersona = async (persona: AgentPersona) => {
    if (!state) return;
    setBusy(true);
    try {
      setState(await jsonRequest<PublicGameState>(`/api/games/${state.id}/persona`, {
        method: 'PATCH',
        body: JSON.stringify({ persona }),
      }));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '人格切换失败');
    } finally {
      setBusy(false);
    }
  };

  const handleScan = ({ card }: CardScanResult) => {
    if (!state || busy || state.phase === 'WON' || state.phase === 'LOST'
      || state.pendingPlan?.status === 'PENDING' || state.pendingPlan?.status === 'DISPATCHED') {
      setScanFeedback('上一张卡牌仍在执行，请稍候');
      return;
    }
    const definition = cards.find((candidate) => candidate.id === card);
    setScanFeedback(`识别成功：${definition?.title ?? card}`);
    setScanArrival({ id: Date.now(), card });
    void play(card, { x: window.innerWidth - 70, y: window.innerHeight - 55 });
  };

  const reset = async (mode: 'standard' | 'demo') => {
    if (resetting) return;
    sequenceIdRef.current += 1;
    sequenceActiveRef.current = false;
    setResetting(true);
    setRestartOpen(false);
    setSystemOpen(false);
    setPresentationStage('CHOOSE');
    setPresentationPlan(undefined);
    setRevealedPosition(undefined);
    setActiveIntent(undefined);
    setHoveredCard(undefined);
    setPlayingCard(undefined);
    setPlayedEffect(undefined);
    setScanArrival(undefined);
    setCardOutcome(undefined);
    setSelected(undefined);
    setScanAsset(undefined);
    setScanFeedback('');
    setAwakeningFx(false);
    setError('');
    setBusy(true);
    try {
      setState(await jsonRequest<PublicGameState>('/api/games', { method: 'POST', body: JSON.stringify({ seed: `expedition-${Date.now()}`, persona: state?.agent.persona ?? 'CAUTIOUS', mode }) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法创建新的远征');
    } finally {
      setBusy(false);
      setResetting(false);
    }
  };

  const inspectTile = (position: Position) => {
    setSelected(position);
    const tile = state?.knowledge.find((candidate) => samePosition(candidate.position, position));
    setScanAsset(tile?.revealed ? assetForTile(tile.hazard, tile.resource) : undefined);
  };

  if (!state) return <main className={error ? 'error-screen' : 'loading'}>{error || '正在校准丛林地图…'}</main>;
  const ended = state.phase === 'WON' || state.phase === 'LOST';
  const turnLocked = busy || ended || presentationStage !== 'CHOOSE'
    || state.pendingPlan?.status === 'PENDING' || state.pendingPlan?.status === 'DISPATCHED';
  const resetLocked = resetting;
  const effectCard = playedEffect ? cards.find((card) => card.id === playedEffect.card) : undefined;
  const arrivalCard = scanArrival ? cards.find((card) => card.id === scanArrival.card) : undefined;
  const outcomeCard = cardOutcome ? cards.find((card) => card.id === cardOutcome.card) : undefined;
  const shownIntent = activeIntent ?? hoveredCard;
  const previewPositions = hoveredCard && presentationStage === 'CHOOSE' ? positionsForIntent(state, hoveredCard) : [];
  const candidatePool = positionsForIntent(state, activeIntent ?? 'CAUTIOUS');
  const candidates = presentationStage === 'THINKING'
    ? [presentationPlan?.target, ...candidatePool]
      .filter((position): position is Position => Boolean(position))
      .filter((position, index, positions) => positions.findIndex((candidate) => samePosition(candidate, position)) === index)
      .slice(0, 3)
    : [];
  const visibleRoute = presentationStage === 'MOVING' || presentationStage === 'VERIFYING' || presentationStage === 'REVEAL'
    ? state.fieldFeedback?.actualPath ?? presentationPlan?.path
    : undefined;
  const visibleTarget = presentationStage === 'THINKING' || presentationStage === 'MOVING' || presentationStage === 'VERIFYING' || presentationStage === 'REVEAL'
    ? presentationPlan?.target
    : undefined;
  const stage = stageCopy[presentationStage];
  const cameraActive = presentationStage === 'VERIFYING' || presentationStage === 'REVEAL' || state.fieldFeedback?.status === 'SCANNING';
  const selectedTile = selected ? state.knowledge.find((tile) => samePosition(tile.position, selected)) : undefined;
  const selectedItem = selectedTile?.hazard ?? selectedTile?.resource;
  const selectedMessage = !selected
    ? '点击任意格子查看情报；探索机器人的移动目标由 Agent 自动决定。'
    : !selectedTile?.revealed
      ? `第 ${selected.row + 1} 行第 ${selected.col + 1} 列尚未探索；这里不能直接指定移动。`
      : selectedItem
        ? `第 ${selected.row + 1} 行第 ${selected.col + 1} 列发现${itemNames[selectedItem] ?? '现场目标'}。`
        : `第 ${selected.row + 1} 行第 ${selected.col + 1} 列已探索；周围八格有 ${selectedTile.nearbyHazards ?? 0} 个危险。`;
  return (
    <main className={`expedition-shell merged-player phase-${state.phase.toLowerCase()} presentation-${presentationStage.toLowerCase()}`}>
      <div className="atmosphere" aria-hidden="true" />
      {playedEffect && effectCard && (
        <div
          key={playedEffect.id}
          className="played-card-effect physical-card-effect"
          style={{ '--card-origin-x': `${playedEffect.origin.x}px`, '--card-origin-y': `${playedEffect.origin.y}px` } as CSSProperties}
          onAnimationEnd={() => setPlayedEffect((current) => current?.id === playedEffect.id ? undefined : current)}
          aria-hidden="true"
        ><img src={effectCard.physicalImage} alt="" /></div>
      )}
      {scanArrival && arrivalCard && (
        <div key={scanArrival.id} className="scan-card-arrival physical-card-effect" onAnimationEnd={() => setScanArrival((current) => current?.id === scanArrival.id ? undefined : current)} aria-hidden="true">
          <img src={arrivalCard.physicalImage} alt="" /><span className="physical-card-badge">识别成功</span>
        </div>
      )}
      {cardOutcome && outcomeCard && (
        <div key={cardOutcome.id} className="card-outcome-fx physical-card-effect return" onAnimationEnd={() => setCardOutcome((current) => current?.id === cardOutcome.id ? undefined : current)} aria-hidden="true">
          <img src={outcomeCard.physicalImage} alt="" /><span className="physical-card-badge">{cardOutcome.label}</span>
        </div>
      )}
      {awakeningFx ? (
        <div className="jungle-awakening-fx" role="status" aria-live="assertive">
          <small>OBJECTIVE LOCATED</small><b>WARNING</b><h2>THE JUNGLE AWAKENS</h2><p>携带遗迹返回 BASE</p>
        </div>
      ) : null}

      <header className="expedition-header">
        <div className="brand-lockup">
          <div className="brand-mark"><span>J</span><i /></div>
          <div><p>MOONFALL LAB · EXPEDITION 07</p><h1>JUNGLE <em>EXPLORER</em></h1></div>
        </div>
        <div className="header-metrics">
          <div><span>ROUND</span><strong>{String(state.round + 1).padStart(2, '0')}</strong></div>
          <div className="integrity-stat" aria-label={`探索机器人完整度 ${state.rover.hp}/${state.rover.maxHp}`}><strong>{'♥'.repeat(state.rover.hp)}{'♡'.repeat(Math.max(0, state.rover.maxHp - state.rover.hp))}</strong></div>
          <div><span>RELIC</span><strong>{state.phase === 'AWAKENED' || state.phase === 'WON' ? '1/1' : '0/1'}</strong></div>
          <div className={state.remainingMs < 120000 ? 'urgent' : ''}><strong>{time(state.remainingMs)}</strong></div>
          <details className="restart-control" open={restartOpen} onToggle={(event) => setRestartOpen(event.currentTarget.open)}>
            <summary>重新开始</summary>
            <div>
              <p>选择新的远征模式</p>
              <button disabled={resetLocked} onClick={() => void reset('standard')} type="button">标准局<small>完整远征</small></button>
              <button disabled={resetLocked} onClick={() => void reset('demo')} type="button">短模式<small>快速体验</small></button>
            </div>
          </details>
        </div>
      </header>

      {state.phase === 'AWAKENED' ? <div className="awakening-alert"><b>JUNGLE AWAKENED</b><span>丛林正在重构路径 · 时间流速 ×1.8 · 立即撤离</span></div> : null}
      {error ? <div className="connection-alert">连接中断 · {error}</div> : null}

      <section className="stage-banner panel" aria-label="本回合状态" aria-live="polite">
        <div><p className="eyebrow">{stage.kicker}</p><h2>{stage.title}</h2></div>
        <p>{stage.copy}</p>
      </section>

      <section className="mission-grid">
        <div className="map-column">
          <JungleMap
            itemArtwork={mapArtwork}
            onSelect={inspectTile}
            state={state}
            candidates={candidates}
            {...(selected ? { selected } : {})}
            {...(hoveredCard && previewPositions.length > 0 ? { preview: { intent: hoveredCard, positions: previewPositions } } : {})}
            {...(visibleRoute ? { route: visibleRoute } : {})}
            {...(visibleTarget ? { target: visibleTarget } : {})}
            {...(revealedPosition ? { revealedPosition } : {})}
          />
          <div className="map-helpbar" role="status"><span>查看模式</span><p>{selectedMessage}</p><small>地图数字表示周围八格的危险数量</small></div>
          {visibleRoute ? <div className={`movement-ribbon field-${state.fieldFeedback?.status.toLowerCase() ?? 'planned'}`}><i /><div><b>{state.fieldFeedback?.status === 'SCANNING' ? 'CAMERA LOCKING' : 'EXPLORER IN MOTION'}</b><span>{state.fieldFeedback?.message ?? '路线已锁定，正在等待最终定位'}</span></div><strong>{state.fieldFeedback ? `${Math.round(state.fieldFeedback.progress * 100)}%` : presentationPlan?.commands.map((command) => command.action === 'FORWARD' ? `F${command.cells}` : command.action === 'TURN_LEFT' ? 'L' : 'R').join('  ')}</strong></div> : null}
        </div>

        <aside className="intel-column merged-intel-column">
          <AgentPersonaPanel
            state={state}
            stage={presentationStage}
            candidates={candidates}
            {...(shownIntent ? { intent: shownIntent } : {})}
            {...(visibleTarget ? { target: visibleTarget } : {})}
          />
          <section className={`scan-panel camera-window panel ${cameraActive ? 'presentation-expanded' : ''}`}>
            <div className="camera-window-heading"><span className="live-dot">{cameraActive ? 'LIVE' : 'VIEW'}</span><b>CAMERA</b><small>{state.fieldFeedback?.status === 'SCANNING' ? 'SCANNING' : scanAsset ? 'INSPECTING' : 'STANDBY'}</small></div>
            {state.fieldFeedback?.status === 'SCANNING' ? <div className="camera-lock-overlay"><i /><b>CAMERA LOCK</b><span>正在确认最终落点</span></div> : null}
            {scanAsset ? <ModelViewer asset={scanAsset} /> : cameraActive ? <div className="camera-standby active" role="status"><i aria-hidden="true" /><span>POSITIONING</span></div> : <div className="camera-standby" role="status"><i aria-hidden="true" /><span>点击已探索格查看现场模型</span></div>}
          </section>
        </aside>
      </section>

      <section className="command-deck panel merged-command-deck" aria-label="探索策略卡牌">
        <div className="cards physical-cards">{cards.map((card, index) => (
          <button
            className={`intent-card physical-card strategy-${card.id.toLowerCase().replace('_', '-')} ${playingCard === card.id ? 'selected' : ''}`}
            disabled={turnLocked}
            key={card.id}
            onMouseEnter={() => !turnLocked && setHoveredCard(card.id)}
            onMouseLeave={() => setHoveredCard((current) => current === card.id ? undefined : current)}
            onFocus={() => !turnLocked && setHoveredCard(card.id)}
            onBlur={() => setHoveredCard((current) => current === card.id ? undefined : current)}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              void play(card.id, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
            }}
            aria-label={`打出${card.title}卡牌`}
            title={`${card.title} · ${cardGuidance[card.id].range}`}
          >
            <span className="strategy-art"><img src={card.image} alt="" draggable={false} /></span>
            <span className="strategy-copy">
              <b>{card.title}</b>
              <small>{card.english}</small>
              <span>{card.description}</span>
            </span>
            <i className="strategy-index" aria-hidden="true">0{index + 1}</i>
          </button>
        ))}</div>
      </section>

      <details className="system-details" open={systemOpen} onToggle={(event) => setSystemOpen(event.currentTarget.open)}>
        <summary><span>SYSTEM <i className="system-dot" /></span><small>设置与诊断</small></summary>
        <section className="lower-deck merged-lower-deck">
          <section className="panel operator-controls-panel">
            <p className="eyebrow">GAME SETTINGS</p><h3>游戏与输入设置</h3>
            {state.fieldFeedback ? <div className={`field-links field-${state.fieldFeedback.status.toLowerCase()}`}><span><i className={state.fieldFeedback.robotOnline ? 'online' : ''} />ROBOT</span><span><i className={state.fieldFeedback.localizationOnline ? 'online' : ''} />LOCALIZATION</span><span><i className={state.fieldFeedback.cameraOnline ? 'online' : ''} />CAMERA</span><b>{Math.round(state.fieldFeedback.progress * 100)}%</b></div> : null}
            <label><span>Agent 人格</span><select aria-label="驾驶人格" value={state.agent.persona} disabled={turnLocked} onChange={(event) => void changePersona(event.target.value as AgentPersona)}>{Object.entries(AGENT_PERSONA_PROFILES).map(([id, option]) => <option key={id} value={id}>{option.name} · {option.title}</option>)}</select></label>
            <div className="operator-button-row"><button className={controlTab === 'cards' ? 'active' : ''} onClick={() => setControlTab('cards')}>屏幕卡牌</button><button className={controlTab === 'scanner' ? 'active' : ''} onClick={() => setControlTab('scanner')}>摄像头识卡</button><button disabled={resetLocked} onClick={() => void reset('standard')}>新建标准局</button><button disabled={resetLocked} onClick={() => void reset('demo')}>新建短模式</button></div>
            {controlTab === 'scanner' ? <CardScanner onScan={handleScan} disabled={turnLocked} feedback={scanFeedback} /> : null}
            <details className="asset-archive"><summary>现场 3D 样本</summary><div className="asset-switcher" aria-label="3D 样本选择">{scanAssets.map((asset) => <button className={scanAsset?.id === asset.id ? 'active' : ''} key={asset.id} onClick={() => { setScanAsset(asset); setSystemOpen(false); }} title={asset.title} type="button"><span>{asset.title.slice(0, 1)}</span><small>{asset.title}</small></button>)}</div></details>
          </section>
          <div className="telemetry-stack"><RoverHud state={state} /><BioHud state={state} /></div>
          <EventFeed state={state} />
          <RoverConnectionPanel />
        </section>
      </details>

      {ended ? <div className={`mission-result result-${state.phase.toLowerCase()}`}><div className="result-card"><p>EXPEDITION STATUS</p><h2>{state.phase === 'WON' ? '遗迹成功回收' : '远征行动终止'}</h2><span>{state.events.at(-1)?.message}</span><div><b>{state.round}</b><small>完成回合</small><b>{state.rover.hp}/{state.rover.maxHp}</b><small>剩余完整度</small></div><div className="result-restart-actions"><button disabled={resetLocked} onClick={() => void reset('standard')} type="button">开始标准局</button><button disabled={resetLocked} onClick={() => void reset('demo')} type="button">开始短模式</button></div></div></div> : null}
    </main>
  );
}
