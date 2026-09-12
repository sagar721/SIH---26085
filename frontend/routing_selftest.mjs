// Standalone self-test of the routing engine's core algorithm (Dijkstra +
// blocked-edge exclusion + risk-weighted cost), reimplemented in plain JS
// against a small hand-checkable synthetic graph, mirroring the project's
// established "self-test before trusting real data" pattern
// (process_dem.py --selftest). This validates algorithm correctness BEFORE
// the TypeScript module (routingEngine.ts, same logic) is wired to real
// road data in the UI.
//
// Synthetic network (a diamond with a shortcut):
//
//   A --1km(low risk)--> B --1km(low risk)--> D      total A-B-D = 2km, risk 0
//   A --1.2km(HIGH risk)--> D                          direct A-D = 1.2km, risk 0.9
//   A --0.9km(BLOCKED)--> C --0.9km(low risk)--> D     A-C-D = 1.8km but blocked
//
// Expected:
//   fastest  (k=0):  should take the 1.2km direct high-risk edge (shortest distance)
//   safest   (k=15): should take the 2km A-B-D path (avoids the risky 1.2km edge
//                     entirely, since 1.2*(1+15*0.9)=16.8 >> 2*(1+15*0)=2)
//   blocked A-C-D must NEVER be selected by any mode, and removing the A-B-D
//   and A-D edges entirely must produce "no route found".

function heapDijkstra(adjacency, start, end, k) {
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const visited = new Set();
  const heap = [[0, start]];
  const push = (item) => { heap.push(item); heap.sort((a, b) => a[0] - b[0]); }; // simple sort-based heap, fine for a tiny test graph
  const pop = () => heap.shift();

  while (heap.length) {
    const [cost, node] = pop();
    if (visited.has(node)) continue;
    visited.add(node);
    if (node === end) break;
    for (const edge of adjacency.get(node) ?? []) {
      if (edge.blocked) continue;
      const next = cost + edge.distanceKm * (1 + k * edge.risk);
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, node);
        push([next, edge.to]);
      }
    }
  }
  if (!dist.has(end)) return null;
  const path = [end];
  let cur = end;
  while (cur !== start) { cur = prev.get(cur); path.unshift(cur); }
  return path;
}

function buildAdjacency(edgeList) {
  const adj = new Map();
  for (const e of edgeList) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.to).push({ ...e, from: e.to, to: e.from });
  }
  return adj;
}

let failures = 0;
function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  if (!ok) failures++;
}

// --- Test 1: fastest picks the shortest-distance path regardless of risk ---
const edges1 = [
  { from: 'A', to: 'B', distanceKm: 1.0, risk: 0.0, blocked: false },
  { from: 'B', to: 'D', distanceKm: 1.0, risk: 0.0, blocked: false },
  { from: 'A', to: 'D', distanceKm: 1.2, risk: 0.9, blocked: false },
  { from: 'A', to: 'C', distanceKm: 0.9, risk: 0.0, blocked: true },
  { from: 'C', to: 'D', distanceKm: 0.9, risk: 0.0, blocked: false },
];
const adj1 = buildAdjacency(edges1);
assertEqual(heapDijkstra(adj1, 'A', 'D', 0), ['A', 'D'], 'fastest (k=0) takes the direct 1.2km edge');

// --- Test 2: safest avoids the high-risk direct edge for a longer safe path ---
assertEqual(heapDijkstra(adj1, 'A', 'D', 15), ['A', 'B', 'D'], 'safest (k=15) takes the 2km low-risk detour, not the risky shortcut');

// --- Test 3: blocked edge is never used by any mode, even though A-C-D (1.8km) is shorter than A-B-D (2km) ---
const pathFastest = heapDijkstra(adj1, 'A', 'D', 0);
const pathSafest = heapDijkstra(adj1, 'A', 'D', 15);
assertEqual(pathFastest.includes('C'), false, 'fastest never routes through the blocked A-C edge');
assertEqual(pathSafest.includes('C'), false, 'safest never routes through the blocked A-C edge');

// --- Test 4: no route found when the graph is fully disconnected by blocking ---
const edges2 = [
  { from: 'A', to: 'C', distanceKm: 0.9, risk: 0.0, blocked: true },
  { from: 'C', to: 'D', distanceKm: 0.9, risk: 0.0, blocked: false },
];
const adj2 = buildAdjacency(edges2);
assertEqual(heapDijkstra(adj2, 'A', 'D', 0), null, 'no route found when only path is blocked');

// --- Test 5: balanced (moderate k) still takes the shortcut when risk is low ---
const edges3 = [
  { from: 'A', to: 'B', distanceKm: 1.0, risk: 0.0, blocked: false },
  { from: 'B', to: 'D', distanceKm: 1.0, risk: 0.0, blocked: false },
  { from: 'A', to: 'D', distanceKm: 1.2, risk: 0.15, blocked: false }, // low risk now
];
const adj3 = buildAdjacency(edges3);
assertEqual(heapDijkstra(adj3, 'A', 'D', 4), ['A', 'D'], 'balanced (k=4) still takes a low-risk shortcut (1.2*(1+4*0.15)=1.92 < 2.0)');

console.log(failures === 0 ? '\nAll routing self-tests PASSED.' : `\n${failures} routing self-test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
