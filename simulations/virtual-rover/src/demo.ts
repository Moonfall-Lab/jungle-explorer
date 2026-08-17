import { VirtualRover } from './index.js';

const rover = new VirtualRover({ row: 2, col: 0 });
const result = rover.execute([
  { action: 'FORWARD', cells: 2 },
  { action: 'TURN_LEFT', degrees: 90 },
  { action: 'FORWARD', cells: 1 },
]);
console.log(JSON.stringify(result, null, 2));
