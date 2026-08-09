// Which slot in the vertex buffer is holding which tile of the world.
//
// Addressed by tile coordinate through a map and a free list, never by position
// in the ring. Position-indexing is the obvious implementation and it is wrong:
// step one tile forward and every slot's target changes, so the whole ring
// reloads for a move that should cost one edge. Measured in the mock at 49
// reloads instead of 7, with the queue backed up to 107 and the world black
// while the camera was moving.

export function createSlots({ ring }) {
  const total = ring * ring;
  const half = (ring - 1) / 2;
  // data and pending belong to the caller; nothing in here reads them.
  const slots = Array.from({ length: total },
    () => ({ tx: null, tz: null, ready: false, data: null, pending: null }));
  const byTile = new Map();
  const free = Array.from({ length: total }, (_, i) => total - 1 - i);

  const key = (tx, tz) => `${tx}:${tz}`;

  function reshelve(ctx, ctz) {
    const want = new Map();
    for (let j = -half; j <= half; j++) {
      for (let i = -half; i <= half; i++) want.set(key(ctx + i, ctz + j), [ctx + i, ctz + j]);
    }
    for (const [k, idx] of [...byTile]) {
      if (want.has(k)) continue;
      // Deliberately leaves tx, tz and whatever the slot is holding alone. The
      // caller keeps drawing it until a replacement lands; by then it is
      // outside the frame and the shader's clip hides it. Blanking here punched
      // a black square in the leading edge for the length of every fetch.
      byTile.delete(k);
      free.push(idx);
      slots[idx].ready = false;
    }
    const jobs = [];
    for (const [k, [tx, tz]] of want) {
      if (byTile.has(k)) continue;
      const idx = free.pop();
      if (idx === undefined) break;
      byTile.set(k, idx);
      slots[idx].tx = tx;
      slots[idx].tz = tz;
      slots[idx].ready = false;
      jobs.push({ idx, tx, tz });
    }
    // Nearest first, so what you are moving towards fills in before the corners.
    jobs.sort((a, b) =>
      (Math.abs(a.tx - ctx) + Math.abs(a.tz - ctz)) - (Math.abs(b.tx - ctx) + Math.abs(b.tz - ctz)));
    return jobs;
  }

  // After a landing every slot's tile coordinate has been shifted by the same
  // delta, which invalidates every key in the map. Rebuilding from the slots
  // themselves is cheaper than moving any data and keeps the free list honest.
  function rebase() {
    byTile.clear();
    free.length = 0;
    for (let i = total - 1; i >= 0; i--) {
      const s = slots[i];
      if (s.tx === null) free.push(i);
      else byTile.set(key(s.tx, s.tz), i);
    }
  }

  return {
    slots,
    reshelve,
    rebase,
    indexOf: (tx, tz) => byTile.get(key(tx, tz)),
    markReady: (idx) => { slots[idx].ready = true; },
    readyCount: () => slots.reduce((n, s) => n + (s.ready ? 1 : 0), 0),
  };
}
