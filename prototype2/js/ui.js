const UI = (() => {
  const D = DATA;
  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const pct = v => Math.round(v * 100) + '%';
  const num = v => Math.round(v).toLocaleString('en-US');
  const money = v => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('en-US')} k€`;
  const state = () => GAME.state;

  let buildMode = null;     // a building key, 'land' or 'bus'
  let firstStop = null;     // first stop of a bus line being placed
  let panel = null;         // open fold-out: build | policies | news | menu
  let buildTab = D.CATEGORIES[0];
  let newsSeen = 0;

  // Setup
  function init() {
    const sp = $('#speed');
    D.SPEEDS.forEach((v, i) => {
      const b = el('button', 'speed-btn', v === 0 ? '❚❚' : v + '×');
      b.title = v === 0 ? 'Pause (Space)' : v === 16 ? 'Demo speed' : `Speed ${v}× (key ${i})`;
      b.onclick = () => GAME.setSpeed(v);
      b.dataset.speed = v;
      sp.appendChild(b);
    });
    document.querySelectorAll('.dock-btn').forEach(b => b.onclick = () => {
      if (b.dataset.panel) openPanel(panel === b.dataset.panel ? null : b.dataset.panel);
      if (b.dataset.tool) { openPanel(null); setBuildMode(buildMode === b.dataset.tool ? null : b.dataset.tool); }
    });
    $('#fly-close').onclick = () => openPanel(null);
    $('#goals-head').onclick = () => $('#goalsbox').classList.toggle('collapsed');

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || !$('#modal').hidden) return;
      if (e.code === 'Space') { e.preventDefault(); GAME.setSpeed(GAME.speed === 0 ? (GAME.lastSpeed || 1) : 0); }
      if (/^Digit[1-4]$/.test(e.code)) GAME.setSpeed(D.SPEEDS[+e.code.slice(5)]);
      if (e.code === 'Escape') { if (buildMode) setBuildMode(null); else openPanel(null); }
      if (e.code === 'KeyB') openPanel(panel === 'build' ? null : 'build');
      if (e.code === 'KeyP') openPanel(panel === 'policies' ? null : 'policies');
      if (e.code === 'KeyL') { openPanel(null); setBuildMode(buildMode === 'land' ? null : 'land'); }
      if (e.code === 'KeyN' && state().phase === 'playing') GAME.endMonth();
    });
    document.addEventListener('contextmenu', e => { if (buildMode) { e.preventDefault(); setBuildMode(null); } });
    document.addEventListener('click', e => { if (e.target.closest('[data-restart]')) { closeModal(); GAME.restart(null); } });
    if (window.innerWidth < 820) $('#goalsbox').classList.add('collapsed');
  }

  function reset() {
    buildMode = null; firstStop = null; panel = null; newsSeen = 0;
    $('#flyout').hidden = true; $('#toolhint').hidden = true;
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
    setMonthProgress(0);
  }

  function onSceneReady() {
    update();
    if (!GAME.modeChosen) showModeSelect(); else showChallenges();
  }

  // Fold-out panels
  function openPanel(name) {
    panel = name;
    document.querySelectorAll('.dock-btn[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
    $('#flyout').hidden = !name;
    if (!name) return;
    if (name === 'news') newsSeen = state().news.length;
    renderPanel();
  }

  function renderPanel() {
    if (!panel) return;
    const s = state(), body = $('#fly-body');
    const titles = { build: 'Build', policies: 'Taxes & policies', news: 'City news', menu: 'Menu' };
    $('#fly-title').textContent = titles[panel];
    body.innerHTML = '';
    if (panel === 'build') {
      const tabs = el('div', 'tabs');
      for (const cat of D.CATEGORIES) {
        const t = el('button', 'tab' + (cat === buildTab ? ' active' : ''), cat);
        t.onclick = () => { buildTab = cat; renderPanel(); };
        tabs.appendChild(t);
      }
      body.appendChild(tabs);
      const grid = el('div', 'build-grid');
      for (const [key, def] of Object.entries(D.BUILDINGS)) {
        if (def.cat !== buildTab) continue;
        const b = el('button', 'build-btn' + (buildMode === key ? ' active' : '') + (s.money - def.cost < D.DEBT_LIMIT ? ' poor' : ''),
          `<span class="bname">${def.name}</span><span class="bcost">${def.cost} k€</span><span class="bmeta">${def.months} months, upkeep ${def.upkeep}</span>${bestIn(key)}`);
        b.title = def.desc;
        b.onclick = () => { setBuildMode(key); openPanel(null); };
        grid.appendChild(b);
      }
      body.appendChild(grid);
      body.appendChild(el('p', 'cat-note', 'Pick a building, then click a green plot on the map. Hover a button to see what it does.'));
    } else if (panel === 'policies') {
      body.appendChild(el('div', 'sub-h', 'Residential tax'));
      for (const id of D.DISTRICT_ORDER) body.appendChild(taxRow('res', id, D.DISTRICTS[id].name));
      body.appendChild(el('div', 'sub-h', 'Business tax'));
      for (const id of ['ironworks', 'market']) body.appendChild(taxRow('bus', id, D.DISTRICTS[id].name));
      const rc = el('label', 'policy', `<input type="checkbox" id="rentcap" ${s.policies.rentCap ? 'checked' : ''}> Rent cap in Millbrook <small>(stops residents being pushed out; landlords and businesses dislike it)</small>`);
      body.appendChild(rc);
      rc.querySelector('input').onchange = e => { SIM.setRentCap(s, e.target.checked); refreshAll(); };
      body.appendChild(el('p', 'cat-note', 'Higher taxes bring money now and cost approval in that district.'));
    } else if (panel === 'news') {
      const ul = el('ul'); ul.id = 'news-list';
      ul.innerHTML = s.news.map(x => `<li class="${x.kind}"><small>${x.when}</small> ${x.text}</li>`).join('');
      body.appendChild(ul);
    } else if (panel === 'menu') {
      const m = el('div', 'menu-list');
      const add = (label, fn) => { const b = el('button', '', label); b.onclick = fn; m.appendChild(b); };
      add('How to play', showHelp);
      add('Download play data (CSV)', downloadCSV);
      add('New game', confirmRestart);
      body.appendChild(m);
      body.appendChild(el('div', 'sub-h', 'Keyboard'));
      body.appendChild(el('ul', 'keys', [['B', 'Build'], ['L', 'Buy land'], ['P', 'Policies'], ['Space', 'Pause'], ['1–4', 'Speed'], ['Esc', 'Cancel'], ['N', 'Next month (demo)']]
        .map(([k, v]) => `<li><kbd>${k}</kbd>${v}</li>`).join('')));
    }
  }

  // "Most valued in Ironworks" line for services, from the approval table.
  function bestIn(key) {
    const t = D.AMENITY_BONUS[key];
    if (!t) return '';
    const best = D.DISTRICT_ORDER.reduce((a, id) => (t[id] > t[a] ? id : a), D.DISTRICT_ORDER[0]);
    return `<span class="bbest">Most valued in ${D.DISTRICTS[best].name}</span>`;
  }

  function taxRow(kind, id, label) {
    const s = state();
    const v = Math.round(s.taxes[kind][id] * 100);
    const row = el('div', 'tax-row', `<span class="tax-label">${label}</span>
      <input type="range" id="tax-${kind}-${id}" min="${D.MIN_TAX * 100}" max="${D.MAX_TAX * 100}" step="1" value="${v}"><span class="tax-val">${v}%</span>`);
    const input = row.querySelector('input');
    input.oninput = () => { SIM.setTax(s, kind, id, input.value / 100); row.querySelector('.tax-val').textContent = input.value + '%'; refreshAll(true); };
    return row;
  }

  // Tools
  function setBuildMode(mode) {
    buildMode = mode; firstStop = null;
    document.querySelectorAll('.dock-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === mode));
    updateHint();
    if (GAME.scene) GAME.scene.showValid(mode);
  }
  function updateHint() {
    const hint = $('#toolhint');
    if (!buildMode) { hint.hidden = true; return; }
    let parts;
    if (buildMode === 'land') parts = ['<b>Buy land</b>', `Next tile ${money(SIM.landPrice(state()))}`, 'Click a yellow tile next to the city.'];
    else if (buildMode === 'bus') parts = firstStop
      ? ['<b>Bus line</b>', 'Second stop', `Click a blue plot at least ${D.BUS_STOP_GAP} tiles from other stops.`]
      : ['<b>Bus line</b>', `${D.BUILDINGS.bus.cost} k€ for two stops`, 'Click a blue plot next to a road for the first stop.'];
    else {
      const def = D.BUILDINGS[buildMode];
      parts = [`<b>${def.name}</b>`, `${def.cost} k€, ${def.months} months`, def.desc];
      if (D.AMENITY_BONUS[buildMode]) parts.push(`<span class="appr">Approval: ${D.DISTRICT_ORDER.map(id => `${D.DISTRICTS[id].short} <b class="${D.AMENITY_BONUS[buildMode][id] >= 4 ? 'pos' : ''}">+${D.AMENITY_BONUS[buildMode][id]}</b>`).join(', ')}</span>`);
    }
    hint.innerHTML = `<div class="hint-parts">${parts.map(x => `<span>${x}</span>`).join('')}</div><button id="hint-cancel">Cancel</button>`;
    hint.querySelector('#hint-cancel').onclick = () => setBuildMode(null);
    hint.hidden = false;
  }
  function canUseTool(t) {
    const s = state();
    if (buildMode === 'land') return SIM.canBuyLand(s, t.c, t.r).ok;
    if (buildMode === 'bus') return SIM.canPlaceStop(s, t.c, t.r, firstStop).ok;
    return SIM.canPlace(s, buildMode, t.c, t.r).ok;
  }
  function useTool(t) {
    const s = state();
    let res;
    if (buildMode === 'land') {
      res = SIM.buyLand(s, t.c, t.r);
    } else if (buildMode === 'bus') {
      if (!firstStop) {
        res = SIM.canPlaceStop(s, t.c, t.r);
        if (res.ok) { firstStop = { c: t.c, r: t.r }; GAME.scene.flashTile(t, true); updateHint(); GAME.scene.showValid('bus'); return; }
      } else {
        res = SIM.placeBusLine(s, firstStop, { c: t.c, r: t.r });
        if (res.ok) { toast(res.cross ? 'Bus line across the river: opens next month.' : 'Bus line: opens next month.', 'good'); setBuildMode(null); }
      }
    } else {
      res = SIM.place(s, buildMode, t.c, t.r);
      if (res.ok && (D.BUILDINGS[buildMode].special || D.BUILDINGS[buildMode].unique)) setBuildMode(null);
    }
    GAME.scene.flashTile(t, res.ok);
    if (!res.ok) { toast(res.reason, 'bad'); return; }
    refreshAll();
    updateHint();
  }

  function refreshAll(keepPanel) {
    if (GAME.scene) GAME.scene.refresh();
    update(keepPanel);
  }

  // Tile info
  function describe(t) {
    const s = state();
    const dn = t.district ? D.DISTRICTS[t.district].name : '';
    if (!t.owned && t.kind !== 'river') {
      const can = SIM.canBuyLand(s, t.c, t.r);
      return { title: 'Land outside the city', sub: `Would join ${dn}`, lines: [can.ok || /money/.test(can.reason) ? `For sale: ${money(SIM.landPrice(s))}` : 'Not next to the city yet'] };
    }
    const kinds = { road: 'Road', river: s.riverClean ? 'River (clean)' : 'River (polluted by industry)', bridge: 'Bridge', bridgeSite: 'River crossing: the second bridge can be built here', bridgeBuilding: 'Second bridge: under construction' };
    if (t.kind !== 'land') return { title: kinds[t.kind] || t.kind, sub: dn, lines: [] };
    const b = t.building;
    if (!b || b.type === 'tree') return { title: b ? 'Trees' : 'Empty plot', sub: dn, lines: ['Open Build, choose a building, then click here.'] };
    const def = D.BUILDINGS[b.type];
    const lines = [];
    if (b.buildLeft > 0) lines.push(`Under construction: ${b.buildLeft} month${b.buildLeft > 1 ? 's' : ''} left`);
    if (b.type === 'busstop') { const l = s.lines.find(x => x.id === b.line); if (l) lines.push(l.cross ? 'Line across the river' : 'Line on one bank'); }
    if (b.type === 'shop' && b.buildLeft === 0) {
      lines.push({ open: 'Open: business is good', sale: 'Struggling: "SALE" signs, few customers', closed: 'Closed: "FOR RENT". No jobs, no tax' }[b.state]);
      lines.push(`Shop health ${Math.round(b.health)} / 100`);
    }
    if (b.type === 'factory') lines.push(b.filtered === true ? 'Has smoke filters (60% less smoke)' : typeof b.filtered === 'number' ? 'Filters being installed' : 'No filters: smoke drifts east over Millbrook');
    if (b.type === 'coal') lines.push(`Runs at ${pct(s.coalShare)} (solar and wind replace the rest)`);
    if (b.type === 'school' && b.buildLeft === 0) lines.push(`Raising incomes: ${Math.min(8, b.age)} / 8 months`);
    if (D.AMENITY_BONUS[b.type] && b.buildLeft === 0) lines.push(`+${D.AMENITY_BONUS[b.type][t.district]} approval from the ${D.DISTRICTS[t.district].faction}`);
    if (def.homes && b.buildLeft === 0) lines.push(`Homes for ${def.homes} people`);
    if (def.jobs) lines.push(`${def.jobs} jobs`);
    return { title: def.name, sub: dn, lines };
  }
  function hoverTile(t, p) {
    const tip = $('#tooltip');
    if (!t) { tip.hidden = true; return; }
    const d = describe(t);
    tip.innerHTML = `<b>${d.title}</b>${d.sub ? `<div class="sub">${d.sub}</div>` : ''}${d.lines.map(l => `<div>${l}</div>`).join('')}`;
    tip.hidden = false;
    const rect = $('#game').getBoundingClientRect();
    tip.style.left = Math.min(p.x + 16, rect.width - 240) + 'px';
    tip.style.top = Math.min(p.y + 16, rect.height - 230) + 'px';
  }
  function selectTile(t) {
    if (!t || !t.district) return;
    const chip = document.querySelector(`.dchip[data-id="${t.district}"]`);
    if (chip) { chip.classList.add('flash'); setTimeout(() => chip.classList.remove('flash'), 600); }
  }

  // Always-visible HUD
  function update(keepPanel) {
    const s = state();
    if (!s) return;
    const mode = D.MODES[s.mode];
    $('#date').textContent = `${D.MONTHS[s.month]} ${s.year}`;
    $('#year-info').textContent = s.mode === 'challenge' ? `Year ${s.yearIndex} of ${mode.years}, Challenge mode` : `Year ${s.yearIndex}, Endless mode`;
    const net = s.income - s.upkeep;
    $('#money').innerHTML = `${money(s.money)} <small class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${Math.abs(Math.round(net))}/mo</small>`;
    $('#money').title = `Tax income ${money(s.income)} per month, upkeep ${money(s.upkeep)} per month. Debt limit ${money(D.DEBT_LIMIT)}.`;
    $('#money').classList.toggle('debt', s.money < 0);
    $('#pop').textContent = num(SIM.totalResidents(s));
    const gap = s.inequality;
    $('#ineq-val').textContent = gap.toFixed(0);
    $('#ineq-bar').style.width = Math.min(100, gap * 2.5) + '%';
    $('#ineq-bar').className = gap > 25 ? 'bad' : gap > 15 ? 'mid' : 'good';
    $('#ineq').title = `Gap in quality of life between the best-off and worst-off district (started at ${s.inequalityStart.toFixed(0)}). Lower is fairer.`;
    $('#clean-val').textContent = pct(1 - s.coalShare);
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', +b.dataset.speed === GAME.speed));

    // district strip
    const totalTax = Object.values(s.districts).reduce((a, d) => a + d.taxPaid, 0);
    const totalRes = SIM.totalResidents(s);
    const bar = $('#districtbar');
    bar.innerHTML = '';
    const O = D.CORE_MIN - 4;
    const focus = { elmwood: [8 + O, 7 + O], market: [17 + O, 7 + O], ironworks: [8 + O, 18 + O], millbrook: [18 + O, 18 + O] };
    for (const id of D.DISTRICT_ORDER) {
      const d = s.districts[id], def = D.DISTRICTS[id];
      const a = d.approval, cls = a < 35 ? 'bad' : a < 50 ? 'mid' : 'good';
      const trend = d.target > a + 1 ? '▲' : d.target < a - 1 ? '▼' : '';
      const stat = (name, v, invert) => {
        const c = invert ? (v > 40 ? 'bad' : v > 25 ? 'mid' : 'good') : (v < 50 ? 'bad' : v < 70 ? 'mid' : 'good');
        return `<div class="stat ${c}"><span>${name}</span><b>${Math.round(v)}</b></div>`;
      };
      const chip = el('div', 'dchip');
      chip.dataset.id = id;
      chip.style.setProperty('--dc', '#' + def.color.toString(16).padStart(6, '0'));
      chip.title = `${def.faction}\n${num(d.residents)} people, homes for ${num(d.capacity)}\n${pct(d.residents / totalRes)} of voters, ${pct(d.taxPaid / totalTax)} of taxes`;
      chip.innerHTML = `
        <div class="dtop"><b>${def.name}</b><span class="dshare"><small>${pct(d.residents / totalRes)} votes</small><small>${pct(d.taxPaid / totalTax)} tax</small></span></div>
        <div class="approval"><div class="abar ${cls}" style="width:${a}%"></div><span>${def.short} ${Math.round(a)}%</span><em class="${trend === '▲' ? 'pos' : 'neg'}">${trend}</em></div>
        <div class="stats">${stat('Smog', d.pollution, true)}${stat('Health', d.health)}${stat('Jobs', d.employment * 100)}${stat('Rent', d.housing)}${stat('Life', d.qol)}</div>`;
      chip.onclick = () => GAME.scene && GAME.scene.focusTile(...focus[id]);
      bar.appendChild(chip);
    }

    // goals box
    $('#goals-title').textContent = `Goals ${s.year}`;
    const kept = s.chosen.filter(ch => ch.status === 'kept' || SIM.challengeProgress(s, ch.id).done).length;
    $('#goals-sum').textContent = s.chosen.length ? `${kept} / ${s.chosen.length} on track` : '';
    $('#rival').textContent = s.rival ? `Rival: ${s.rival.name}, promising ${s.rival.pitch}` : '';
    const g = $('#goals');
    g.innerHTML = s.chosen.length ? '' : '<p class="muted">Goals are chosen in January.</p>';
    for (const ch of s.chosen) {
      const def = D.CHALLENGES.find(c => c.id === ch.id);
      const p = SIM.challengeProgress(s, ch.id);
      const icon = ch.status === 'kept' ? '✅' : ch.status === 'broken' ? '❌' : p.done ? '🟢' : '⏳';
      g.appendChild(el('div', 'goal', `<span class="gi">${icon}</span><div><b>${def.title}</b><small>${p.text}</small></div>`));
    }

    // news badge
    const unread = Math.max(0, s.news.length - newsSeen);
    const badge = $('#news-badge');
    badge.hidden = !unread || panel === 'news';
    badge.textContent = unread > 9 ? '9+' : unread;
    if (panel === 'news') newsSeen = s.news.length;

    if (panel && !keepPanel) renderPanel();
  }
  function setMonthProgress(f) { $('#month-bar').style.width = Math.min(100, f * 100) + '%'; }
  function toast(text, kind = 'info') {
    const t = el('div', 'toast ' + kind, text);
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  // Pop-ups
  function modal(html, cls = '') {
    const m = $('#modal');
    m.innerHTML = `<div class="mbox ${cls}">${html}</div>`;
    m.hidden = false;
    return m.querySelector('.mbox');
  }
  function closeModal() { $('#modal').hidden = true; }

  function showModeSelect() {
    GAME.setSpeed(0);
    const box = modal(`
      <div class="title-art">Common Ground</div>
      <p class="lead">You are the new mayor of <b>Northhaven</b>, a river city split between a rich north bank and a poor, polluted south bank.
      Build, tax and govern so that the city works for everyone, and win the vote every December.</p>
      <div class="modes">
        <button class="mode-card" data-mode="challenge"><b>Challenge</b><span>5 years, 5 elections</span><small>${D.MODES.challenge.desc}</small></button>
        <button class="mode-card" data-mode="endless"><b>Endless</b><span>No year limit</span><small>${D.MODES.endless.desc}</small></button>
      </div>
      <p class="muted center">Game Development for Social Good, Prototype 2</p>`, 'wide title');
    box.querySelectorAll('.mode-card').forEach(b => b.onclick = () => { closeModal(); GAME.restart(b.dataset.mode); });
  }

  function reactionChips(reactions) {
    return D.DISTRICT_ORDER.map(id => {
      const v = reactions[id] || 0;
      const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
      return `<span class="chip ${cls}" title="${D.DISTRICTS[id].faction}">${D.DISTRICTS[id].short} ${v > 0 ? '+' + v : v === 0 ? '0' : '−' + Math.abs(v)}</span>`;
    }).join('');
  }
  function showChallenges() {
    const s = state();
    GAME.setSpeed(0);
    const picked = new Set();
    const cards = s.offered.map(id => {
      const c = D.CHALLENGES.find(x => x.id === id);
      return `<button class="ccard" data-id="${id}"><b>${c.title}</b><small>${c.desc}</small><div class="chips">${reactionChips(c.reactions)}</div></button>`;
    }).join('');
    const intro = s.yearIndex === 1
      ? `<p>The river splits the city in two. The <b>north bank</b> (Elmwood Heights, Market Quarter) pays most of the taxes.
         The <b>south bank</b> (Millbrook, Ironworks) has most of the voters, the factories and the smoke.</p>`
      : `<p>A new year in office. This year you run against <b>${s.rival.name}</b>, who promises ${s.rival.pitch}.</p>`;
    const box = modal(`
      <h2>${s.year}: choose your goals</h2>${intro}
      <p>Choose <b>${D.CHALLENGES_TO_PICK} goals</b>. Each faction reacts to your promises now, and judges you on them in December.</p>
      <div class="cgrid">${cards}</div>
      <div class="mfoot"><span id="pick-count">0 / ${D.CHALLENGES_TO_PICK} chosen</span><button id="pick-ok" class="primary" disabled>Start the year</button></div>`, 'wide');
    box.querySelectorAll('.ccard').forEach(b => b.onclick = () => {
      const id = b.dataset.id;
      if (picked.has(id)) picked.delete(id); else if (picked.size < D.CHALLENGES_TO_PICK) picked.add(id);
      box.querySelectorAll('.ccard').forEach(x => x.classList.toggle('picked', picked.has(x.dataset.id)));
      box.querySelector('#pick-count').textContent = `${picked.size} / ${D.CHALLENGES_TO_PICK} chosen`;
      box.querySelector('#pick-ok').disabled = picked.size !== D.CHALLENGES_TO_PICK;
    });
    box.querySelector('#pick-ok').onclick = () => {
      SIM.pickChallenges(s, [...picked]);
      closeModal(); refreshAll(); GAME.setSpeed(1);
      toast('The year has begun. Open Build to start shaping the city.', 'good');
    };
  }

  function showEvent(ev) {
    GAME.setSpeed(0);
    const box = modal(`<h2>${ev.title}</h2><p>${ev.text}</p>
      <div class="opts">${ev.options.map((o, i) => `<button class="primary" data-i="${i}">${o.label}</button>`).join('')}</div>`);
    box.querySelectorAll('.opts button').forEach(b => b.onclick = () => {
      SIM.resolveEvent(state(), ev.options[+b.dataset.i].effect);
      closeModal(); refreshAll(); GAME.setSpeed(GAME.lastSpeed || 1);
    });
  }

  function cardTable(card) {
    return `<table class="gtable">${card.items.map(i => `<tr><td>${i.name}</td><td>${i.value}</td><td class="grade g${i.g}">${i.g}</td></tr>`).join('')}</table>`;
  }
  function showResult(res) {
    const s = state();
    GAME.setSpeed(0);
    refreshAll();
    const years = s.yearsWon;
    if (res.type === 'bankrupt') {
      modal(`<h2>Game over: bankrupt</h2><p>The city stayed over the debt limit for ${D.BANKRUPT_MONTHS} months. The national government has appointed an administrator.</p>
        <h3>City report card</h3>${cardTable(res.card)}
        <div class="mfoot"><button id="res-csv">Download play data (CSV)</button><button class="primary" data-restart>Play again</button></div>`, 'wide');
      $('#res-csv').onclick = downloadCSV;
      return;
    }
    const rows = res.rows.map(r => `<tr><td>${r.name}</td><td>${Math.round(r.approval)}%</td><td>${r.voters.toLocaleString('en-US')}</td>
      <td><div class="vbar"><div style="width:${r.support * 100}%"></div></div>${pct(r.support)}</td></tr>`).join('');
    const promises = res.outcomes.map(o => `<li>${o.kept ? '✅ Kept' : '❌ Broken'}: ${o.title}</li>`).join('');
    const won = res.type === 'won';
    let headline, closing, buttons;
    if (won && res.final) {
      headline = 'Five years in office!';
      closing = res.card.ending === 'Common Ground'
        ? '<p class="ending good"><b>Ending: "Common Ground"</b>. You won all five elections and the gap between districts shrank.</p>'
        : '<p class="ending mid"><b>Ending: "Divided City"</b>. You won all five elections, but the gap between districts did not shrink.</p>';
      buttons = `<button id="res-csv">Download play data (CSV)</button><button class="primary" data-restart>Play again</button>`;
    } else if (won) {
      headline = 'Re-elected!';
      closing = `<p class="muted">${s.mode === 'challenge' ? `Year ${s.yearIndex} of ${D.MODES.challenge.years} done.` : `${years} year${years > 1 ? 's' : ''} in office so far.`}</p>`;
      buttons = `<button id="res-csv">Download play data (CSV)</button><button class="primary" id="next-year">Start ${s.year + 1}</button>`;
    } else {
      headline = 'Voted out';
      closing = `<p class="ending bad"><b>Game over.</b> ${years ? `You governed Northhaven for ${years} full year${years > 1 ? 's' : ''}.` : 'Too many residents felt left behind or let down.'}</p>`;
      buttons = `<button id="res-csv">Download play data (CSV)</button><button class="primary" data-restart>Play again</button>`;
    }
    modal(`<h2>Election night ${res.year}: ${headline}</h2>
      <p class="bigshare ${won ? 'pos' : 'neg'}">You won ${(res.share * 100).toFixed(1)}% of the vote against ${res.rival}.</p>
      <table class="vtable"><tr><th>District</th><th>Approval</th><th>Voters</th><th>Voted for you</th></tr>${rows}</table>
      <h3>Your promises</h3><ul class="plist">${promises}</ul>
      <h3>City report card</h3>${cardTable(res.card)}
      ${closing}
      <div class="mfoot">${buttons}</div>`, 'wide');
    $('#res-csv').onclick = downloadCSV;
    const next = $('#next-year');
    if (next) next.onclick = () => { closeModal(); SIM.startNextYear(s); refreshAll(); showChallenges(); };
  }

  function confirmRestart() {
    const prev = GAME.speed; GAME.setSpeed(0);
    const box = modal(`<h2>Start a new game?</h2><p>Your current city will be lost.</p>
      <div class="mfoot"><button id="rs-no">Keep playing</button><button class="primary" data-restart>Start a new game</button></div>`);
    box.querySelector('#rs-no').onclick = () => { closeModal(); GAME.setSpeed(prev); };
  }

  function showHelp() {
    const prev = GAME.speed; GAME.setSpeed(0);
    const box = modal(`<h2>How to play</h2>
      <ul class="help">
        <li><b>Goal:</b> win the vote every December while making Northhaven fairer, healthier and cleaner.</li>
        <li><b>Money vs votes:</b> the north bank pays most taxes; Millbrook has half of the voters.</li>
        <li><b>Build</b> (left dock): choose a category and a building, then click a green plot. Services such as parks, clinics, schools, police and fire stations raise approval in their district, but each district values them differently: a school matters to Millbrook, a fire station to Ironworks.</li>
        <li><b>Land:</b> buy tiles next to the city when you run out of plots. New land joins the district it borders.</li>
        <li><b>Bus lines</b> (Build › Transport) need two stops next to roads, at least ${D.BUS_STOP_GAP} tiles apart. A line across the river helps south-bank workers reach jobs.</li>
        <li><b>Policies:</b> taxes per district and the Millbrook rent cap.</li>
        <li><b>Watch the map and the district strip:</b> smog, SALE and FOR RENT signs, protest signs and moving trucks show problems.</li>
        <li><b>Controls:</b> drag to move, mouse wheel to zoom, Space to pause, 1 to 4 for speed, B build, L land, P policies, Esc cancel, N skip a month (demo).</li>
      </ul><div class="mfoot"><button class="primary" id="help-ok">Back to the city</button></div>`);
    box.querySelector('#help-ok').onclick = () => { closeModal(); GAME.setSpeed(prev); };
  }

  function downloadCSV() {
    const csv = SIM.historyCSV(state());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'common-ground-playdata.csv';
    a.click();
  }

  return {
    init, reset, onSceneReady, update, refreshAll, hoverTile, selectTile, setMonthProgress, toast,
    canUseTool, useTool, showEvent, showResult, showChallenges,
    get buildMode() { return buildMode; }, get firstStop() { return firstStop; },
  };
})();
