import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { AgentPersona, IntentCard, PublicGameState } from '@jungle/shared-types';
import { BioHud, EventFeed, JungleMap, MissionHeader, RoverHud } from '@jungle/ui-components';
import { CardScanner, type CardScanResult } from './CardScanner';

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
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setState(await jsonRequest<PublicGameState>('/api/games/current')); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法连接 Game Server'); }
  }, []);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 1000); return () => window.clearInterval(timer); }, [refresh]);

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

  if (!state) return <main className={error ? 'error-screen' : 'loading'}>{error || '正在校准丛林地图…'}</main>;
  const ended = state.phase === 'WON' || state.phase === 'LOST';
  const turnLocked = busy || ended || state.pendingPlan?.status === 'PENDING' || state.pendingPlan?.status === 'DISPATCHED';
  const effectCard = playedEffect ? cards.find((card) => card.id === playedEffect.card) : undefined;
  const arrivalCard = scanArrival ? cards.find((card) => card.id === scanArrival.card) : undefined;
  const outcomeCard = cardOutcome ? cards.find((card) => card.id === cardOutcome.card) : undefined;
  return (
    <main className="app-shell player-console">
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
      <MissionHeader state={state} label="PLAYER CONSOLE" />
      {error ? <p className="error-screen">{error}</p> : null}
      <div className="player-battle-layout">
        <aside className="player-side-rail player-rover-rail">
          <RoverHud state={state} />
          <RoverConnectionPanel />
        </aside>
        <JungleMap state={state} />
        <aside className="player-side-rail player-intel-rail">
          <AgentPersonaPanel state={state} disabled={turnLocked} onChange={(persona) => void changePersona(persona)} />
          <BioHud state={state} />
        </aside>
      </div>
      <section className="player-control-deck">
        <section className="panel command-bay">
          <div className="panel-title-row command-title-row">
            <div><p className="eyebrow">CARD PLAY</p><h3>{controlTab === 'cards' ? '请打出卡牌' : '摄像头识别'}</h3></div>
            <div className="command-head-actions">
              <div className="control-mode-switch">
                <button className={controlTab === 'cards' ? 'active' : ''} onClick={() => setControlTab('cards')}>行动控制</button>
                <button className={controlTab === 'scanner' ? 'active' : ''} onClick={() => setControlTab('scanner')}>摄像头识别</button>
              </div>
              <div className="toolbar">
                <button className="secondary-button" disabled={turnLocked} onClick={() => void reset('standard')}>新建标准局</button>
                <button className="secondary-button" disabled={turnLocked} onClick={() => void reset('demo')}>新建短模式</button>
              </div>
              <span className="stance">ROUND {state.round + 1}</span>
            </div>
          </div>
          {controlTab === 'cards' ? <div className="cards">{cards.map((card) => (
            <button
              className={`intent-card ${playingCard === card.id ? 'selected' : ''}`}
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
            </button>
          ))}</div> : <CardScanner onScan={handleScan} disabled={turnLocked} feedback={scanFeedback} />}
        </section>
        <EventFeed state={state} />
      </section>
      <footer className="player-footer"><span>MOONFALL LAB</span><b>JUNGLE EXPLORER</b><span>REAL ROVER · DIGITAL TWIN</span></footer>
    </main>
  );
}
