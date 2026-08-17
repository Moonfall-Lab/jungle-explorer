import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HazardType, IntentCard, Position, PublicGameState, ResourceType } from '@jungle/shared-types';
import { samePosition } from '@jungle/shared-types';
import { AgentMind, BioHud, EventFeed, JungleMap, RoverHud, time } from '@jungle/ui-components';
import { ModelViewer, type ScanAsset } from './ModelViewer.js';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type CardSpec = { id: IntentCard; index: string; title: string; copy: string; safety: string; range: string; intel: string };
type TurnStage = 'selecting' | 'moving' | 'observing';

const cards: CardSpec[] = [
  { id: 'CAUTIOUS', index: '01', title: '安全前进', copy: '让 Agent 自动选择附近最安全的落点。', safety: '高', range: '周围 1 格', intel: '少' },
  { id: 'EXPLORE', index: '02', title: '扩大探索', copy: '走得更远、揭开更多地图，但可能接近危险。', safety: '低', range: '最多 2 格', intel: '多' },
  { id: 'VERIFY', index: '03', title: '检查周围', copy: '小范围移动，确认附近危险数字是否可靠。', safety: '中', range: '上下左右', intel: '中' },
  { id: 'FIND_CLUE', index: '04', title: '获取提示', copy: '获得一条确定安全的下一步方向。', safety: '最高', range: '安全 1 步', intel: '明确' },
];

