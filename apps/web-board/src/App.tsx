import { useEffect, useMemo, useState } from 'react';
import type { PublicGameState, ResourceType } from '@jungle/shared-types';
import { positionKey, samePosition } from '@jungle/shared-types';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const calibrationMode = new URLSearchParams(window.location.search).get('calibrate') === '1';
const resourceGlyph: Record<ResourceType, string> = {
  WATER: '💧',
  RARE_FLOWER: '✦',
  RELIC_MARKER: '◇',
  RELIC: '◆',
};

const time = (milliseconds: number): string => {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
};

export function App() {
  const [state, setState] = useState<PublicGameState>();
  const [error, setError] = useState('');
  const expectedCells = useMemo(
    () => Array.from({ length: 40 }, (_, index) => ({ row: Math.floor(index / 8), col: index % 8 })),
    [],
  );

  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch(`${API}/api/games/current`);
        if (!response.ok) throw new Error(`Game Server ${response.status}`);
        setState(await response.json() as PublicGameState);
        setError('');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '无法连接 Game Server');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 500);
    return () => window.clearInterval(timer);
  }, []);

  const enterFullscreen = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  };

  const knowledge = new Map(state?.knowledge.map((tile) => [positionKey(tile.position), tile]));
  return (
    <main className={`physical-screen ${calibrationMode ? 'calibration-mode' : ''}`}>
      <div className="screen-margin left-margin">
        <button onClick={() => void enterFullscreen()}>FULL</button>
        <span>{calibrationMode ? 'CAL' : state?.phase ?? 'OFFLINE'}</span>
      </div>
      <section className="physical-board" aria-label="5 by 8 physical jungle board">
        {expectedCells.map((position) => {
          const tile = knowledge.get(positionKey(position));
          const current = state ? samePosition(position, state.rover.position) : false;
          const base = state ? samePosition(position, state.start) : position.row === 2 && position.col === 0;
          const classes = [
            'physical-cell',
            tile?.revealed ? 'revealed' : 'unknown',
            tile?.forgotten ? 'forgotten' : '',
            tile?.hazard ? 'hazard' : '',
            current ? 'current' : '',
          ].filter(Boolean).join(' ');
          return (
            <div className={classes} key={positionKey(position)}>
              <span className="coordinate">{String.fromCharCode(65 + position.col)}-{position.row + 1}</span>
              {current ? <span className="rover">●</span> : null}
              {!current && tile?.hazard ? <span className="hazard-mark">!</span> : null}
              {!current && tile?.resource ? <span className="resource">{resourceGlyph[tile.resource]}</span> : null}
              {!current && tile?.revealed && !tile.hazard && !tile.resource ? <span className="count">{tile.nearbyHazards ?? 0}</span> : null}
              {base ? <span className="base">BASE</span> : null}
            </div>
          );
        })}
        {calibrationMode ? <div className="calibration-label">TARGET 53.44 × 33.40 CM · CELL 6.68 CM</div> : null}
      </section>
      <div className="screen-margin right-margin">
        <strong>{state ? time(state.remainingMs) : '--:--'}</strong>
        <span>{error || `${state?.rover.hp ?? '-'} HP`}</span>
      </div>
    </main>
  );
}
