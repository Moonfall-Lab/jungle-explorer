import type {
  ObserverGameState,
  Position,
  PublicGameState,
  ResourceType,
  TileTruth,
} from '@jungle/shared-types';
import { positionKey, samePosition } from '@jungle/shared-types';

const resourceGlyph: Record<ResourceType, string> = {
  WATER: '💧',
  RARE_FLOWER: '✦',
  RELIC_MARKER: '◇',
  RELIC: '◆',
};

function truthAt(truth: TileTruth[] | undefined, position: Position): TileTruth | undefined {
  return truth?.find((tile) => samePosition(tile.position, position));
}

export function JungleMap({
  state,
  observer = false,
}: {
  state: PublicGameState | ObserverGameState;
  observer?: boolean;
}) {
  const observerState = observer && 'truth' in state ? state : undefined;
  const risks = new Map(observerState?.riskMap.map((cell) => [positionKey(cell.position), cell.risk]));
  return (
    <section className="map-panel panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">5 × 8 LOGIC GRID</p>
          <h2>Jungle Map</h2>
        </div>
        <div className="map-legend"><span>● Rover</span><span>▥ BASE</span><span>◆ Relic</span></div>
      </div>
      <div
        className="jungle-grid"
        style={{ gridTemplateColumns: `repeat(${state.config.columns}, minmax(0, 1fr))` }}
      >
        {state.knowledge.map((tile) => {
          const current = samePosition(tile.position, state.rover.position);
          const isStart = samePosition(tile.position, state.start);
          const truth = truthAt(observerState?.truth, tile.position);
          const risk = risks.get(positionKey(tile.position));
          const visibleResource = tile.resource ?? (observer ? truth?.resource : undefined);
          const visibleHazard = tile.hazard ?? (observer ? truth?.hazard : undefined);
          const classNames = [
            'jungle-cell',
            tile.revealed ? 'revealed' : 'unknown',
            tile.forgotten ? 'forgotten' : '',
            current ? 'current' : '',
            visibleHazard ? 'hazard' : '',
            observer ? 'observer-cell' : '',
          ].filter(Boolean).join(' ');
          return (
            <div className={classNames} key={positionKey(tile.position)} title={`R${tile.position.row + 1} C${tile.position.col + 1}`}>
              <span className="cell-coordinate">{tile.position.row + 1}.{tile.position.col + 1}</span>
              {current ? <span className="rover-glyph">●</span> : null}
              {!current && visibleHazard ? <span className="hazard-glyph">!</span> : null}
              {!current && visibleResource ? <span className="resource-glyph">{resourceGlyph[visibleResource]}</span> : null}
              {!current && !visibleHazard && !visibleResource && tile.revealed ? (
                <span className={`danger-count danger-${tile.nearbyHazards ?? 0}`}>{tile.nearbyHazards || '·'}</span>
              ) : null}
              {isStart ? <span className="edge-label">BASE</span> : null}
              {observer && risk !== undefined ? <span className="risk-label">{Math.round(risk * 100)}%</span> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
