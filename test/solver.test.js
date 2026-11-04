// Testes do solucionador: node test/solver.test.js
// Gera jogos de cada dificuldade e REPRODUZ a solução com regras independentes (iguais às do jogo),
// clique por clique no monte, para provar que o jogo dá para ganhar.
'use strict';
const Solver = require('../js/solver.js');

const suitOf = c => (c / 13) | 0, rankOf = c => c % 13 + 1;
const isRed = c => [1, 2].includes(suitOf(c));

function replay(deck, path, draw, maxPasses) {
  const { tab, stock } = Solver.dealFromDeck(deck);
  const G = { tab, up: tab.map(c => c.length - 1), stock, waste: [], found: [[], [], [], []], passes: 0 };
  const fail = msg => { throw new Error(msg); };
  const flip = i => { if (G.tab[i].length && G.up[i] >= G.tab[i].length) G.up[i] = G.tab[i].length - 1; };
  const topUp = i => G.tab[i].length; // índice da primeira carta virada = up[i]
  const canF = c => G.found.findIndex(p => p.length ? suitOf(p[p.length - 1]) === suitOf(c) && rankOf(c) === p.length + 1 : rankOf(c) === 1);
  const canT = (c, j) => { const p = G.tab[j]; if (!p.length) return rankOf(c) === 13; const t = p[p.length - 1]; return isRed(t) !== isRed(c) && rankOf(t) === rankOf(c) + 1; };
  const click = () => {
    if (!G.stock.length) {
      if (!G.waste.length) fail('monte vazio');
      if (maxPasses && G.passes + 1 >= maxPasses) fail('passou do limite de voltas');
      G.stock = G.waste.reverse(); G.waste = []; G.passes++;
    } else for (let i = 0, n = Math.min(draw, G.stock.length); i < n; i++) G.waste.push(G.stock.pop());
  };
  let clicks = 0;
  for (const m of path) {
    if (m.t === 'wf' || m.t === 'wt') {
      for (let i = 0; i < m.k; i++) { click(); clicks++; }
      const c = G.waste[G.waste.length - 1];
      if (c !== m.c) fail(`esperava ${m.c} no topo do descarte, veio ${c}`);
      if (m.t === 'wf') { const f = canF(c); if (f < 0) fail('wf ilegal'); G.found[f].push(G.waste.pop()); }
      else { if (!canT(c, m.to)) fail('wt ilegal'); G.tab[m.to].push(G.waste.pop()); }
    } else if (m.t === 'tf') {
      const p = G.tab[m.from], c = p[p.length - 1], f = canF(c);
      if (f < 0) fail('tf ilegal'); G.found[f].push(p.pop()); flip(m.from);
    } else if (m.t === 'tt') {
      if (m.idx < G.up[m.from]) fail('moveu carta virada para baixo');
      if (!canT(G.tab[m.from][m.idx], m.to)) fail('tt ilegal');
      G.tab[m.to].push(...G.tab[m.from].splice(m.idx)); flip(m.from);
    } else if (m.t === 'ft') {
      const f = G.found.findIndex(p => p.length && suitOf(p[0]) === m.su);
      const c = G.found[f][G.found[f].length - 1];
      if (!canT(c, m.to)) fail('ft ilegal'); G.tab[m.to].push(G.found[f].pop());
    }
  }
  if (G.found.some(p => p.length !== 13)) fail('terminou sem completar as fundações');
  return clicks;
}

let failures = 0;
for (const draw of [1, 3]) {
  for (const diff of ['easy', 'normal', 'hard']) {
    const N = 25, cfg = { draw, maxPasses: Solver.DIFFICULTY[diff].maxPasses };
    let ms = 0, tries = 0, nodes = [];
    for (let i = 0; i < N; i++) {
      const t0 = Date.now();
      const deal = Solver.makeDeal(draw, diff);
      ms += Date.now() - t0; tries += deal.tries; nodes.push(deal.nodes);
      const r = Solver.solve(Solver.stateFromDeck(deal.deck), cfg, Solver.DIFFICULTY[diff].limit);
      try { if (!r.solved) throw new Error('não resolveu de novo'); replay(deal.deck, r.path, draw, cfg.maxPasses); }
      catch (e) { failures++; console.log(`  FALHA virar ${draw} ${diff}: ${e.message}`); }
    }
    nodes.sort((a, b) => a - b);
    console.log(`virar ${draw} ${diff.padEnd(6)}: ${N} jogos verificados | média ${(ms / N).toFixed(0)} ms, ${(tries / N).toFixed(1)} tentativas | nós mediana ${nodes[N >> 1]}`);
  }
}

// Taxa de solução de baralhos aleatórios (referência): RANDOM=1 node test/solver.test.js
for (const draw of process.env.RANDOM ? [1, 3] : []) {
  let ok = 0, ex = 0; const N = 150, nodes = [];
  for (let i = 0; i < N; i++) {
    const deck = [...Array(52).keys()].sort(() => Math.random() - 0.5);
    const r = Solver.solve(Solver.stateFromDeck(deck), { draw, maxPasses: 0 }, 60000);
    if (r.solved) { ok++; nodes.push(r.nodes); } else if (r.exhausted) ex++;
  }
  nodes.sort((a, b) => a - b);
  const q = p => nodes[Math.floor(nodes.length * p)];
  console.log(`aleatório virar ${draw}: ${ok}/${N} resolvidos, ${ex} sem solução provada | nós p25 ${q(.25)} p50 ${q(.5)} p75 ${q(.75)} p90 ${q(.9)}`);
}
if (failures) { console.log(`${failures} FALHAS`); process.exit(1); }
console.log('OK: todas as soluções reproduzidas com as regras do jogo');
