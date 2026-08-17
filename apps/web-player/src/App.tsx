import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AgentPersona, HazardType, IntentCard, Position, PublicGameState, ResourceType } from '@jungle/shared-types';
import { samePosition } from '@jungle/shared-types';
import { BioHud, EventFeed, JungleMap, RoverHud, time } from '@jungle/ui-components';
import { CardScanner, type CardScanResult } from './CardScanner';
import { ModelViewer, type ScanAsset } from './ModelViewer.js';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const cards: Array<{ id: IntentCard; title: string; image: string }> = [
  { id: 'CAUTIOUS', title: '谨慎推进', image: '/cards/cautious.webp' },
  { id: 'EXPLORE', title: '深入探索', image: '/cards/explore.webp' },
  { id: 'VERIFY', title: '验证路径', image: '/cards/verify.webp' },
  { id: 'FIND_CLUE', title: '寻找线索', image: '/cards/clue.webp' },
];

const personas: Record<AgentPersona, { name: string; title: string; description: string; credo: string }> = {
  CAUTIOUS: { name: '守望者', title: '谨慎型探索者', description: '尽量避开未知区域，优先选择已知、低风险且便于撤退的路线。', credo: '看清前路，再稳步前进。' },
  DAREDEVIL: { name: '开路者', title: '丛林冒险家', description: '偏好高风险路径，愿意用更大胆的探索换取速度与新发现。', credo: '越过危险，才能发现新的道路。' },
  FORAGER: { name: '寻迹者', title: '资源采集者', description: '优先寻找水源与花朵，并在规划路线时更重视沿途资源。', credo: '每一份资源，都可能改变远征。' },
  INSTINCT: { name: '逐风者', title: '直觉型智能体', description: '基于附近的局部信息快速决策，及时选择当前最有利的方向。', credo: '信息有限，也要果断前行。' },
};

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
  disabled,
  onChange,
}: {
  state: PublicGameState;
  disabled: boolean;
  onChange: (persona: AgentPersona) => void;
}) {
  const persona = personas[state.agent.persona];
  return (
    <section className="panel compact-panel agent-mind persona-panel">
      <div className="panel-title-row">
        <div><p className="eyebrow">AGENT MIND</p><h3>{persona.name}</h3></div>
        <span className={`stance ${state.agent.stance.toLowerCase()}`}>{state.agent.stance}</span>
      </div>
      <select
        className="persona-select"
        aria-label="驾驶人格"
        value={state.agent.persona}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as AgentPersona)}
      >
        {Object.entries(personas).map(([id, option]) => (
          <option key={id} value={id}>{option.name} · {option.title}</option>
        ))}
      </select>
      <div className="persona-card">
        <b>{persona.title}</b>
        <span>{persona.description}</span>
        <q>{persona.credo}</q>
      </div>
      <p className="agent-copy">“{state.agent.explanation}”</p>
      <div className="risk-meter"><span style={{ width: `${state.agent.riskAtRover * 100}%` }} /></div>
      <small>Selected route risk · {Math.round(state.agent.riskAtRover * 100)}%</small>
    </section>
  );
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error((await response.json()).error ?? `Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

interface RoverConnection {
  roverMode: 'virtual' | 'hardware';
  configured: boolean;
  ip: string | null;
  localizationMode: 'required' | 'disabled';
  online?: boolean;
  motors?: { left: number; right: number; speed: number };
  error?: string;
}

function RoverConnectionPanel() {
  const [connection, setConnection] = useState<RoverConnection>();
  const [ip, setIp] = useState('192.168.20.155');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'check' | 'connect' | 'virtual'>();

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

  const run = async (action: 'check' | 'connect' | 'virtual') => {
    setBusy(action);
    setMessage('');
    try {
      const result = await jsonRequest<RoverConnection>(`/api/operator/rover/${action}`, {
        method: 'POST',
        body: action === 'virtual' ? '{}' : JSON.stringify({ ip }),
      });
      if (action === 'check') {
        setConnection((current) => current ? { ...current, ...result } : result);
        setMessage(result.online ? '探索机器人在线，状态接口响应正常' : result.error || '探索机器人离线');
      } else {
        setConnection(result);
        setMessage(action === 'connect' ? '实体探索机器人已连接，后续任务将发送到该 IP' : '已切回虚拟探索机器人');
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setBusy(undefined);
    }
  };

  const hardwareConnected = connection?.roverMode === 'hardware' && connection.configured;
  return (
    <section className="panel rover-connect-panel">
      <div className="rover-connect-heading">
        <div><p className="eyebrow">EXPLORER LINK</p><h2>探索机器人连接</h2></div>
        <span className={`connection-state ${hardwareConnected ? 'connected' : 'virtual'}`}>
          {hardwareConnected ? '实体机器人' : '虚拟机器人'}
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
        <button className="secondary-button" disabled={Boolean(busy) || !hardwareConnected} onClick={() => void run('virtual')}>
          切回虚拟机器人
        </button>
      </div>
      <div className="rover-connect-status" aria-live="polite">
        <span>{hardwareConnected ? `${connection.ip} · 仅运动模式` : '尚未连接实体探索机器人'}</span>
        {connection?.motors && <span>电机 L {connection.motors.left} · R {connection.motors.right} · SPD {connection.motors.speed}</span>}
        {message && <strong>{message}</strong>}
      </div>
    </section>
  );
}

export function App() {
  const [state, setState] = useState<PublicGameState>();
  const [busy, setBusy] = useState(false);
  const [playingCard, setPlayingCard] = useState<IntentCard>();
  const [controlTab, setControlTab] = useState<'cards' | 'scanner'>(() => (
    new URLSearchParams(window.location.search).get('control') === 'scanner' ? 'scanner' : 'cards'
  ));
  const [scanFeedback, setScanFeedback] = useState('');
  const [playedEffect, setPlayedEffect] = useState<{ id: number; card: IntentCard; origin: { x: number; y: number } }>();
  const [scanArrival, setScanArrival] = useState<{ id: number; card: IntentCard }>();
  const [cardOutcome, setCardOutcome] = useState<{ id: number; card: IntentCard; status: 'execute' | 'return'; label: string }>();
  const [selected, setSelected] = useState<Position>();
  const [scanAsset, setScanAsset] = useState<ScanAsset>();
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
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

  const play = async (card: IntentCard, origin?: { x: number; y: number }) => {
    if (!state || busy || state.phase === 'WON' || state.phase === 'LOST'
      || state.pendingPlan?.status === 'PENDING' || state.pendingPlan?.status === 'DISPATCHED') return;
    setBusy(true);
    setPlayingCard(card);
    setPlayedEffect({
      id: Date.now(),
      card,
      origin: origin ?? { x: window.innerWidth / 2, y: window.innerHeight - 40 },
    });
    try {
      const result = await jsonRequest<{ state: PublicGameState; plan: { status: string } }>(`/api/games/${state.id}/intents`, { method: 'POST', body: JSON.stringify({ card }) });
      setState(result.state); setError('');
      setCardOutcome({ id: Date.now(), card, status: 'execute', label: result.plan.status === 'CONFIRMED' ? '卡牌结算完成' : '任务已发送到小车' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '行动失败');
      setCardOutcome({ id: Date.now(), card, status: 'return', label: '指令未执行 · 卡牌退回' });
    }
    finally { setBusy(false); setPlayingCard(undefined); }
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
    setBusy(true);
    try {
      setState(await jsonRequest<PublicGameState>('/api/games', { method: 'POST', body: JSON.stringify({ seed: `expedition-${Date.now()}`, persona: state?.agent.persona ?? 'CAUTIOUS', mode }) }));
    } finally { setBusy(false); }
  };

  const inspectTile = (position: Position) => {
    setSelected(position);
    const tile = state?.knowledge.find((candidate) => samePosition(candidate.position, position));
    setScanAsset(tile?.revealed ? assetForTile(tile.hazard, tile.resource) : undefined);
  };

  const mission = useMemo(() => {
    if (!state) return '';
    if (state.phase === 'WON') return '远征完成';
    if (state.phase === 'LOST') return '远征终止';
    if (state.phase === 'AWAKENED') return '携带遗迹返回 BASE';
    return '定位遗迹并保持探索机器人完整';
  }, [state]);

  if (!state) return <main className={error ? 'error-screen' : 'loading'}>{error || '正在校准丛林地图…'}</main>;
  const ended = state.phase === 'WON' || state.phase === 'LOST';
  const turnLocked = busy || ended || state.pendingPlan?.status === 'PENDING' || state.pendingPlan?.status === 'DISPATCHED';
  const effectCard = playedEffect ? cards.find((card) => card.id === playedEffect.card) : undefined;
  const arrivalCard = scanArrival ? cards.find((card) => card.id === scanArrival.card) : undefined;
  const outcomeCard = cardOutcome ? cards.find((card) => card.id === cardOutcome.card) : undefined;
  const awaiting = state.pendingPlan?.status === 'PENDING' || state.pendingPlan?.status === 'DISPATCHED';
  const observing = state.pendingPlan?.status === 'CONFIRMED' && Boolean(cardOutcome);
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
    <main className={`expedition-shell merged-player phase-${state.phase.toLowerCase()}`}>
      <div className="atmosphere" aria-hidden="true" />
      {playedEffect && effectCard && (
        <div
          key={playedEffect.id}
          className="played-card-effect"
          style={{ '--card-origin-x': `${playedEffect.origin.x}px`, '--card-origin-y': `${playedEffect.origin.y}px` } as CSSProperties}
          onAnimationEnd={() => setPlayedEffect((current) => current?.id === playedEffect.id ? undefined : current)}
          aria-hidden="true"
        ><img src={effectCard.image} alt="" /><span>{effectCard.title}</span></div>
      )}
      {scanArrival && arrivalCard && (
        <div key={scanArrival.id} className="scan-card-arrival" onAnimationEnd={() => setScanArrival((current) => current?.id === scanArrival.id ? undefined : current)} aria-hidden="true">
          <img src={arrivalCard.image} alt="" /><span>识别成功 · {arrivalCard.title}</span>
        </div>
      )}
      {cardOutcome && outcomeCard && (
        <div key={cardOutcome.id} className={`card-outcome-fx ${cardOutcome.status}`} onAnimationEnd={() => setCardOutcome((current) => current?.id === cardOutcome.id ? undefined : current)} aria-hidden="true">
          <img src={outcomeCard.image} alt="" /><b>{cardOutcome.label}</b>
        </div>
      )}

      <header className="expedition-header">
        <div className="brand-lockup">
          <div className="brand-mark"><span>J</span><i /></div>
          <div><p>MOONFALL LAB · EXPEDITION 07</p><h1>JUNGLE <em>EXPLORER</em></h1></div>
        </div>
        <div className="mission-objective"><span>当前任务</span><strong>{mission}</strong></div>
        <div className="header-metrics">
          <div><span>PHASE</span><strong>{state.phase}</strong></div>
          <div><span>ROUND</span><strong>{String(state.round + 1).padStart(2, '0')}</strong></div>
          <div className={state.remainingMs < 120000 ? 'urgent' : ''}><span>TIME</span><strong>{time(state.remainingMs)}</strong></div>
        </div>
      </header>

      {state.phase === 'AWAKENED' ? <div className="awakening-alert"><b>JUNGLE AWAKENED</b><span>丛林正在重构路径 · 时间流速 ×1.8 · 立即撤离</span></div> : null}
      {error ? <div className="connection-alert">连接中断 · {error}</div> : null}

      <section className="round-guide panel" aria-label="本回合操作引导">
        <div className="round-guide-copy">
          <p className="eyebrow">ROUND {String(state.round + 1).padStart(2, '0')} · {awaiting ? 'IN MOTION' : observing ? 'RESULT' : 'YOUR DECISION'}</p>
          <h2>{awaiting ? 'Agent 正在移动探索机器人' : observing ? '行动完成，请观察地图变化' : '请打出一张探索卡牌'}</h2>
          <p>{awaiting ? '正在规划并执行路线。' : observing ? '新位置与现场情报已经更新。' : '你决定行动意图，具体路线和移动由 Agent 完成。'}</p>
        </div>
        <ol className="turn-steps">
          <li className={!awaiting && !observing ? 'active' : 'done'}><span>1</span><b>打出卡牌</b></li>
          <li className={awaiting ? 'active' : observing ? 'done' : ''}><span>2</span><b>机器人移动</b></li>
          <li className={observing ? 'active' : ''}><span>3</span><b>观察结果</b></li>
        </ol>
      </section>

      <section className="command-deck panel merged-command-deck">
        <div className="command-heading">
          <div><p className="eyebrow">CARD PLAY · 选择后立即执行</p><h2>{controlTab === 'cards' ? '请打出卡牌' : '使用摄像头识别卡牌'}</h2></div>
          <div className="command-head-actions">
            <div className="control-mode-switch">
              <button className={controlTab === 'cards' ? 'active' : ''} onClick={() => setControlTab('cards')}>实体卡牌</button>
              <button className={controlTab === 'scanner' ? 'active' : ''} onClick={() => setControlTab('scanner')}>摄像头识别</button>
            </div>
            <div className="toolbar compact-toolbar">
              <button disabled={turnLocked} onClick={() => void reset('standard')}>新建标准局</button>
              <button disabled={turnLocked} onClick={() => void reset('demo')}>新建短模式</button>
            </div>
          </div>
        </div>
        {controlTab === 'cards' ? <div className="cards physical-cards">{cards.map((card) => (
            <button
              className={`intent-card physical-card ${playingCard === card.id ? 'selected' : ''}`}
              disabled={turnLocked}
              key={card.id}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                void play(card.id, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
              }}
              aria-label={`打出${card.title}卡牌`}
              title={card.title}
            >
              <img src={card.image} alt={`${card.title}卡面`} draggable={false} />
              <span>{card.title}</span>
            </button>
        ))}</div> : <CardScanner onScan={handleScan} disabled={turnLocked} feedback={scanFeedback} />}
      </section>

      <section className="mission-grid">
        <div className="map-column">
          <JungleMap itemArtwork={mapArtwork} onSelect={inspectTile} state={state} {...(selected ? { selected } : {})} />
          <div className="map-helpbar" role="status"><span>查看模式</span><p>{selectedMessage}</p><small>地图数字表示周围八格的危险数量</small></div>
          {awaiting ? <div className="movement-ribbon"><i /><div><b>EXPLORER IN MOTION</b><span>等待最终定位裁决</span></div><strong>{busy ? 'PLANNING' : state.pendingPlan?.commands.map((command) => command.action === 'FORWARD' ? `F${command.cells}` : command.action === 'TURN_LEFT' ? 'L' : 'R').join('  ')}</strong></div> : null}
        </div>

        <aside className="intel-column merged-intel-column">
          <AgentPersonaPanel state={state} disabled={turnLocked} onChange={(persona) => void changePersona(persona)} />
          <section className="scan-panel panel">
            <div className="section-heading"><div><p className="eyebrow">SELECTED CELL · 现场情报</p><h2>当前目标扫描</h2></div><span className="live-dot">LIVE</span></div>
            {scanAsset ? <ModelViewer asset={scanAsset} /> : <div className="scan-empty" role="status"><i aria-hidden="true" /><strong>暂无可扫描对象</strong><span>该格尚未探索，或没有发现危险与资源。</span></div>}
            <details className="asset-archive">
              <summary>查看全部现场样本</summary>
              <div className="asset-switcher" aria-label="3D 样本选择">
                {scanAssets.map((asset) => <button className={scanAsset?.id === asset.id ? 'active' : ''} key={asset.id} onClick={() => setScanAsset(asset)} title={asset.title} type="button"><span>{asset.title.slice(0, 1)}</span><small>{asset.title}</small></button>)}
              </div>
            </details>
          </section>
        </aside>
      </section>

      <details className="system-details">
        <summary><span>探索机器人与详细信息</span><small>连接设置 · 机器人状态 · 生理数据 · 行动日志</small></summary>
        <section className="lower-deck merged-lower-deck">
          <div className="telemetry-stack"><RoverHud state={state} /><BioHud state={state} /></div>
          <EventFeed state={state} />
          <RoverConnectionPanel />
        </section>
      </details>

      {ended ? <div className={`mission-result result-${state.phase.toLowerCase()}`}><div className="result-card"><p>EXPEDITION STATUS</p><h2>{state.phase === 'WON' ? '遗迹成功回收' : '远征行动终止'}</h2><span>{state.events.at(-1)?.message}</span><div><b>{state.round}</b><small>完成回合</small><b>{state.rover.hp}/{state.rover.maxHp}</b><small>剩余完整度</small></div><button onClick={() => void reset('standard')} type="button">开始新的标准远征</button></div></div> : null}
    </main>
  );
}
