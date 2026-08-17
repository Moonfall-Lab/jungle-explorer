import type { Heading, MotionCommand, Position } from '@jungle/shared-types';
import { positionKey, samePosition } from '@jungle/shared-types';

export interface PathOptions {
  rows: number;
  columns: number;
  allowDiagonal?: boolean;
  blocked?: Set<string>;
  cost?: (position: Position) => number;
}

const CARDINAL: Position[] = [
  { row: -1, col: 0 },
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
];
const DIAGONAL: Position[] = [
  { row: -1, col: -1 },
  { row: -1, col: 1 },
  { row: 1, col: 1 },
  { row: 1, col: -1 },
];

export function neighbors(position: Position, options: PathOptions): Position[] {
  const offsets = options.allowDiagonal ? [...CARDINAL, ...DIAGONAL] : CARDINAL;
  return offsets
    .map(({ row, col }) => ({ row: position.row + row, col: position.col + col }))
    .filter(
      (next) =>
        next.row >= 0 &&
        next.row < options.rows &&
        next.col >= 0 &&
        next.col < options.columns &&
        !options.blocked?.has(positionKey(next)),
    );
}

const heuristic = (a: Position, b: Position): number =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col);

export function findPath(start: Position, goal: Position, options: PathOptions): Position[] {
  if (samePosition(start, goal)) return [start];
  const open = new Set([positionKey(start)]);
  const positions = new Map([[positionKey(start), start]]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map([[positionKey(start), 0]]);
  const fScore = new Map([[positionKey(start), heuristic(start, goal)]]);

  while (open.size > 0) {
    const currentKey = [...open].sort(
      (a, b) => (fScore.get(a) ?? Infinity) - (fScore.get(b) ?? Infinity) || a.localeCompare(b),
    )[0];
    if (!currentKey) break;
    const current = positions.get(currentKey);
    if (!current) break;
    if (samePosition(current, goal)) {
      const path = [current];
      let cursor = currentKey;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        const previous = positions.get(cursor);
        if (previous) path.unshift(previous);
      }
      return path;
    }

    open.delete(currentKey);
    for (const next of neighbors(current, options)) {
      const nextKey = positionKey(next);
      positions.set(nextKey, next);
      const diagonal = next.row !== current.row && next.col !== current.col;
      const tentative =
        (gScore.get(currentKey) ?? Infinity) +
        (diagonal ? Math.SQRT2 : 1) +
        Math.max(0, options.cost?.(next) ?? 0);
      if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue;
      cameFrom.set(nextKey, currentKey);
      gScore.set(nextKey, tentative);
      fScore.set(nextKey, tentative + heuristic(next, goal));
      open.add(nextKey);
    }
  }
  return [];
}

const HEADING_ORDER: Heading[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

function headingBetween(from: Position, to: Position): Heading {
  if (to.row < from.row) return 'NORTH';
  if (to.row > from.row) return 'SOUTH';
  if (to.col > from.col) return 'EAST';
  return 'WEST';
}

export function pathToCommands(path: Position[], initialHeading: Heading): MotionCommand[] {
  if (path.length < 2) return [];
  const commands: MotionCommand[] = [];
  let heading = initialHeading;
  let forwardCells = 0;

  const flushForward = (): void => {
    if (forwardCells > 0) commands.push({ action: 'FORWARD', cells: forwardCells });
    forwardCells = 0;
  };

  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    if (!previous || !current) continue;
    // Physical rover paths are Manhattan-only; split diagonal steps deterministically.
    if (previous.row !== current.row && previous.col !== current.col) {
      throw new Error('Physical rover command paths cannot contain diagonal steps');
    }
    const wanted = headingBetween(previous, current);
    if (wanted !== heading) {
      flushForward();
      const fromIndex = HEADING_ORDER.indexOf(heading);
      const toIndex = HEADING_ORDER.indexOf(wanted);
      const delta = (toIndex - fromIndex + 4) % 4;
      if (delta === 1) commands.push({ action: 'TURN_RIGHT', degrees: 90 });
      else if (delta === 3) commands.push({ action: 'TURN_LEFT', degrees: 90 });
      else if (delta === 2) {
        commands.push({ action: 'TURN_RIGHT', degrees: 90 });
        commands.push({ action: 'TURN_RIGHT', degrees: 90 });
      }
      heading = wanted;
    }
    forwardCells += 1;
  }
  flushForward();
  return commands;
}
