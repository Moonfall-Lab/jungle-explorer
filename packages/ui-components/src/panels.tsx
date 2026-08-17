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
  return (
    <section className="panel compact-panel agent-mind">
      <div className="panel-title-row">
        <div><p className="eyebrow">AGENT MIND</p><h3>{state.agent.persona}</h3></div>
        <span className={`stance ${state.agent.stance.toLowerCase()}`}>{state.agent.stance}</span>
      </div>
      <p className="agent-copy">“{state.agent.explanation}”</p>
      <div className="risk-meter"><span style={{ width: `${state.agent.riskAtRover * 100}%` }} /></div>
      <small>Selected route risk · {Math.round(state.agent.riskAtRover * 100)}%</small>
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
        <div><small>PHASE</small><strong>{state.phase}</strong></div>
        <div><small>CLUES</small><strong>{state.cluesFound} / {state.config.requiredClues}</strong></div>
        <div className={state.remainingMs < 120000 ? 'urgent' : ''}><small>TIME</small><strong>{time(state.remainingMs)}</strong></div>
      </div>
    </header>
  );
}

export { time };
