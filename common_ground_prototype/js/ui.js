// Common Ground - HTML interface (top bar, side panel, pop-ups)
// The map is drawn by Phaser (scene.js); everything else is plain HTML.

const UI = (() => {
  const D = DATA;
  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const pct = v => Math.round(v * 100) + '%';
  const money = v => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('en-US')} k€`;
  const state = () => GAME.state;

  let buildMode = null;
  let selected = null;

  // ------------------------------------------------------------ setup
  function init() {
    // speed buttons
    const sp = $('#speed');
    D.SPEEDS.forEach((v, i) => {
      const b = el('button', 'speed-btn', v === 0 ? '❚❚' : v + '×');
      b.title = v === 0 ? 'Pause (Space)' : v === 16 ? 'Demo speed' : `Speed ${v}× (key ${i})`;
      b.onclick = () => GAME.setSpeed(v);
      b.dataset.speed = v;
      sp.appendChild(b);
    });

    // build menu
    const bm = $('#build');
    for (const [key, def] of Object.entries(D.BUILDINGS)) {
      if (!def.menu) continue;
      const b = el('button', 'build-btn', `<span class="bname">${def.name}</span><span class="bcost">${def.cost} k€</span>`);
      b.dataset.type = key;
      b.title = def.desc;
      b.onclick = () => setBuildMode(buildMode === key ? null : key);
      bm.appendChild(b);
    }

    // taxes
    const tx = $('#taxes');
    for (const id of D.DISTRICT_ORDER) tx.appendChild(taxRow('res', id, `${D.DISTRICTS[id].name} <small>residents</small>`));
    for (const id of ['ironworks', 'market']) tx.appendChild(taxRow('bus', id, `${D.DISTRICTS[id].name} <small>business</small>`));
    const rc = el('label', 'policy', `<input type="checkbox" id="rentcap"> Rent cap in Millbrook <small>(stops residents being pushed out; landlords and businesses dislike it)</small>`);
    tx.appendChild(rc);
    $('#rentcap').onchange = e => { SIM.setRentCap(state(), e.target.checked); refreshAll(); };

    $('#btn-help').onclick = showHelp;
    $('#btn-csv').onclick = downloadCSV;
    $('#btn-restart').onclick = confirmRestart;

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); GAME.setSpeed(GAME.speed === 0 ? (GAME.lastSpeed || 1) : 0); }
      if (/^Digit[1-4]$/.test(e.code)) GAME.setSpeed(D.SPEEDS[+e.code.slice(5)]);
      if (e.code === 'Escape') { setBuildMode(null); }
      if (e.code === 'KeyN' && state().phase === 'playing') GAME.endMonth(); // debug: skip to next month
    });
    document.addEventListener('contextmenu', e => { if (buildMode) { e.preventDefault(); setBuildMode(null); } });
    update();
  }

  function taxRow(kind, id, label) {
    const row = el('div', 'tax-row');
    row.innerHTML = `<span class="tax-label">${label}</span>
      <input type="range" min="${D.MIN_TAX * 100}" max="${D.MAX_TAX * 100}" step="1" value="${state().taxes[kind][id] * 100}">
      <span class="tax-val"></span>`;
    const input = row.querySelector('input');
    input.oninput = () => { SIM.setTax(state(), kind, id, input.value / 100); refreshAll(); };
    row.dataset.kind = kind; row.dataset.id = id;
    return row;
  }

  function onSceneReady() {
    update();
    showChallenges();
  }

  // ------------------------------------------------------------ build mode
  function setBuildMode(type) {
    buildMode = type;
    document.querySelectorAll('.build-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    const hint = $('#build-hint');
    if (type) {
      const def = D.BUILDINGS[type];
      hint.innerHTML = `<b>${def.name}</b>: ${def.desc}<br><small>Build time ${def.months} month${def.months > 1 ? 's' : ''}, upkeep ${def.upkeep} k€/month. Click a green plot. Esc or right-click to cancel.</small>`;
      hint.hidden = false;
    } else hint.hidden = true;
    if (GAME.scene) GAME.scene.showValid(type);
  }

  function tryBuild(t) {
    const s = state();
    const res = SIM.place(s, buildMode, t.c, t.r);
    GAME.scene.flashTile(t, res.ok);
    if (!res.ok) { toast(res.reason, 'bad'); return; }
    refreshAll();
    if (s.money - (D.BUILDINGS[buildMode].cost || 0) < D.DEBT_LIMIT || D.BUILDINGS[buildMode].special) setBuildMode(null);
    else GAME.scene.showValid(buildMode);
  }

  function refreshAll() {
    if (GAME.scene) GAME.scene.refresh();
    update();
    if (selected) selectTile(selected);
  }

  // ------------------------------------------------------------ tile info
  function describe(t) {
    const s = state();
    const dn = t.district ? D.DISTRICTS[t.district].name : '';
    const kinds = { road: 'Road', river: 'River', bridge: 'Old bridge', bridgeSite: 'River crossing: the second bridge can be built here', bridgeBuilding: 'Second bridge: under construction' };
    if (t.kind !== 'land') return { title: kinds[t.kind] || t.kind, sub: dn, lines: [] };
    const b = t.building;
    if (!b || b.type === 'tree') return { title: b ? 'Trees' : 'Empty plot', sub: dn, lines: ['Choose a building in the Build menu, then click here.'] };
    const def = D.BUILDINGS[b.type];
    const lines = [];
    if (b.buildLeft > 0) lines.push(`Under construction: ${b.buildLeft} month${b.buildLeft > 1 ? 's' : ''} left`);
    if (b.type === 'shop' && b.buildLeft === 0) {
      lines.push({ open: 'Open: business is good', sale: 'Struggling: "SALE" signs, few customers', closed: 'Closed: "FOR RENT". No jobs, no tax' }[b.state]);
      lines.push(`Shop health ${Math.round(b.health)} / 100`);
    }
    if (b.type === 'factory') lines.push(b.filtered === true ? 'Has smoke filters (60% less smoke)' : typeof b.filtered === 'number' ? 'Filters being installed' : 'No filters: smoke drifts east over Millbrook');
    if (b.type === 'coal') lines.push(`Runs at ${pct(s.coalShare)} (solar fields replace the rest)`);
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
    tip.style.left = Math.min(p.x + 16, rect.width - 230) + 'px';
    tip.style.top = Math.min(p.y + 16, rect.height - 90) + 'px';
  }

  function selectTile(t) {
    selected = t;
    if (!t || !t.district) return;
    const card = document.querySelector(`.dcard[data-id="${t.district}"]`);
    if (card) { card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 600); card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  // ------------------------------------------------------------ panels
  function update() {
    const s = state();
    if (!s) return;
    $('#date').textContent = `${D.MONTHS[s.month]} ${s.year}`;
    const net = s.income - s.upkeep;
    $('#money').innerHTML = `${money(s.money)} <small class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${Math.abs(Math.round(net))}/mo</small>`;
    $('#money').title = `Tax income ${money(s.income)} per month, upkeep ${money(s.upkeep)} per month. Debt limit ${money(D.DEBT_LIMIT)}.`;
    $('#money').classList.toggle('debt', s.money < 0);
    const gap = s.inequality;
    $('#ineq-val').textContent = gap.toFixed(0);
    $('#ineq-bar').style.width = Math.min(100, gap * 2.5) + '%';
    $('#ineq-bar').className = gap > 25 ? 'bad' : gap > 15 ? 'mid' : 'good';
    $('#ineq').title = `Gap in quality of life between the best-off and worst-off district (started at ${s.inequalityStart.toFixed(0)}). Lower is fairer.`;
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', +b.dataset.speed === GAME.speed));

    // district cards
    const totalTax = Object.values(s.districts).reduce((a, d) => a + d.taxPaid, 0);
    const totalRes = Object.values(s.districts).reduce((a, d) => a + d.residents, 0);
    const box = $('#districts');
    box.innerHTML = '';
    for (const id of D.DISTRICT_ORDER) {
      const d = s.districts[id], def = D.DISTRICTS[id];
      const a = d.approval, cls = a < 35 ? 'bad' : a < 50 ? 'mid' : 'good';
      const trend = d.target > a + 1 ? '▲' : d.target < a - 1 ? '▼' : '';
      const stat = (name, v, invert) => {
        const c = invert ? (v > 40 ? 'bad' : v > 25 ? 'mid' : 'good') : (v < 50 ? 'bad' : v < 70 ? 'mid' : 'good');
        return `<div class="stat ${c}"><span>${name}</span><b>${Math.round(v)}</b></div>`;
      };
      const card = el('div', 'dcard');
      card.dataset.id = id;
      card.style.setProperty('--dc', '#' + def.color.toString(16).padStart(6, '0'));
      card.innerHTML = `
        <div class="dhead"><div><b>${def.name}</b><small>${def.type}</small></div>
          <div class="share" title="Share of residents (votes) and of tax income">${pct(d.residents / totalRes)} of voters<br>${pct(d.taxPaid / totalTax)} of taxes</div></div>
        <div class="faction">${def.faction} <span class="trend ${trend === '▲' ? 'pos' : 'neg'}">${trend}</span></div>
        <div class="approval"><div class="abar ${cls}" style="width:${a}%"></div><span>${Math.round(a)}% approve</span></div>
        <div class="stats">${stat('Smog', d.pollution, true)}${stat('Health', d.health)}${stat('Jobs', d.employment * 100)}${stat('Rent ok', d.housing)}${stat('Life', d.qol)}</div>`;
      card.onclick = () => GAME.scene && GAME.scene.focusTile(...({ elmwood: [4, 3], market: [13, 4], ironworks: [4, 15], millbrook: [14, 15] })[id]);
      box.appendChild(card);
    }

    // taxes
    document.querySelectorAll('.tax-row').forEach(row => {
      const v = s.taxes[row.dataset.kind][row.dataset.id];
      row.querySelector('input').value = Math.round(v * 100);
      row.querySelector('.tax-val').textContent = Math.round(v * 100) + '%';
    });
    $('#rentcap').checked = s.policies.rentCap;

    // build buttons affordable?
    document.querySelectorAll('.build-btn').forEach(b => {
      const def = D.BUILDINGS[b.dataset.type];
      b.classList.toggle('poor', s.money - def.cost < D.DEBT_LIMIT);
    });

    // goals
    const g = $('#goals');
    g.innerHTML = '';
    if (!s.chosen.length) g.innerHTML = '<p class="muted">Goals are chosen in January.</p>';
    for (const ch of s.chosen) {
      const def = D.CHALLENGES.find(c => c.id === ch.id);
      const p = SIM.challengeProgress(s, ch.id);
      const icon = ch.status === 'kept' ? '✅' : ch.status === 'broken' ? '❌' : p.done ? '🟢' : '⏳';
      g.appendChild(el('div', 'goal', `<span class="gi">${icon}</span><div><b>${def.title}</b><small>${p.text}</small></div>`));
    }

    // news
    const n = $('#news');
    n.innerHTML = s.news.slice(0, 14).map(x => `<li class="${x.kind}"><small>${x.when}</small> ${x.text}</li>`).join('');
  }

  function setMonthProgress(f) { $('#month-bar').style.width = Math.min(100, f * 100) + '%'; }

  function toast(text, kind = 'info') {
    const t = el('div', 'toast ' + kind, text);
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  // ------------------------------------------------------------ pop-ups
  function modal(html, cls = '') {
    const m = $('#modal');
    m.innerHTML = `<div class="mbox ${cls}">${html}</div>`;
    m.hidden = false;
    return m.querySelector('.mbox');
  }
  function closeModal() { $('#modal').hidden = true; }

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
    const box = modal(`
      <h2>Welcome to Northhaven, Mayor</h2>
      <p>The river splits the city in two. The <b>north bank</b> (Elmwood Heights, Market Quarter) pays most of the taxes.
      The <b>south bank</b> (Millbrook, Ironworks) has most of the voters, the factories and the smoke.</p>
      <p>Choose <b>${D.CHALLENGES_TO_PICK} goals</b> for this year. Each faction reacts to your promises now, and judges you on them in December.</p>
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
      closeModal();
      refreshAll();
      GAME.setSpeed(1);
      toast('The year has begun. Build, set taxes, and watch the districts.', 'good');
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

  function showResult(res) {
    const s = state();
    GAME.setSpeed(0);
    refreshAll();
    if (res.type === 'bankrupt') {
      modal(`<h2>Game over: bankrupt</h2><p>The city stayed over the debt limit for ${D.BANKRUPT_MONTHS} months. The national government has appointed an administrator.</p>
        <div class="mfoot"><button class="primary" data-restart>Play again</button></div>`);
      return;
    }
    const rows = res.rows.map(r => `<tr><td>${r.name}</td><td>${Math.round(r.approval)}%</td><td>${r.voters.toLocaleString('en-US')}</td>
      <td><div class="vbar"><div style="width:${r.support * 100}%"></div></div>${pct(r.support)}</td></tr>`).join('');
    const promises = res.outcomes.map(o => `<li>${o.kept ? '✅ Kept' : '❌ Broken'}: ${o.title}</li>`).join('');
    const grades = res.card.items.map(i => `<tr><td>${i.name}</td><td>${i.value}</td><td class="grade g${i.g}">${i.g}</td></tr>`).join('');
    const won = res.type === 'won';
    const ending = won ? (res.card.ending === 'Common Ground'
      ? '<p class="ending good"><b>Ending: "Common Ground"</b>. You stayed in office and the gap between districts shrank.</p>'
      : '<p class="ending mid"><b>Ending: "Divided City"</b>. You stayed in office, but the gap between districts did not shrink.</p>')
      : '<p class="ending bad"><b>Voted out.</b> Too many residents felt left behind or let down.</p>';
    modal(`<h2>Election night: ${won ? 'Re-elected!' : 'Voted out'}</h2>
      <p class="bigshare ${won ? 'pos' : 'neg'}">You won ${(res.share * 100).toFixed(1)}% of the vote against ${D.RIVAL.name}.</p>
      <table class="vtable"><tr><th>District</th><th>Approval</th><th>Voters</th><th>Voted for you</th></tr>${rows}</table>
      <h3>Your promises</h3><ul class="plist">${promises}</ul>
      <h3>City report card</h3><table class="gtable">${grades}</table>
      ${ending}
      <p class="muted">Prototype: the full game continues with a new year here.</p>
      <div class="mfoot"><button id="res-csv">Download play data (CSV)</button><button class="primary" data-restart>Play again</button></div>`, 'wide');
    $('#res-csv').onclick = downloadCSV;
  }

  function confirmRestart() {
    const prev = GAME.speed; GAME.setSpeed(0);
    const box = modal(`<h2>Start a new game?</h2><p>Your current city will be lost.</p>
      <div class="mfoot"><button id="rs-no">Keep playing</button><button class="primary" data-restart>Start a new game</button></div>`);
    box.querySelector('#rs-no').onclick = () => { closeModal(); GAME.setSpeed(prev); };
  }

  // Any button with data-restart starts a new game.
  document.addEventListener('click', e => {
    if (e.target.closest('[data-restart]')) { closeModal(); GAME.restart(); }
  });

  function reset() {
    buildMode = null; selected = null;
    document.querySelectorAll('.build-btn').forEach(b => b.classList.remove('active'));
    $('#build-hint').hidden = true;
    setMonthProgress(0);
  }

  function showHelp() {
    const prev = GAME.speed; GAME.setSpeed(0);
    const box = modal(`<h2>How to play</h2>
      <ul class="help">
        <li><b>Goal:</b> win the December election while making Northhaven fairer and healthier.</li>
        <li><b>Money vs votes:</b> the north bank pays most taxes; Millbrook has half of the voters.</li>
        <li><b>Build</b> from the side panel, then click a green plot. Buildings take months to finish.</li>
        <li><b>Taxes</b> per district: more money now, less approval.</li>
        <li><b>Watch the map:</b> smog over Millbrook, SALE / FOR RENT signs on shops, protest signs, moving trucks.</li>
        <li><b>Controls:</b> drag to move, mouse wheel to zoom, Space to pause, 1 to 4 for speed, Esc to cancel building, N to skip to the next month (demo).</li>
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
    init, reset, onSceneReady, update, refreshAll, hoverTile, selectTile, tryBuild, setMonthProgress,
    showEvent, showResult, showChallenges, toast,
    get buildMode() { return buildMode; },
  };
})();
