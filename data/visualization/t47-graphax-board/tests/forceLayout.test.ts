import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BARNES_HUT_THRESHOLD,
  applyBarnesHutRepulsion,
  applyExactRepulsion,
  stepForceSimulation,
  type SimNode,
} from '../src/lib/forceLayout.ts';

// Deterministic pseudo-random positions
function nodes(count: number, seed = 7): SimNode[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, x: rnd() * 4000, y: rnd() * 3000, vx: 0, vy: 0 }));
}

describe('force layout: Barnes-Hut repulsion', () => {
  it('stays close to the exact all-pairs repulsion', () => {
    const exact = nodes(800);
    const approx = exact.map((n) => ({ ...n }));
    applyExactRepulsion(exact, 38000);
    applyBarnesHutRepulsion(approx, 38000);
    let errSum = 0;
    let normSum = 0;
    for (let i = 0; i < exact.length; i++) {
      errSum += Math.hypot(exact[i].vx - approx[i].vx, exact[i].vy - approx[i].vy);
      normSum += Math.hypot(exact[i].vx, exact[i].vy);
    }
    assert.ok(errSum / normSum < 0.05, `mean relative error ${(errSum / normSum).toFixed(4)}`);
  });

  it('leaves pinned nodes alone and handles nodes on the same point', () => {
    const list = nodes(BARNES_HUT_THRESHOLD + 50);
    for (let i = 0; i < 20; i++) Object.assign(list[i], { x: 100, y: 100 });
    const held = new Set(['n0', 'n5']);
    applyBarnesHutRepulsion(list, 38000, (id) => held.has(id));
    assert.equal(list[0].vx, 0);
    assert.equal(list[5].vy, 0);
    assert.ok(list.every((n) => Number.isFinite(n.vx) && Number.isFinite(n.vy)));
    assert.ok(list.slice(1, 5).some((n) => n.vx !== 0 || n.vy !== 0), 'stacked nodes are pushed apart');
  });

  it('needs far fewer force computations than the exact sum on a large graph', () => {
    // Both computations call Math.sqrt once per force they work out, so counting those
    // calls measures the work done without timing, which machine load makes unreliable
    const big = nodes(3000);
    const forces = (apply: typeof applyExactRepulsion) => {
      const sqrt = Math.sqrt;
      let calls = 0;
      Math.sqrt = (x: number) => {
        calls++;
        return sqrt(x);
      };
      try {
        apply(big.map((n) => ({ ...n })), 38000);
      } finally {
        Math.sqrt = sqrt;
      }
      return calls;
    };
    const exact = forces(applyExactRepulsion);
    const bh = forces(applyBarnesHutRepulsion);
    assert.equal(exact, (3000 * 2999) / 2);
    assert.ok(bh < exact / 10, `Barnes-Hut ${bh} force computations, exact ${exact}`);
    // stepForceSimulation switches to it above the threshold
    const maxSpeed = stepForceSimulation(nodes(BARNES_HUT_THRESHOLD + 1), [], null, 0.72);
    assert.ok(Number.isFinite(maxSpeed) && maxSpeed > 0);
  });
});
