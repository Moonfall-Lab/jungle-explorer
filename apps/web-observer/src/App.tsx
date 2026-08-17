import { useEffect, useState } from 'react';
import type { ObserverGameState } from '@jungle/shared-types';
import { AgentMind, BioHud, EventFeed, JungleMap, MissionHeader, RoverHud } from '@jungle/ui-components';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function App() {
  const [state, setState] = useState<ObserverGameState>();
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch(`${API}/api/games/current/observer`);
        if (!response.ok) throw new Error(`Observer API ${response.status}`);
        setState(await response.json() as ObserverGameState); setError('');
      } catch (reason) { setError(reason instanceof Error ? reason.message : '连接失败'); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 750); return () => window.clearInterval(timer);
  }, []);
  if (!state) return <main className={error ? 'error-screen' : 'loading'}>{error || '正在打开观察者频道…'}</main>;
  return (
    <main className="app-shell">
      <MissionHeader state={state} label="OBSERVER MODE · FULL TRUTH" />
      <div className="dashboard">
        <JungleMap state={state} observer />
        <aside className="sidebar"><RoverHud state={state} /><AgentMind state={state} /><BioHud state={state} /></aside>
        <EventFeed state={state} />
      </div>
    </main>
  );
}
