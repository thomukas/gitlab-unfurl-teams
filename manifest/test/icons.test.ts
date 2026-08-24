import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Reads width and height from a PNG IHDR chunk. No dependencies. */
function pngSize(relative: string): { width: number; height: number; isPng: boolean } {
  const buf = readFileSync(fileURLToPath(new URL(relative, import.meta.url)));
  const signature = buf.subarray(0, 8).toString('hex');
  return {
    isPng: signature === '89504e470d0a1a0a',
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe('Teams app icons', () => {
  // Teams rejects an upload whose icons are the wrong size, and the store
  // validation guidelines make both dimensions a "must fix".
  it('color.png is exactly 192x192', () => {
    const { isPng, width, height } = pngSize('../color.png');
    expect(isPng).toBe(true);
    expect([width, height]).toEqual([192, 192]);
  });

  it('outline.png is exactly 32x32', () => {
    const { isPng, width, height } = pngSize('../outline.png');
    expect(isPng).toBe(true);
    expect([width, height]).toEqual([32, 32]);
  });

  it('both are square, which the guidelines require', () => {
    for (const icon of ['../color.png', '../outline.png']) {
      const { width, height } = pngSize(icon);
      expect(width).toBe(height);
    }
  });
});
