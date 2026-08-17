import { describe, expect, it } from 'vitest';
import { parseIntentCardPayload } from './CardScanner';

describe('card scanner payload parser', () => {
  it.each([
    ['CAUTIOUS', 'CAUTIOUS'],
    ['EXPLORE', 'EXPLORE'],
    ['VERIFY', 'VERIFY'],
    ['CLUE', 'FIND_CLUE'],
    ['https://moonfall.local/card/FIND_CLUE', 'FIND_CLUE'],
  ] as const)('maps %s to %s', (payload, expected) => {
    expect(parseIntentCardPayload(payload)).toBe(expected);
  });

  it('ignores unrelated QR codes', () => {
    expect(parseIntentCardPayload('https://example.com/OTHER_CARD')).toBeUndefined();
  });
});
