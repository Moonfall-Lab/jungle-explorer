import type {
  HazardType,
  IntentCard,
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
  selected,
  onSelect,
  itemArtwork,
  preview,
  route,
  target,
  candidates,
  revealedPosition,
  stageLabel,
}: {
  state: PublicGameState | ObserverGameState;
  observer?: boolean;
  selected?: Position;
  onSelect?: (position: Position) => void;
  itemArtwork?: Partial<Record<HazardType | ResourceType, string>>;
  preview?: { intent: IntentCard; positions: Position[] };
  route?: Position[];
  target?: Position;
  candidates?: Position[];
  revealedPosition?: Position;
  stageLabel?: string;
}) {
  const observerState = observer && 'truth' in state ? state : undefined;
  const risks = new Map(observerState?.riskMap.map((cell) => [positionKey(cell.position), cell.risk]));
  const previewPositions = new Set(preview?.positions.map(positionKey));
  const routePositions = new Map(route?.map((position, index) => [positionKey(position), index]));
  const candidatePositions = new Map(candidates?.map((position, index) => [positionKey(position), index]));
  return (
    <section className="map-panel panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">{stageLabel ?? '5 × 8 LOGIC GRID'}</p>
          <h2>Jungle Map</h2>
        </div>
        <div className="map-legend"><span>◉ 探险车</span><span>▥ 基地</span><span>数字 = 周围危险数</span><span>斜纹 = 未探索</span></div>
      </div>
      <div className="grid-stage">
        <div
          className="jungle-grid"
          style={{
            gridTemplateColumns: `repeat(${state.config.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${state.config.rows}, minmax(0, 1fr))`,
          }}
        >
          {state.knowledge.map((tile) => {
          const current = samePosition(tile.position, state.rover.position);
          const isSelected = selected ? samePosition(tile.position, selected) : false;
          const isStart = samePosition(tile.position, state.start);
          const truth = truthAt(observerState?.truth, tile.position);
          const risk = risks.get(positionKey(tile.position));
          const visibleResource = tile.resource ?? (observer ? truth?.resource : undefined);
          const visibleHazard = tile.hazard ?? (observer ? truth?.hazard : undefined);
          const visibleItem = visibleHazard ?? visibleResource;
          const artwork = visibleItem ? itemArtwork?.[visibleItem] : undefined;
          const key = positionKey(tile.position);
          const routeIndex = routePositions.get(key);
          const candidateIndex = candidatePositions.get(key);
          const isTarget = target ? samePosition(tile.position, target) : false;
          const isRevealing = revealedPosition ? samePosition(tile.position, revealedPosition) : false;
          const classNames = [
            'jungle-cell',
            tile.revealed ? 'revealed' : 'unknown',
            tile.forgotten ? 'forgotten' : '',
            current ? 'current' : '',
            isSelected ? 'selected' : '',
            visibleHazard ? 'hazard' : '',
            tile.consumed ? 'consumed' : '',
            observer ? 'observer-cell' : '',
            onSelect ? 'selectable' : '',
            previewPositions.has(key) ? `intent-preview preview-${preview?.intent.toLowerCase()}` : '',
            routeIndex !== undefined ? 'projected-route' : '',
            isTarget ? 'route-target' : '',
            candidateIndex !== undefined ? `decision-candidate candidate-${candidateIndex + 1}` : '',
            isRevealing ? 'cell-revealing' : '',
          ].filter(Boolean).join(' ');
            return (
              <button
              aria-label={`第 ${tile.position.row + 1} 行第 ${tile.position.col + 1} 列${tile.revealed ? '，已探索' : '，未知'}`}
              className={classNames}
              disabled={!onSelect}
              key={positionKey(tile.position)}
              onClick={() => onSelect?.(tile.position)}
              title={`R${tile.position.row + 1} C${tile.position.col + 1}`}
              type="button"
              >
              <span className="cell-coordinate">{tile.position.row + 1}.{tile.position.col + 1}</span>
              {artwork ? <img alt="" aria-hidden="true" className="cell-artwork" src={artwork} /> : null}
              {current ? <span className="rover-glyph">●</span> : null}
              {!current && visibleHazard && !artwork ? <span className="hazard-glyph">!</span> : null}
              {!current && visibleResource && !artwork ? <span className="resource-glyph">{resourceGlyph[visibleResource]}</span> : null}
              {!current && !visibleHazard && !visibleResource && tile.revealed ? (
                <span className={`danger-count danger-${tile.nearbyHazards ?? 0}`}>{tile.nearbyHazards || '·'}</span>
              ) : null}
              {isStart ? <span className="edge-label">BASE</span> : null}
              {observer && risk !== undefined ? <span className="risk-label">{Math.round(risk * 100)}%</span> : null}
              {candidateIndex !== undefined ? <span className="candidate-label">{String.fromCharCode(65 + candidateIndex)}</span> : null}
              {routeIndex !== undefined && routeIndex > 0 ? <span className="route-node">{isTarget ? 'TARGET' : routeIndex}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
