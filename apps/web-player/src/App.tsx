import { useCallback, useEffect, useState } from 'react';
import type { IntentCard, PublicGameState } from '@jungle/shared-types';
import { AgentMind, BioHud, EventFeed, JungleMap, MissionHeader, RoverHud } from '@jungle/ui-components';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const cards: Array<{ id: IntentCard; title: string; copy: string }> = [
  { id: 'CAUTIOUS', title: '谨慎推进', copy: '在周围八格中偏向已知、低风险路径。' },
  { id: 'EXPLORE', title: '深入探索', copy: '允许扩展至外侧一层，以中高风险换取信息。' },
  { id: 'VERIFY', title: '验证路径', copy: '仅在前后左右中进行一次保守试探。' },
  { id: 'FIND_CLUE', title: '寻找线索', copy: '系统提供一条绝对正确的安全路径提示。' },
];

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error((await response.json()).error ?? `Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export function App() {
  const [state, setState] = useState<PublicGameState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setState(await jsonRequest<PublicGameState>('/api/games/current')); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法连接 Game Server'); }
  }, []);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 1000); return () => window.clearInterval(timer); }, [refresh]);

  const play = async (card: IntentCard) => {
    if (!state) return;
    setBusy(true);
    try {
      const result = await jsonRequest<{ state: PublicGameState }>(`/api/games/${state.id}/intents`, { method: 'POST', body: JSON.stringify({ card }) });
      setState(result.state); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '行动失败'); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true);
    try {
      setState(await jsonRequest<PublicGameState>('/api/games', { method: 'POST', body: JSON.stringify({ seed: `expedition-${Date.now()}`, persona: 'CAUTIOUS' }) }));
    } finally { setBusy(false); }
  };

  if (!state) return <main className={error ? 'error-screen' : 'loading'}>{error || '正在校准丛林地图…'}</main>;
  const ended = state.phase === 'WON' || state.phase === 'LOST';
  return (
    <main className="app-shell">
      <MissionHeader state={state} label="PLAYER CONSOLE" />
      {error ? <p className="error-screen">{error}</p> : null}
      <div className="dashboard">
        <JungleMap state={state} />
        <aside className="sidebar"><RoverHud state={state} /><AgentMind state={state} /><BioHud state={state} /></aside>
        <section className="panel command-bay">
          <div className="panel-title-row"><div><p className="eyebrow">COMMAND BAY</p><h3>选择团队意图，而不是下达方向</h3></div><span className="stance">ROUND {state.round + 1}</span></div>
          <div className="cards">{cards.map((card) => <button className="intent-card" disabled={busy || ended} key={card.id} onClick={() => void play(card.id)}><strong>{card.id} · {card.title}</strong><small>{card.copy}</small></button>)}</div>
          <div className="toolbar"><button className="secondary-button" disabled={busy} onClick={() => void reset()}>开始新远征</button></div>
        </section>
        <EventFeed state={state} />
      </div>
    </main>
  );
}
