import type { PublicGameState } from '@jungle/shared-types';

const time = (milliseconds: number): string => {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
};

export function RoverHud({ state }: { state: PublicGameState }) {
  return (
    <section className="panel compact-panel rover-hud">
      <p className="eyebrow">ROVER HUD</p>
      <div className="stat-line"><span>Integrity</span><strong>{'♥'.repeat(state.rover.hp)}{'♡'.repeat(state.rover.maxHp - state.rover.hp)}</strong></div>
      <div className="stat-line"><span>Battery</span><strong>{state.rover.batteryPercent}%</strong></div>
      <div className="stat-line"><span>Position</span><strong>R{state.rover.position.row + 1} · C{state.rover.position.col + 1}</strong></div>
      <div className="stat-line"><span>Heading</span><strong>{state.rover.heading}</strong></div>
      <div className="stat-line"><span>Relic</span><strong>{state.rover.carryingRelic ? 'SECURED' : 'NOT FOUND'}</strong></div>
    </section>
  );
}

export function AgentMind({ state }: { state: PublicGameState }) {
  const recommendation = state.phase === 'AWAKENED' || state.agent.riskAtRover >= .35
    ? state.phase === 'AWAKENED' ? '安全撤离' : '安全前进'
    : { CAUTIOUS: '安全前进', DAREDEVIL: '扩大探索', FORAGER: '获取提示', INSTINCT: '检查周围' }[state.agent.persona];
  const riskPercent = Math.round(state.agent.riskAtRover * 100);
  const riskLevel = riskPercent < 25 ? 'low' : riskPercent < 55 ? 'medium' : 'high';
  const plainReason = state.phase === 'AWAKENED'
    ? '你已经取得遗迹，现在最重要的是安全返回 BASE。'
    : riskPercent >= 35
      ? '当前位置风险偏高，建议先避开危险，不要继续冒进。'
      : `当前路线危险度约为 ${riskPercent}%，可以按推荐策略继续探索。`;
  return (
    <section className="panel compact-panel agent-mind">
      <div className="panel-title-row">
        <div><p className="eyebrow">AGENT 建议</p><h3>推荐：{recommendation}</h3></div>
        <span className={`risk-badge risk-${riskLevel}`}>{riskPercent}% 风险</span>
      </div>
      <p className="agent-copy">{plainReason}</p>
      <div className="risk-meter"><span style={{ width: `${state.agent.riskAtRover * 100}%` }} /></div>
      <small>绿色更安全，红色风险更高</small>
      <details className="agent-reasoning"><summary>查看 Agent 的详细判断</summary><p>“{state.agent.explanation}”</p></details>
    </section>
  );
}

export function BioHud({ state }: { state: PublicGameState }) {
  return (
    <section className="panel compact-panel bio-hud">
      <p className="eyebrow">BIO HUD · CONTEXT ONLY</p>
      <div className="bio-value">{state.latestBio?.heartRate ? Math.round(state.latestBio.heartRate) : '--'} <small>BPM</small></div>
      <div className="stat-line"><span>Team tension</span><strong>{Math.round(state.agent.teamTension * 100)}%</strong></div>
      <div className="stat-line"><span>Confidence</span><strong>{state.latestBio ? `${Math.round(state.latestBio.confidence * 100)}%` : 'NO SIGNAL'}</strong></div>
    </section>
  );
}

export function EventFeed({ state }: { state: PublicGameState }) {
  return (
    <section className="panel event-feed">
      <p className="eyebrow">EXPEDITION LOG</p>
      <div className="event-scroll">
        {[...state.events].reverse().slice(0, 8).map((event) => (
          <article key={event.id}>
            <time>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
            <div><strong>{event.kind.replaceAll('_', ' ')}</strong><p>{event.message}</p></div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MissionHeader({ state, label }: { state: PublicGameState; label: string }) {
  return (
    <header className="mission-header">
      <div><p className="eyebrow">MOONFALL LAB · {label}</p><h1>JUNGLE <span>EXPLORER</span></h1></div>
      <div className="mission-stats">
        <div><small>MODE · PHASE</small><strong>{state.config.victoryMode === 'RELIC_ONLY' ? 'SHORT' : state.phase}</strong></div>
        <div><small>MARKERS</small><strong>{state.relicMarkersFound} / {state.config.relicMarkers}</strong></div>
        <div className={state.remainingMs < 120000 ? 'urgent' : ''}><small>TIME</small><strong>{time(state.remainingMs)}</strong></div>
      </div>
    </header>
  );
}

export { time };
