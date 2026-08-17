import type { Heading, MotionCommand, Position } from '@jungle/shared-types';

const headingOrder: Heading[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
const delta: Record<Heading, Position> = {
  NORTH: { row: -1, col: 0 },
  EAST: { row: 0, col: 1 },
  SOUTH: { row: 1, col: 0 },
  WEST: { row: 0, col: -1 },
};

export class VirtualRover {
  constructor(
    public position: Position,
    public heading: Heading = 'EAST',
    private readonly rows = 5,
    private readonly columns = 8,
  ) {}

  execute(commands: MotionCommand[]): { position: Position; heading: Heading; durationMs: number } {
    let durationMs = 0;
    for (const command of commands) {
      if (command.action === 'TURN_LEFT' || command.action === 'TURN_RIGHT') {
        const turn = command.action === 'TURN_RIGHT' ? 1 : -1;
        this.heading = headingOrder[(headingOrder.indexOf(this.heading) + turn + 4) % 4] ?? this.heading;
        durationMs += 420;
      } else {
        for (let cell = 0; cell < (command.cells ?? 0); cell += 1) {
          const movement = delta[this.heading];
          const next = { row: this.position.row + movement.row, col: this.position.col + movement.col };
          if (next.row < 0 || next.row >= this.rows || next.col < 0 || next.col >= this.columns) {
            throw new Error('Virtual rover hit the board boundary');
          }
          this.position = next;
          durationMs += 780;
        }
      }
    }
    return { position: this.position, heading: this.heading, durationMs };
  }
}
