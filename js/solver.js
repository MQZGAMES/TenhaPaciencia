// Solucionador de Paciência (Klondike).
// Usado para gerar só jogos que dão para ganhar, para medir a dificuldade e para as dicas.
// Roda como Web Worker (no jogo), como script comum (reserva) e no Node (testes).
'use strict';

(function () {
  const suitOf = c => (c / 13) | 0;
  const rankOf = c => (c % 13) + 1;
  const isRed = c => { const s = (c / 13) | 0; return s === 1 || s === 2; };

  // Dificuldades. maxPasses = quantas vezes dá para passar pelo monte (0 = sem limite).
  // Fácil: jogos que se resolvem quase sem desvios. Difícil: exige planejamento e tem monte limitado.
  const DIFFICULTY = {
    easy:   { maxPasses: 0, limit: 3000,  maxNodes: 90 },
    normal: { maxPasses: 0, limit: 40000 },
    hard:   { maxPasses: 3, limit: 40000, minNodes: 400 },
  };

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Mesma distribuição do jogo: as cartas saem do fim do baralho, coluna por coluna.
  function dealFromDeck(deck) {
    const d = deck.slice();
    const tab = [];
    for (let c = 0; c < 7; c++) {
      tab.push([]);
      for (let k = 0; k <= c; k++) tab[c].push(d.pop());
    }
    return { tab, stock: d };
  }

  function stateFromDeck(deck) {
    const { tab, stock } = dealFromDeck(deck);
    return { tab, down: tab.map(c => c.length - 1), stock, waste: [], found: [0, 0, 0, 0], passes: 0 };
  }

  const clone = s => ({
    tab: s.tab.map(c => c.slice()), down: s.down.slice(), stock: s.stock.slice(),
    waste: s.waste.slice(), found: s.found.slice(), passes: s.passes,
  });

  const canFound = (s, c) => s.found[suitOf(c)] === rankOf(c) - 1;
  function canTab(c, col) {
    if (!col.length) return rankOf(c) === 13;
    const t = col[col.length - 1];
    return isRed(t) !== isRed(c) && rankOf(t) === rankOf(c) + 1;
  }
  function flip(s, i) { if (s.down[i] > 0 && s.tab[i].length === s.down[i]) s.down[i]--; }

  // Carta que pode ir para a fundação sem nunca atrapalhar (ninguém mais precisa dela na mesa).
  function safe(s, c) {
    const r = rankOf(c);
    if (r <= 2) return true;
    const o = isRed(c) ? [0, 3] : [1, 2];
    return s.found[o[0]] >= r - 1 && s.found[o[1]] >= r - 1;
  }

  function autoplay(s, log) {
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < 7; i++) {
        const col = s.tab[i];
        if (!col.length) continue;
        const c = col[col.length - 1];
        if (canFound(s, c) && safe(s, c)) {
          col.pop();
          s.found[suitOf(c)]++;
          flip(s, i);
          log.push({ t: 'tf', from: i, c });
          changed = true;
        }
      }
      if (s.waste.length) {
        const c = s.waste[s.waste.length - 1];
        if (canFound(s, c) && safe(s, c)) {
          s.waste.pop();
          s.found[suitOf(c)]++;
          log.push({ t: 'wf', k: 0, c });
          changed = true;
        }
      }
    }
  }

  // Todas as cartas do monte que dá para alcançar, e com quantos toques no monte (k).
  function talon(s, cfg) {
    const out = [];
    const seen = new Set();
    let st = s.stock.slice(), wa = s.waste.slice(), p = s.passes, k = 0;
    const push = () => {
      const top = wa[wa.length - 1];
      if (seen.has(top)) return;
      seen.add(top);
      out.push({ k, stock: st.slice(), waste: wa.slice(), passes: p, top });
    };
    if (wa.length) push();
    const total = st.length + wa.length;
    if (!total) return out;
    const maxSteps = (Math.ceil(total / cfg.draw) + 1) * 2 + 2;
    for (let step = 0; step < maxSteps; step++) {
      if (!st.length) {
        if (!wa.length || (cfg.maxPasses && p + 1 >= cfg.maxPasses)) break;
        st = wa.reverse();
        wa = [];
        p++;
        k++;
        continue;
      }
      const n = Math.min(cfg.draw, st.length);
      for (let i = 0; i < n; i++) wa.push(st.pop());
      k++;
      push();
    }
    return out;
  }

  function genMoves(s, cfg) {
    const found = [], reveal = [], fromTalon = [], other = [], last = [];
    for (let i = 0; i < 7; i++) {
      const col = s.tab[i];
      if (col.length && canFound(s, col[col.length - 1])) found.push({ t: 'tf', from: i, c: col[col.length - 1] });
    }
    const tal = talon(s, cfg);
    for (const pos of tal) if (canFound(s, pos.top)) found.push({ t: 'wf', k: pos.k, c: pos.top, pos });

    for (let i = 0; i < 7; i++) {
      const col = s.tab[i];
      const fu = s.down[i];
      if (col.length <= fu) continue;
      for (let j = 0; j < 7; j++) {
        if (j === i || !canTab(col[fu], s.tab[j])) continue;
        if (!s.tab[j].length && fu === 0) continue; // Rei de coluna vazia para outra vazia
        (fu > 0 ? reveal : other).push({ t: 'tt', from: i, idx: fu, to: j, c: col[fu], d: fu });
        if (!s.tab[j].length) break; // uma coluna vazia basta
      }
      // Mover parte da pilha só vale se liberar uma carta para a fundação.
      for (let idx = fu + 1; idx < col.length; idx++) {
        if (!canFound(s, col[idx - 1])) continue;
        for (let j = 0; j < 7; j++) {
          if (j !== i && canTab(col[idx], s.tab[j])) { other.push({ t: 'tt', from: i, idx, to: j, c: col[idx] }); break; }
        }
      }
    }
    reveal.sort((a, b) => b.d - a.d);

    for (const pos of tal) {
      let empty = false;
      for (let j = 0; j < 7; j++) {
        if (!canTab(pos.top, s.tab[j])) continue;
        if (!s.tab[j].length) { if (empty) continue; empty = true; }
        fromTalon.push({ t: 'wt', k: pos.k, c: pos.top, to: j, pos });
      }
    }
    fromTalon.sort((a, b) => a.k - b.k);

    for (let su = 0; su < 4; su++) {
      const r = s.found[su];
      if (r < 3) continue;
      const c = su * 13 + r - 1;
      for (let j = 0; j < 7; j++) {
        if (s.tab[j].length && canTab(c, s.tab[j])) { last.push({ t: 'ft', su, to: j, c }); break; }
      }
    }
    return found.concat(reveal, fromTalon, other, last);
  }

  function apply(s, m) {
    const n = clone(s);
    if (m.t === 'tf') {
      const c = n.tab[m.from].pop();
      n.found[suitOf(c)]++;
      flip(n, m.from);
    } else if (m.t === 'tt') {
      const run = n.tab[m.from].splice(m.idx);
      n.tab[m.to].push(...run);
      flip(n, m.from);
    } else if (m.t === 'wf' || m.t === 'wt') {
      n.stock = m.pos.stock.slice();
      n.waste = m.pos.waste.slice();
      n.passes = m.pos.passes;
      const c = n.waste.pop();
      if (m.t === 'wf') n.found[suitOf(c)]++;
      else n.tab[m.to].push(c);
    } else if (m.t === 'ft') {
      n.found[m.su]--;
      n.tab[m.to].push(m.c);
    }
    return n;
  }

  const keyOf = (s, cfg) =>
    s.tab.map((c, i) => s.down[i] + ':' + c.join('.')).sort().join('/') +
    '|' + s.stock.join('.') + '|' + s.waste.join('.') + (cfg.maxPasses ? '|' + s.passes : '');

  // Busca em profundidade com limite de nós. exhausted = provou que não tem solução.
  function solve(start, cfg, limit) {
    const visited = new Set();
    let nodes = 0, aborted = false;
    const path = [];
    const s0 = clone(start);
    const autos0 = [];
    autoplay(s0, autos0);

    function dfs(s) {
      if (s.found[0] + s.found[1] + s.found[2] + s.found[3] === 52) return true;
      if (nodes++ >= limit) { aborted = true; return false; }
      const k = keyOf(s, cfg);
      if (visited.has(k)) return false;
      visited.add(k);
      for (const m of genMoves(s, cfg)) {
        const ns = apply(s, m);
        const autos = [];
        autoplay(ns, autos);
        path.push(m, ...autos);
        if (dfs(ns)) return true;
        path.length -= 1 + autos.length;
        if (aborted) return false;
      }
      return false;
    }

    const solved = dfs(s0);
    const full = solved ? autos0.concat(path) : null;
    return {
      solved, nodes, exhausted: !solved && !aborted,
      path: full && full.map(m => ({ t: m.t, from: m.from, idx: m.idx, to: m.to, su: m.su, k: m.k, c: m.c })),
    };
  }

  // Gera um baralho que dá para ganhar, dentro da dificuldade pedida.
  function makeDeal(draw, diff, maxMs = 3000) {
    const d = DIFFICULTY[diff] || DIFFICULTY.normal;
    const cfg = { draw, maxPasses: d.maxPasses };
    const t0 = Date.now();
    let fallback = null;
    for (let tries = 1; tries <= 2000; tries++) {
      if (fallback && Date.now() - t0 > maxMs) break;
      const deck = shuffle([...Array(52).keys()]);
      const r = solve(stateFromDeck(deck), cfg, d.limit);
      if (!r.solved) continue;
      if (!fallback) fallback = { deck, nodes: r.nodes, tries };
      if (d.maxNodes && r.nodes > d.maxNodes) continue;
      if (d.minNodes && r.nodes < d.minNodes) continue;
      return { deck, nodes: r.nodes, tries };
    }
    return fallback; // nunca deve faltar: jogos vencíveis são a grande maioria
  }

  const api = { DIFFICULTY, dealFromDeck, stateFromDeck, solve, makeDeal, talon };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.Solver = api;
  else if (typeof self !== 'undefined') {
    self.onmessage = e => {
      const q = e.data;
      if (q.type === 'deal') {
        self.postMessage({ id: q.id, ...makeDeal(q.draw, q.diff) });
      } else if (q.type === 'solve') {
        const d = DIFFICULTY[q.diff] || DIFFICULTY.normal;
        self.postMessage({ id: q.id, ...solve(q.state, { draw: q.draw, maxPasses: d.maxPasses }, q.limit || 150000) });
      }
    };
  }
})();
