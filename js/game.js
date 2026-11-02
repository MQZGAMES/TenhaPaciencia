// TenhaPaciência — Paciência (Klondike) em JavaScript puro.
// Cartas são elementos DOM fixos (52) movidos por transform; o layout é recalculado a cada jogada.
'use strict';

(() => {
  // ---------- Naipes e cartas ----------
  // Paths em viewBox 0 0 100 100, usados no SVG das cartas e no canvas da animação de vitória.
  const SUITS = [
    { name: 'espadas', red: false, path: 'M50 4C36 24 8 38 8 59c0 14 11 24 24 24 8 0 14-4 17-9-1 9-5 16-13 22h28c-8-6-12-13-13-22 3 5 9 9 17 9 13 0 24-10 24-24C92 38 64 24 50 4z' },
    { name: 'copas', red: true, path: 'M50 90C22 68 5 52 5 31 5 16 16 6 30 6c9 0 16 5 20 13 4-8 11-13 20-13 14 0 25 10 25 25 0 21-17 37-45 59z' },
    { name: 'ouros', red: true, path: 'M50 3 87 50 50 97 13 50z' },
    { name: 'paus', red: false, path: 'M69 27a19 19 0 1 1-38 0 19 19 0 1 1 38 0zM47 60a19 19 0 1 1-38 0 19 19 0 1 1 38 0zM91 60a19 19 0 1 1-38 0 19 19 0 1 1 38 0zM50 38 62 58 50 68 38 58zM46 58h8c0 17 5 29 14 38H32c9-9 14-21 14-38z' },
  ];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const CROWN = 'M4 46 9 10l21 20L50 4l20 26 21-20 5 36z';

  const suitOf = id => Math.floor(id / 13);
  const rankOf = id => (id % 13) + 1;
  const isRed = id => SUITS[suitOf(id)].red;

  // ---------- Persistência ----------
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  };

  const settings = Object.assign({ draw: 1, sound: true, felt: 'green', back: 'ruby' }, store.get('tp_settings', {}));
  const stats = Object.assign({ played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: 0, bestScore: 0 }, store.get('tp_stats', {}));
  const saveSettings = () => store.set('tp_settings', settings);
  const saveStats = () => store.set('tp_stats', stats);

  // ---------- Elementos ----------
  const $ = s => document.querySelector(s);
  const board = $('#board');
  const hud = { score: $('#score'), moves: $('#moves'), time: $('#time') };
  const btn = { undo: $('#btn-undo'), auto: $('#btn-auto'), hint: $('#btn-hint') };
  const fx = $('#fx');

  // Sprite de naipes
  document.body.insertAdjacentHTML('afterbegin',
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${
      SUITS.map((s, i) => `<symbol id="suit-${i}" viewBox="0 0 100 100"><path d="${s.path}"/></symbol>`).join('')
    }<symbol id="crown" viewBox="0 0 100 50"><path d="${CROWN}"/></symbol></defs></svg>`);

  const use = (sym, cls, vb = '0 0 100 100') => `<svg class="${cls}" viewBox="${vb}"><use href="#${sym}"/></svg>`;

  // Cartas
  const els = [];
  for (let id = 0; id < 52; id++) {
    const s = suitOf(id), r = rankOf(id);
    const el = document.createElement('div');
    el.className = `card down s${s}${SUITS[s].red ? ' red' : ''}${r === 1 ? ' ace' : ''}`;
    el.dataset.id = id;
    const center = r > 10
      ? `<div class="art">${use('crown', 'crown', '0 0 100 50')}<div class="big">${RANKS[r]}</div>${use('suit-' + s, 'mini')}</div>`
      : use('suit-' + s, 'pip');
    el.innerHTML =
      `<div class="inner"><div class="face front"><div class="rank${r === 10 ? ' ten' : ''}">${RANKS[r]}</div>` +
      `${use('suit-' + s, 'corner')}${center}</div><div class="face back"></div></div>`;
    board.appendChild(el);
    els.push(el);
  }

  // Espaços vazios
  const slots = {};
  const mkSlot = (ref, cls, html) => {
    const d = document.createElement('div');
    d.className = 'slot ' + cls;
    d.dataset.ref = ref;
    d.innerHTML = html;
    board.appendChild(d);
    slots[ref] = d;
  };
  mkSlot('stock', 'stock', '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg>');
  mkSlot('waste', 'waste', '');
  for (let f = 0; f < 4; f++) mkSlot('f' + f, 'found', use('suit-' + f, ''));
  for (let t = 0; t < 7; t++) mkSlot('t' + t, 'tab', '<span class="slot-txt">K</span>');

  // ---------- Estado ----------
  let S = null;          // estado do jogo
  let history = [];      // snapshots para desfazer
  let M = null;          // métricas de layout
  let P = [];            // última posição calculada de cada carta
  let busy = false;      // animação em andamento (distribuição, finalização, vitória)

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function freshState() {
    const deck = shuffle([...Array(52).keys()]);
    const st = {
      stock: [], waste: [], found: [[], [], [], []], tab: [[], [], [], [], [], [], []],
      up: Array(52).fill(false), draw: settings.draw, fan: 0,
      moves: 0, score: 0, time: 0, started: false, counted: false, won: false,
    };
    for (let c = 0; c < 7; c++) {
      for (let k = 0; k <= c; k++) st.tab[c].push(deck.pop());
      st.up[st.tab[c][c]] = true;
    }
    st.stock = deck;
    return st;
  }

  const pile = ref => ref === 'stock' ? S.stock : ref === 'waste' ? S.waste
    : ref[0] === 'f' ? S.found[+ref[1]] : S.tab[+ref[1]];

  function locate(id) {
    for (const ref of ['stock', 'waste', 'f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6']) {
      const i = pile(ref).indexOf(id);
      if (i >= 0) return { ref, index: i };
    }
    return null;
  }

  const snapshot = () => JSON.stringify({
    stock: S.stock, waste: S.waste, found: S.found, tab: S.tab, up: S.up,
    fan: S.fan, moves: S.moves, score: S.score,
  });
  function pushHistory() {
    history.push(snapshot());
    if (history.length > 300) history.shift();
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set('tp_game', { S, history: history.slice(-80) }), 150);
  }

  // ---------- Regras ----------
  function canFound(id, f) {
    const p = S.found[f];
    if (!p.length) return rankOf(id) === 1;
    const top = p[p.length - 1];
    return suitOf(top) === suitOf(id) && rankOf(id) === rankOf(top) + 1;
  }
  function canTab(id, t) {
    const p = S.tab[t];
    if (!p.length) return rankOf(id) === 13;
    const top = p[p.length - 1];
    return S.up[top] && isRed(top) !== isRed(id) && rankOf(id) === rankOf(top) - 1;
  }
  function canDrop(ids, ref) {
    if (ref[0] === 'f') return ids.length === 1 && canFound(ids[0], +ref[1]);
    if (ref[0] === 't') return canTab(ids[0], +ref[1]);
    return false;
  }

  function startClock() {
    if (S.started) return;
    S.started = true;
    if (!S.counted) {
      S.counted = true;
      stats.played++;
      saveStats();
    }
  }

  function addScore(n) { S.score = Math.max(0, S.score + n); }

  // Move a carta `index` de `from` (e as de cima) para `to`.
  function doMove(from, index, to) {
    pushHistory();
    startClock();
    const src = pile(from);
    const ids = src.splice(index);
    pile(to).push(...ids);

    if (from === 'waste') {
      S.fan = Math.max(1, S.fan - 1);
      addScore(to[0] === 'f' ? 10 : 5);
    } else if (from[0] === 't' && to[0] === 'f') addScore(10);
    else if (from[0] === 'f' && to[0] === 't') addScore(-15);

    let flipped = false;
    if (from[0] === 't' && src.length && !S.up[src[src.length - 1]]) {
      S.up[src[src.length - 1]] = true;
      addScore(5);
      flipped = true;
    }
    S.moves++;
    render();
    sfx.place();
    if (flipped) setTimeout(sfx.flip, 120);
    if (to[0] === 'f') sparkle(to);
    save();
    checkWin();
  }

  function drawStock() {
    if (!S.stock.length && !S.waste.length) return;
    pushHistory();
    startClock();
    if (!S.stock.length) {
      S.stock = S.waste.reverse();
      S.waste = [];
      S.stock.forEach(id => { S.up[id] = false; });
      S.fan = 0;
      if (S.draw === 1) addScore(-100);
    } else {
      const n = Math.min(S.draw, S.stock.length);
      for (let i = 0; i < n; i++) {
        const id = S.stock.pop();
        S.up[id] = true;
        S.waste.push(id);
      }
      S.fan = n;
    }
    S.moves++;
    render();
    sfx.flip();
    save();
  }

  function undo() {
    if (busy || !history.length) return;
    Object.assign(S, JSON.parse(history.pop()));
    S.won = false;
    render();
    sfx.flip();
    save();
  }

  // Toque numa carta: tenta mandar para a fundação; senão, para a melhor coluna.
  function autoMove(id) {
    const loc = locate(id);
    const ids = pile(loc.ref).slice(loc.index);
    if (ids.length === 1 && loc.ref[0] !== 'f') {
      for (let f = 0; f < 4; f++) if (canFound(id, f)) return doMove(loc.ref, loc.index, 'f' + f);
    }
    let empty = null;
    for (let t = 0; t < 7; t++) {
      if (loc.ref === 't' + t || !canTab(id, t)) continue;
      if (S.tab[t].length) return doMove(loc.ref, loc.index, 't' + t);
      if (!(loc.ref[0] === 't' && loc.index === 0) && empty === null) empty = 't' + t;
    }
    if (empty) return doMove(loc.ref, loc.index, empty);
    shake(ids);
  }

  function shake(ids) {
    sfx.nope();
    if (navigator.vibrate) navigator.vibrate(12);
    ids.forEach(id => {
      const el = els[id];
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 350);
    });
  }

  // ---------- Dicas ----------
  function findMoves() {
    const out = [];
    const tops = [];
    S.tab.forEach((p, c) => { if (p.length) tops.push({ ref: 't' + c, index: p.length - 1 }); });
    if (S.waste.length) tops.push({ ref: 'waste', index: S.waste.length - 1 });

    for (const s of tops) {
      const id = pile(s.ref)[s.index];
      for (let f = 0; f < 4; f++) if (canFound(id, f)) { out.push({ ...s, to: 'f' + f, pri: 5 }); break; }
    }
    S.tab.forEach((p, c) => {
      const fu = p.findIndex(id => S.up[id]);
      if (fu < 0) return;
      for (let i = fu; i < p.length; i++) {
        let pri = 0;
        if (i === fu) pri = fu > 0 ? 4 : (rankOf(p[i]) === 13 ? 0 : 2);
        else if (S.found.some((_, f) => canFound(p[i - 1], f))) pri = 3;
        if (!pri) continue;
        for (let t = 0; t < 7; t++) {
          if (t === c || !canTab(p[i], t)) continue;
          if (!S.tab[t].length && i === 0) continue;
          out.push({ ref: 't' + c, index: i, to: 't' + t, pri });
          break;
        }
      }
    });
    if (S.waste.length) {
      const id = S.waste[S.waste.length - 1];
      for (let t = 0; t < 7; t++) if (canTab(id, t)) { out.push({ ref: 'waste', index: S.waste.length - 1, to: 't' + t, pri: 2 }); break; }
    }
    return out.sort((a, b) => b.pri - a.pri);
  }

  function hint() {
    if (busy || S.won) return;
    const m = findMoves()[0];
    clearHints();
    if (m) {
      const ids = pile(m.ref).slice(m.index);
      ids.forEach(id => els[id].classList.add('hint'));
      const dest = pile(m.to);
      if (dest.length) els[dest[dest.length - 1]].classList.add('hint');
      else slots[m.to].classList.add('hint');
    } else if (S.stock.length || S.waste.length) {
      if (S.stock.length) els[S.stock[S.stock.length - 1]].classList.add('hint');
      else slots.stock.classList.add('hint');
      toast('Vire uma carta do monte');
    } else {
      toast('Sem jogadas — que tal um novo jogo?');
      return;
    }
    hintTimer = setTimeout(clearHints, 1800);
  }
  let hintTimer = 0;
  function clearHints() {
    clearTimeout(hintTimer);
    document.querySelectorAll('.hint').forEach(e => e.classList.remove('hint'));
  }

  // ---------- Layout ----------
  function measure() {
    const bw = board.clientWidth, bh = board.clientHeight;
    const gap = Math.round(Math.max(4, Math.min(14, bw * 0.014)));
    let cw = Math.floor((bw - gap * 8) / 7);
    cw = Math.min(cw, 112);
    // Em telas baixas (paisagem), a altura limita o tamanho da carta.
    const maxByH = Math.floor((bh - gap * 3) / 3.6 / 1.42);
    cw = Math.max(30, Math.min(cw, maxByH));
    const ch = Math.round(cw * 1.42);
    const totalW = cw * 7 + gap * 6;
    const left = Math.round((bw - totalW) / 2);
    const colX = [...Array(7)].map((_, i) => left + i * (cw + gap));
    const topY = Math.round(gap * 0.8);
    M = { bw, bh, cw, ch, gap, colX, topY, tabY: topY + ch + Math.round(gap * 1.8), fanDx: Math.round(cw * 0.3) };
    board.style.setProperty('--cw', cw + 'px');
    board.style.setProperty('--ch', ch + 'px');
    document.documentElement.style.setProperty('--cw', cw + 'px');

    const place = (ref, x, y) => { slots[ref].style.transform = `translate3d(${x}px,${y}px,0)`; };
    place('stock', colX[0], topY);
    place('waste', colX[1], topY);
    slots.waste.style.visibility = 'hidden';
    for (let f = 0; f < 4; f++) place('f' + f, colX[3 + f], topY);
    for (let t = 0; t < 7; t++) place('t' + t, colX[t], M.tabY);
  }

  function positions() {
    const out = [];
    S.stock.forEach((id, i) => {
      out[id] = { x: M.colX[0] - Math.min(2, Math.floor(i / 12)), y: M.topY - Math.min(2, Math.floor(i / 12)), z: 1 + i, ref: 'stock' };
    });
    const n = S.waste.length;
    const fan = S.draw === 3 ? Math.min(S.fan, n, 3) : Math.min(1, n);
    S.waste.forEach((id, i) => {
      const j = i - (n - fan);
      out[id] = { x: M.colX[1] + (j > 0 ? j * M.fanDx : 0), y: M.topY, z: 100 + i, ref: 'waste' };
    });
    S.found.forEach((p, f) => p.forEach((id, i) => {
      out[id] = { x: M.colX[3 + f], y: M.topY, z: 200 + i, ref: 'f' + f };
    }));
    const avail = M.bh - M.tabY - M.ch - M.gap;
    S.tab.forEach((p, c) => {
      let nd = 0, nu = 0;
      for (let i = 0; i < p.length - 1; i++) S.up[p[i]] ? nu++ : nd++;
      let d = M.ch * 0.12, u = M.ch * 0.3;
      const need = nd * d + nu * u;
      if (need > avail && need > 0) {
        const k = Math.max(0, avail) / need;
        d = Math.max(3, d * k);
        u = Math.max(M.ch * 0.14, u * k);
      }
      let y = M.tabY;
      p.forEach((id, i) => {
        out[id] = { x: M.colX[c], y: Math.round(y), z: 300 + i, ref: 't' + c };
        y += S.up[id] ? u : d;
      });
    });
    return out;
  }

  function render(opts = {}) {
    P = positions();
    for (let id = 0; id < 52; id++) {
      const el = els[id], p = P[id];
      const moving = el._ref !== undefined && el._ref !== p.ref && !opts.instant;
      el._ref = p.ref;
      el._z = p.z;
      el.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
      el.classList.toggle('down', !S.up[id]);
      el.style.visibility = '';
      if (moving || opts.lift) {
        el.style.zIndex = 600 + p.z;
        clearTimeout(el._zt);
        el._zt = setTimeout(() => { el._zt = 0; el.style.zIndex = el._z; }, 300 + (opts.lift || 0));
      } else if (!el._zt || opts.instant) {
        clearTimeout(el._zt);
        el._zt = 0;
        el.style.zIndex = p.z;
      }
    }
    slots.stock.classList.toggle('empty-all', !S.stock.length && !S.waste.length);
    updateHud();
  }

  function updateHud() {
    hud.score.textContent = S.score;
    hud.moves.textContent = S.moves;
    hud.time.textContent = fmtTime(S.time);
    btn.undo.disabled = !history.length;
    const allUp = S.tab.every(p => p.every(id => S.up[id]));
    const canAuto = !S.won && allUp && (S.draw === 1 || !S.stock.length && !S.waste.length);
    btn.auto.hidden = !canAuto;
    btn.hint.hidden = canAuto;
  }

  const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ---------- Arrastar e tocar ----------
  let drag = null;

  board.addEventListener('pointerdown', e => {
    if (busy || drag || S.won) return;
    if (e.button !== undefined && e.button > 0) return;
    clearHints();
    const el = e.target.closest('.card');
    if (!el) {
      if (e.target.closest('.slot.stock')) drawStock();
      return;
    }
    const id = +el.dataset.id;
    const loc = locate(id);
    if (loc.ref === 'stock') { drawStock(); return; }
    const src = pile(loc.ref);
    if (!S.up[id]) return;
    if (loc.ref !== 'waste' && loc.ref[0] !== 't' && loc.index !== src.length - 1) return;
    if (loc.ref === 'waste' && loc.index !== src.length - 1) return;
    const ids = src.slice(loc.index);
    drag = { id, ids, loc, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId, target: null };
    try { board.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  board.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 7) return;
      drag.moved = true;
      drag.ids.forEach((id, i) => {
        const el = els[id];
        clearTimeout(el._zt);
        el._zt = 0;
        el.classList.add('dragging');
        el.style.zIndex = 1000 + i;
      });
    }
    drag.ids.forEach(id => {
      const p = P[id];
      els[id].style.transform = `translate3d(${p.x + dx}px,${p.y + dy - 4}px,0)`;
    });
    const t = dropTarget(dx, dy);
    if (t !== drag.target) {
      clearTargets();
      drag.target = t;
      if (t) {
        const dest = pile(t);
        if (dest.length) els[dest[dest.length - 1]].classList.add('hint');
        else slots[t].classList.add('target');
      }
    }
  });

  function clearTargets() {
    document.querySelectorAll('.slot.target').forEach(s => s.classList.remove('target'));
    document.querySelectorAll('.card.hint').forEach(s => s.classList.remove('hint'));
  }

  function dropTarget(dx, dy) {
    const p0 = P[drag.ids[0]];
    const r = { x: p0.x + dx, y: p0.y + dy, w: M.cw, h: M.ch };
    let best = null, bestA = 0;
    const refs = ['f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];
    for (const ref of refs) {
      if (ref === drag.loc.ref || !canDrop(drag.ids, ref)) continue;
      const dest = pile(ref);
      let tx, ty, th = M.ch;
      if (dest.length) { const tp = P[dest[dest.length - 1]]; tx = tp.x; ty = tp.y; }
      else if (ref[0] === 'f') { tx = M.colX[3 + +ref[1]]; ty = M.topY; }
      else { tx = M.colX[+ref[1]]; ty = M.tabY; }
      if (ref[0] === 't') th += M.ch * 0.5;
      const ox = Math.min(r.x + r.w, tx + M.cw) - Math.max(r.x, tx);
      const oy = Math.min(r.y + r.h, ty + th) - Math.max(r.y, ty - M.ch * 0.2);
      const a = ox > 0 && oy > 0 ? ox * oy : 0;
      if (a > bestA) { bestA = a; best = ref; }
    }
    return best;
  }

  function endDrag(e, cancel) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    try { board.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    d.ids.forEach(id => els[id].classList.remove('dragging'));
    clearTargets();
    if (!d.moved) {
      if (!cancel) autoMove(d.id);
      return;
    }
    if (!cancel && d.target) doMove(d.loc.ref, d.loc.index, d.target);
    else render({ lift: 1 });
  }
  board.addEventListener('pointerup', e => endDrag(e, false));
  board.addEventListener('pointercancel', e => endDrag(e, true));
  board.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- Fluxo do jogo ----------
  function newGame() {
    if (S && S.counted && !S.won) { stats.streak = 0; saveStats(); }
    S = freshState();
    history = [];
    closeModals();
    clearHints();
    fx.getContext('2d').clearRect(0, 0, fx.width, fx.height);
    deal();
    save();
  }

  function deal() {
    busy = true;
    measure();
    // Todas as cartas começam no monte, viradas para baixo.
    board.classList.add('notrans');
    els.forEach((el, i) => {
      el.style.transform = `translate3d(${M.colX[0]}px,${M.topY}px,0)`;
      el.classList.add('down');
      el.style.zIndex = i;
      el.style.visibility = '';
      el._ref = undefined;
    });
    void board.offsetWidth;
    board.classList.remove('notrans');

    const order = [];
    for (let r = 0; r < 7; r++) for (let c = r; c < 7; c++) order.push(S.tab[c][r]);
    const step = 55;
    order.forEach((id, k) => {
      els[id].style.transitionDelay = k * step + 'ms';
      els[id].firstChild.style.transitionDelay = (k * step + 180) + 'ms';
    });
    render({ instant: true });
    order.forEach((id, k) => {
      els[id].style.zIndex = 400 + k;
      setTimeout(() => sfx.deal(), k * step);
    });
    const total = order.length * step + 400;
    setTimeout(() => {
      els.forEach(el => { el.style.transitionDelay = ''; el.firstChild.style.transitionDelay = ''; });
      render({ instant: true });
      busy = false;
    }, total);
  }

  function checkWin() {
    if (!S.found.every(p => p.length === 13)) return;
    S.won = true;
    busy = true;
    const bonus = S.time >= 30 ? Math.round(700000 / S.time) : 0;
    S.score += bonus;
    const newBest = S.score > stats.bestScore;
    const fastest = !stats.bestTime || S.time < stats.bestTime;
    stats.won++;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    if (newBest) stats.bestScore = S.score;
    if (fastest) stats.bestTime = S.time;
    saveStats();
    save();
    updateHud();
    setTimeout(() => {
      sfx.win();
      cascade(() => {
        busy = false;
        $('#winstats').innerHTML =
          `<div><b>${fmtTime(S.time)}</b><span>Tempo</span></div>` +
          `<div><b>${S.moves}</b><span>Jogadas</span></div>` +
          `<div><b>${S.score}</b><span>Pontos</span></div>` +
          (bonus ? `<div class="best">Bônus de tempo: +${bonus}</div>` : '') +
          (newBest ? '<div class="best">Novo recorde de pontos!</div>' : fastest ? '<div class="best">Sua vitória mais rápida!</div>' : '');
        openModal('#modal-win');
      });
    }, 350);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function autoFinish() {
    if (busy || S.won) return;
    busy = true;
    btn.auto.hidden = true;
    let idle = 0;
    while (!S.won) {
      let best = null;
      const srcs = S.tab.map((p, c) => ({ ref: 't' + c, p }));
      srcs.push({ ref: 'waste', p: S.waste });
      for (const { ref, p } of srcs) {
        if (!p.length) continue;
        const id = p[p.length - 1];
        for (let f = 0; f < 4; f++) {
          if (canFound(id, f) && (!best || rankOf(id) < best.r)) best = { ref, index: p.length - 1, f, r: rankOf(id) };
        }
      }
      if (best) {
        busy = false; doMove(best.ref, best.index, 'f' + best.f); busy = true;
        idle = 0;
      } else if (S.stock.length || S.waste.length) {
        drawStock();
        if (++idle > S.stock.length + S.waste.length + 2) break;
      } else break;
      await sleep(95);
    }
    if (!S.won) {
      busy = false;
      updateHud();
      toast('Não deu para finalizar sozinho');
    }
  }

  // ---------- Efeitos visuais ----------
  function sparkle(ref) {
    const r = board.getBoundingClientRect();
    const x = r.left + M.colX[3 + +ref[1]] + M.cw / 2, y = r.top + M.topY + M.ch / 2;
    for (let i = 0; i < 10; i++) {
      const s = document.createElement('i');
      const a = Math.random() * Math.PI * 2, dist = M.cw * (0.5 + Math.random() * 0.6);
      s.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:5px;height:5px;border-radius:50%;` +
        `background:#ffe08a;box-shadow:0 0 6px #f1c75b;pointer-events:none;z-index:40;` +
        `transition:transform .55s cubic-bezier(.2,.8,.3,1),opacity .55s;`;
      document.body.appendChild(s);
      requestAnimationFrame(() => {
        s.style.transform = `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist}px) scale(.3)`;
        s.style.opacity = '0';
      });
      setTimeout(() => s.remove(), 600);
    }
  }

  const imgCache = {};
  function cardImage(id, w, h, dpr) {
    const key = `${id}:${w}`;
    if (imgCache[key]) return imgCache[key];
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const rad = w * 0.09;
    g.beginPath();
    if (g.roundRect) g.roundRect(0.5, 0.5, w - 1, h - 1, rad);
    else g.rect(0.5, 0.5, w - 1, h - 1);
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#fffdf6');
    grad.addColorStop(1, '#f1ebdb');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.35)';
    g.lineWidth = 1;
    g.stroke();
    const s = suitOf(id), r = rankOf(id);
    g.fillStyle = SUITS[s].red ? '#c8203a' : '#1b1d29';
    g.font = `800 ${w * 0.36}px Inter, system-ui, sans-serif`;
    g.textBaseline = 'top';
    g.fillText(RANKS[r], w * 0.07, h * 0.04);
    const path = new Path2D(SUITS[s].path);
    const drawSuit = (x, y, size) => { g.save(); g.translate(x, y); g.scale(size / 100, size / 100); g.fill(path); g.restore(); };
    drawSuit(w * 0.66, h * 0.05, w * 0.27);
    if (r > 10) {
      g.font = `900 ${w * 0.5}px "Playfair Display", Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(RANKS[r], w / 2, h * 0.64);
    } else {
      const size = w * 0.56;
      drawSuit((w - size) / 2, h - h * 0.09 - size, size);
    }
    imgCache[key] = c;
    return c;
  }

  // Cascata de cartas quicando, como no clássico.
  function cascade(done) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = innerWidth, H = innerHeight;
    fx.width = W * dpr;
    fx.height = H * dpr;
    fx.style.transition = '';
    fx.style.opacity = '1';
    const g = fx.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx.classList.add('active');
    const br = board.getBoundingClientRect();
    const w = M.cw, h = M.ch;
    const order = [];
    for (let k = 12; k >= 0; k--) for (let f = 0; f < 4; f++) order.push({ id: S.found[f][k], f });
    let i = 0, parts = [], lastLaunch = -1e9, prev = 0, finished = false, raf = 0;

    function finish() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      fx.classList.remove('active');
      fx.onclick = null;
      fx.style.transition = 'opacity .5s';
      fx.style.opacity = '0';
      setTimeout(() => { g.clearRect(0, 0, W, H); fx.style.opacity = '1'; fx.style.transition = ''; }, 520);
      done();
    }
    fx.onclick = finish;

    function frame(t) {
      const k = prev ? Math.min(3, (t - prev) / 16.67) : 1;
      prev = t;
      if (i < order.length && parts.length < 4 && t - lastLaunch > 240) {
        const o = order[i++];
        els[o.id].style.visibility = 'hidden';
        parts.push({
          img: cardImage(o.id, w, h, dpr),
          x: br.left + M.colX[3 + o.f], y: br.top + M.topY,
          vx: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4.5) * (W / 400 > 1.6 ? 1.6 : Math.max(1, W / 400)),
          vy: -(2 + Math.random() * 7),
        });
        lastLaunch = t;
      }
      for (const p of parts) {
        p.vy += 0.55 * k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        if (p.y + h > H) { p.y = H - h; p.vy = -p.vy * 0.74; }
        g.drawImage(p.img, p.x, p.y, w, h);
      }
      parts = parts.filter(p => p.x > -w && p.x < W);
      if (i >= order.length && !parts.length) finish();
      else raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- Som (sintetizado) ----------
  let ac = null;
  function actx() {
    if (!settings.sound) return null;
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function noise(dur, freq, q, gain) {
    const a = actx();
    if (!a) return;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }
  function tone(freq, dur, when = 0, type = 'triangle', gain = 0.12) {
    const a = actx();
    if (!a) return;
    const t0 = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  const sfx = {
    place: () => noise(0.08, 1500, 0.9, 1.1),
    flip: () => noise(0.06, 3200, 1.1, 0.7),
    deal: () => noise(0.05, 2400, 1, 0.45),
    nope: () => tone(160, 0.14, 0, 'sine', 0.12),
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, i * 0.11, 'triangle', 0.1)),
  };

  // ---------- Modais e opções ----------
  function openModal(sel) { closeModals(); $(sel).hidden = false; }
  function closeModals() { document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); }
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m && m.id !== 'modal-win') closeModals();
      if (e.target.closest('[data-close]')) closeModals();
    });
  });

  function askNewGame() {
    if (busy && !S.won) return;
    if (S.started && !S.won) openModal('#modal-new');
    else newGame();
  }

  function applyLook() {
    document.body.dataset.felt = settings.felt;
    document.body.dataset.back = settings.back;
    const sel = (box, v) => document.querySelectorAll(`${box} button`).forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
    sel('#opt-draw', settings.draw);
    sel('#opt-felt', settings.felt);
    sel('#opt-back', settings.back);
    sel('#opt-sound', settings.sound ? 1 : 0);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta.content = { green: '#0b3a26', blue: '#0b2f4f', wine: '#3e0a18', slate: '#1a1d28' }[settings.felt];
  }

  function renderStats() {
    const pct = stats.played ? Math.round(stats.won / stats.played * 100) : 0;
    $('#statsbox').innerHTML =
      `<div><b>${stats.played}</b><span>Jogos</span></div>` +
      `<div><b>${stats.won}</b><span>Vitórias</span></div>` +
      `<div><b>${pct}%</b><span>Aproveit.</span></div>` +
      `<div><b>${stats.streak}</b><span>Sequência</span></div>` +
      `<div><b>${stats.bestTime ? fmtTime(stats.bestTime) : '—'}</b><span>Melhor tempo</span></div>` +
      `<div><b>${stats.bestScore || '—'}</b><span>Recorde</span></div>`;
  }

  $('#opt-draw').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = +b.dataset.v;
    if (v === settings.draw) return;
    settings.draw = v;
    saveSettings();
    applyLook();
    toast(v === 1 ? 'Virar 1 — vale no próximo jogo' : 'Virar 3 — vale no próximo jogo');
    if (!S.started) { S.draw = v; S.fan = 0; render(); save(); }
  });
  $('#opt-felt').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) { settings.felt = b.dataset.v; saveSettings(); applyLook(); }
  });
  $('#opt-back').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) { settings.back = b.dataset.v; saveSettings(); applyLook(); }
  });
  $('#opt-sound').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.sound = b.dataset.v === '1';
    saveSettings();
    applyLook();
    sfx.flip();
  });
  $('#btn-reset-stats').addEventListener('click', () => {
    Object.assign(stats, { played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: 0, bestScore: 0 });
    saveStats();
    renderStats();
  });

  $('#btn-new').addEventListener('click', askNewGame);
  $('#confirm-new').addEventListener('click', newGame);
  $('#win-new').addEventListener('click', newGame);
  btn.undo.addEventListener('click', undo);
  btn.hint.addEventListener('click', hint);
  btn.auto.addEventListener('click', autoFinish);
  $('#btn-menu').addEventListener('click', () => { renderStats(); openModal('#modal-menu'); });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'd') { e.preventDefault(); if (!busy && !S.won) drawStock(); }
    else if (k === 'h') hint();
    else if (k === 'n') askNewGame();
    else if (k === 'u') undo();
    else if (k === 'escape') closeModals();
  });

  // ---------- Relógio ----------
  setInterval(() => {
    if (!S || !S.started || S.won || document.hidden) return;
    S.time++;
    hud.time.textContent = fmtTime(S.time);
    if (S.time % 5 === 0) save();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S) store.set('tp_game', { S, history: history.slice(-80) }); });

  // ---------- Redimensionar ----------
  let rzTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      if (!S) return;
      measure();
      board.classList.add('notrans');
      render({ instant: true });
      void board.offsetWidth;
      board.classList.remove('notrans');
    }, 60);
  }).observe(board);

  // ---------- Início ----------
  applyLook();
  const saved = store.get('tp_game', null);
  if (saved && saved.S && !saved.S.won && Array.isArray(saved.S.tab)) {
    S = saved.S;
    history = saved.history || [];
    measure();
    board.classList.add('notrans');
    render({ instant: true });
    void board.offsetWidth;
    board.classList.remove('notrans');
  } else {
    S = freshState();
    deal();
    save();
  }

  // Redesenha quando as fontes carregarem (métricas de texto mudam).
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!busy) render({ instant: true }); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