const evacuationCards: CardSpec[] = [
  { id: 'CAUTIOUS', index: '01', title: '安全撤离', copy: '让 Agent 选择风险最低的路线返回 BASE。', safety: '高', range: '稳步返回', intel: '少' },
  { id: 'EXPLORE', index: '02', title: '快速撤离', copy: '用更短路线接近 BASE，但可能穿过危险区域。', safety: '低', range: '最多 2 格', intel: '少' },
  { id: 'VERIFY', index: '03', title: '检查归路', copy: '先确认附近危险，再选择下一段撤离路线。', safety: '中', range: '上下左右', intel: '中' },
  { id: 'FIND_CLUE', index: '04', title: '获取安全路线', copy: '获得一条确定安全的 BASE 方向提示。', safety: '最高', range: '安全 1 步', intel: '明确' },
];

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

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error((await response.json()).error ?? `Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export function App() {
  const [state, setState] = useState<PublicGameState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Position>();
  const [scanAsset, setScanAsset] = useState<ScanAsset>();
  const [turnStage, setTurnStage] = useState<TurnStage>('selecting');
  const [motionPlanId, setMotionPlanId] = useState<string>();
  const [activeRoundNumber, setActiveRoundNumber] = useState<number>();
  const motionStartedAt = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setState(await jsonRequest<PublicGameState>('/api/games/current'));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接 Game Server');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!state) return;
    setSelected(state.rover.position);
    const tile = state.knowledge.find((knowledge) => samePosition(knowledge.position, state.rover.position));
    const nextAsset = assetForTile(tile?.hazard, tile?.resource);
    setScanAsset(nextAsset);
  }, [state?.round]);

  useEffect(() => {
    if (turnStage !== 'moving' || !motionPlanId || state?.pendingPlan?.id !== motionPlanId || state.pendingPlan.status !== 'CONFIRMED') return;
    const remainingMotionTime = Math.max(0, 850 - (Date.now() - motionStartedAt.current));
    const timer = window.setTimeout(() => setTurnStage('observing'), remainingMotionTime);
    return () => window.clearTimeout(timer);
  }, [motionPlanId, state?.pendingPlan?.id, state?.pendingPlan?.status, turnStage]);

  useEffect(() => {
    if (turnStage !== 'observing') return;
    const timer = window.setTimeout(() => {
      setMotionPlanId(undefined);
      setActiveRoundNumber(undefined);
      setTurnStage('selecting');
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [turnStage]);

  const play = async (card: IntentCard) => {
    if (!state) return;
    motionStartedAt.current = Date.now();
    setMotionPlanId(undefined);
    setActiveRoundNumber(state.round + 1);
    setTurnStage('moving');
    setBusy(true);
    try {
      const result = await jsonRequest<{ state: PublicGameState }>(`/api/games/${state.id}/intents`, {
        method: 'POST', body: JSON.stringify({ card }),
      });
      setMotionPlanId(result.state.pendingPlan?.id);
      setState(result.state);
      setError('');
    } catch (reason) {
      setActiveRoundNumber(undefined);
      setTurnStage('selecting');
      setError(reason instanceof Error ? reason.message : '行动失败');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (mode: 'standard' | 'demo') => {
    setMotionPlanId(undefined);
    setActiveRoundNumber(undefined);
    setTurnStage('selecting');
    setBusy(true);
    try {
      setState(await jsonRequest<PublicGameState>('/api/games', {
        method: 'POST', body: JSON.stringify({ seed: `expedition-${Date.now()}`, persona: 'CAUTIOUS', mode }),
      }));
    } finally {
      setBusy(false);
    }
  };

  const inspectTile = (position: Position) => {
    setSelected(position);
    const tile = state?.knowledge.find((knowledge) => samePosition(knowledge.position, position));
    if (!tile?.revealed) {
      setScanAsset(undefined);
      return;
    }
    const asset = assetForTile(tile.hazard, tile.resource);
    setScanAsset(asset);
  };

  const mission = useMemo(() => {
    if (!state) return '';
    if (state.phase === 'WON') return '远征完成';
    if (state.phase === 'LOST') return '远征终止';
    if (state.phase === 'AWAKENED') return '携带遗迹返回 BASE';
    return '定位遗迹并保持探险车完整';
  }, [state]);

  if (!state) return <main className={error ? 'error-screen' : 'loading'}>{error || '正在校准丛林地图…'}</main>;
  const ended = state.phase === 'WON' || state.phase === 'LOST';
  const awaiting = turnStage === 'moving';
  const observing = turnStage === 'observing';
  const displayRound = activeRoundNumber ?? state.round + 1;
  const activeCards = state.phase === 'AWAKENED' ? evacuationCards : cards;
  const selectedTile = selected
    ? state.knowledge.find((tile) => samePosition(tile.position, selected))
    : undefined;
  const selectedItem = selectedTile?.hazard ?? selectedTile?.resource;
  const recommendedIntent: IntentCard = state.phase === 'AWAKENED' || state.agent.riskAtRover >= .35
    ? 'CAUTIOUS'
    : ({ CAUTIOUS: 'CAUTIOUS', DAREDEVIL: 'EXPLORE', FORAGER: 'FIND_CLUE', INSTINCT: 'VERIFY' } as const)[state.agent.persona];
  const recommendationReason = state.phase === 'AWAKENED'
    ? '已取得遗迹，优先安全返回 BASE'
    : state.agent.riskAtRover >= .35
      ? '当前位置风险偏高，先保全探险车'
      : '符合当前 Agent 的判断风格';

  const selectedMessage = !selected
    ? '点击任意格子查看情报；探险车的移动目标由 Agent 自动决定。'
    : !selectedTile?.revealed
      ? `第 ${selected.row + 1} 行第 ${selected.col + 1} 列尚未探索；这里不能直接指定移动。`
      : selectedItem
        ? `第 ${selected.row + 1} 行第 ${selected.col + 1} 列发现${itemNames[selectedItem] ?? '现场目标'}。`
        : `第 ${selected.row + 1} 行第 ${selected.col + 1} 列已探索；周围八格有 ${selectedTile.nearbyHazards ?? 0} 个危险。`;

  return (
    <main className={`expedition-shell phase-${state.phase.toLowerCase()}`}>
      <div className="atmosphere" aria-hidden="true" />
      <header className="expedition-header">
        <div className="brand-lockup">
          <div className="brand-mark"><span>J</span><i /></div>
          <div><p>MOONFALL LAB · EXPEDITION 07</p><h1>JUNGLE <em>EXPLORER</em></h1></div>
        </div>
        <div className="mission-objective"><span>当前任务</span><strong>{mission}</strong></div>
        <div className="header-metrics">
          <div><span>PHASE</span><strong>{state.phase}</strong></div>
          <div><span>ROUND</span><strong>{String(displayRound).padStart(2, '0')}</strong></div>
          <div className={state.remainingMs < 120000 ? 'urgent' : ''}><span>TIME</span><strong>{time(state.remainingMs)}</strong></div>
        </div>
      </header>

      {state.phase === 'AWAKENED' ? (
        <div className="awakening-alert"><b>JUNGLE AWAKENED</b><span>丛林正在重构路径 · 时间流速 ×1.8 · 立即撤离</span></div>
      ) : null}
      {error ? <div className="connection-alert">连接中断 · {error}</div> : null}

      <section className="round-guide panel" aria-label="本回合操作引导">
        <div className="round-guide-copy">
          <p className="eyebrow">ROUND {String(displayRound).padStart(2, '0')} · {turnStage === 'selecting' ? 'YOUR DECISION' : turnStage === 'moving' ? 'IN MOTION' : 'RESULT'}</p>
          <h2>{awaiting ? 'Agent 正在移动探险车' : observing ? '行动完成，请观察地图变化' : state.phase === 'AWAKENED' ? '本回合请选择一种撤离策略' : '本回合请选择一种探索策略'}</h2>
          <p>{awaiting ? '正在规划并执行路线。' : observing ? '新位置与现场情报已经更新。' : '你决定策略，具体路线和移动由 Agent 完成。'}</p>
        </div>
        <ol className="turn-steps">
          <li className={turnStage === 'selecting' ? 'active' : 'done'}><span>1</span><b>选择策略</b></li>
          <li className={awaiting ? 'active' : ''}><span>2</span><b>Agent 移动</b></li>
          <li className={observing ? 'active' : ''}><span>3</span><b>观察结果</b></li>
        </ol>
      </section>

      <section className="command-deck panel">
        <div className="command-heading">
          <div><p className="eyebrow">CHOOSE ONE · 选择后立即执行</p><h2>{state.phase === 'AWAKENED' ? '你希望 Agent 如何撤离？' : '你希望 Agent 如何探索？'}</h2></div>
        </div>
        <div className="cards">
          {activeCards.map((card) => {
            const recommended = card.id === recommendedIntent;
            return (
              <button className={`intent-card intent-${card.id.toLowerCase()} ${recommended ? 'recommended' : ''}`} disabled={busy || ended || turnStage !== 'selecting'} key={card.id} onClick={() => void play(card.id)} type="button">
                {recommended ? <span className="recommended-badge" title={recommendationReason}>推荐</span> : null}
                <span className="card-index">{card.index}</span><span className="intent-sigil" aria-hidden="true" />
                <strong>{card.title}</strong><small>{card.copy}</small>
                <dl><div><dt>安全性</dt><dd>{card.safety}</dd></div><div><dt>范围</dt><dd>{card.range}</dd></div><div><dt>情报</dt><dd>{card.intel}</dd></div></dl>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mission-grid">
        <div className="map-column">
          <JungleMap
            itemArtwork={mapArtwork}
            onSelect={inspectTile}
            state={state}
            {...(selected ? { selected } : {})}
          />
          <div className="map-helpbar" role="status"><span>查看模式</span><p>{selectedMessage}</p><small>地图数字表示周围八格的危险数量</small></div>
          {awaiting ? (
            <div className="movement-ribbon"><i /><div><b>ROVER IN MOTION</b><span>等待最终定位裁决</span></div><strong>{busy ? 'PLANNING' : state.pendingPlan?.commands.map((command) => command.action === 'FORWARD' ? `F${command.cells}` : command.action === 'TURN_LEFT' ? 'L' : 'R').join('  ')}</strong></div>
          ) : null}
        </div>

        <aside className="intel-column">
          <AgentMind state={state} />
          <section className="scan-panel panel">
            <div className="section-heading"><div><p className="eyebrow">SELECTED CELL · 现场情报</p><h2>当前目标扫描</h2></div><span className="live-dot">LIVE</span></div>
            {scanAsset ? <ModelViewer asset={scanAsset} /> : (
              <div className="scan-empty" role="status"><i aria-hidden="true" /><strong>暂无可扫描对象</strong><span>该格尚未探索，或没有发现危险与资源。</span></div>
            )}
            <details className="asset-archive">
              <summary>查看全部现场样本</summary>
              <div className="asset-switcher" aria-label="3D 样本选择">
                {scanAssets.map((asset) => (
                  <button className={scanAsset?.id === asset.id ? 'active' : ''} key={asset.id} onClick={() => setScanAsset(asset)} title={asset.title} type="button">
                    <span>{asset.title.slice(0, 1)}</span><small>{asset.title}</small>
                  </button>
                ))}
              </div>
            </details>
          </section>
        </aside>
      </section>

      <details className="system-details">
        <summary><span>详细信息与任务设置</span><small>探险车状态 · 生理数据 · 行动日志</small></summary>
        <section className="lower-deck">
          <div className="telemetry-stack"><RoverHud state={state} /><BioHud state={state} /></div>
          <EventFeed state={state} />
          <section className="panel field-notes">
            <p className="eyebrow">EXPEDITION CONTROL</p>
            <h3>任务设置</h3>
            <p>标准模式需取得遗迹并返回 BASE；短模式在取得遗迹时立即结束。</p>
            <div className="toolbar">
              <button disabled={busy} onClick={() => void reset('standard')} type="button">新建标准局</button>
              <button disabled={busy} onClick={() => void reset('demo')} type="button">新建短模式</button>
            </div>
          </section>
        </section>
      </details>

      {ended ? (
        <div className={`mission-result result-${state.phase.toLowerCase()}`}>
          <div className="result-card">
            <p>EXPEDITION STATUS</p><h2>{state.phase === 'WON' ? '遗迹成功回收' : '远征行动终止'}</h2>
            <span>{state.events.at(-1)?.message}</span>
            <div><b>{state.round}</b><small>完成回合</small><b>{state.rover.hp}/{state.rover.maxHp}</b><small>剩余完整度</small></div>
            <button onClick={() => void reset('standard')} type="button">开始新的标准远征</button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
