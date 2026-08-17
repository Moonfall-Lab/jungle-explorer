import { describe, expect, it } from 'vitest';
import { VirtualRover } from './index.js';

describe('virtual rover', () => {
  it('executes the same integer protocol as the physical rover', () => {
    const rover = new VirtualRover({ row: 2, col: 0 });
    expect(rover.execute([{ action: 'FORWARD', cells: 2 }, { action: 'TURN_LEFT', degrees: 90 }, { action: 'FORWARD', cells: 1 }])).toMatchObject({
      position: { row: 1, col: 2 },
      heading: 'NORTH',
    });
  });
});
