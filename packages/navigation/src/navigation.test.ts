import { describe, expect, it } from 'vitest';
import { findPath, pathToCommands } from './index.js';

describe('navigation', () => {
  it('finds a path around blocked cells', () => {
    const path = findPath(
      { row: 0, col: 0 },
      { row: 0, col: 2 },
      { rows: 3, columns: 3, blocked: new Set(['0:1']) },
    );
    expect(path).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 0, col: 2 },
    ]);
  });

  it('turns a Manhattan path into integer rover commands', () => {
    expect(
      pathToCommands(
        [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 2 },
        ],
        'NORTH',
      ),
    ).toEqual([
      { action: 'TURN_RIGHT', degrees: 90 },
      { action: 'FORWARD', cells: 2 },
      { action: 'TURN_RIGHT', degrees: 90 },
      { action: 'FORWARD', cells: 1 },
    ]);
  });
});
