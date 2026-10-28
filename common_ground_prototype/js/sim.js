// Common Ground - city simulation
// Pure game logic: no drawing here. The Phaser scene (scene.js) draws the state, and the HTML interface (ui.js) shows panels and buttons.

const SIM = (() => {
  const D = DATA;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Small seeded random generator so the starting city is the same every game.
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- map
  function districtOf(c, r) {
    if (D.RIVER_ROWS.includes(r)) return null;
    const north = r < D.RIVER_ROWS[0];
    const west = c <= D.ROAD_COLS[0];
    if (north) return west ? 'elmwood' : 'market';
    return west ? 'ironworks' : 'millbrook';
  }

  function buildMap() {
    const N = D.MAP_SIZE, rand = rng(7);
    const tiles = [];
    // fixed industrial sites
    const factories = ['2,12', '6,13', '3,17', '7,18'];
    const coal = '1,14';
    for (let r = 0; r < N; r++) {
      const row = [];
      for (let c = 0; c < N; c++) {
        const t = { c, r, district: districtOf(c, r), kind: 'land', building: null };
        if (D.RIVER_ROWS.includes(r)) {
          t.kind = c === D.OLD_BRIDGE_COL ? 'bridge' : c === D.NEW_BRIDGE_COL ? 'bridgeSite' : 'river';
        } else if (D.ROAD_COLS.includes(c) || D.ROAD_ROWS.includes(r)) {
          t.kind = 'road';
        } else {
          const key = c + ',' + r, x = rand();
          let b = null;
          switch (t.district) {
            case 'elmwood': b = x < 0.62 ? 'villa' : x < 0.85 ? 'tree' : null; break;
            case 'market': b = x < 0.3 ? 'shop' : x < 0.44 ? 'office' : x < 0.56 ? 'flats' : x < 0.66 ? 'tree' : null; break;
            case 'ironworks':
              if (factories.includes(key)) b = 'factory';
              else if (key === coal) b = 'coal';
              else b = x < 0.38 ? 'warehouse' : x < 0.52 ? 'flats' : x < 0.62 ? 'tree' : null;
              break;
            case 'millbrook': b = x < 0.72 ? 'flats' : x < 0.8 ? 'shop' : x < 0.85 ? 'tree' : null; break;
          }
          if (b) t.building = makeBuilding(b, 0, rand);
        }
        row.push(t);
      }
      tiles.push(row);
    }
    return tiles;
  }

  function makeBuilding(type, buildLeft, rand) {
    const b = { type, buildLeft: buildLeft || 0 };
    if (type === 'shop') {
      b.health = 72;
      b.state = 'open';
      b.jitter = rand ? (rand() * 16 - 8) : 0; // shops do not all change at once
    }
    if (type === 'factory') b.filtered = false;
    return b;
  }

  function eachTile(state, fn) {
    for (const row of state.tiles) for (const t of row) fn(t);
  }

  function countBuildings(state, type, district, opts = {}) {
    let n = 0;
    eachTile(state, t => {
      const b = t.building;
      if (!b || b.type !== type) return;
      if (district && t.district !== district) return;
      if (!opts.includeUnfinished && b.buildLeft > 0) return;
      if (opts.filter && !opts.filter(b)) return;
      n++;
    });
    return n;
  }

  // ---------------------------------------------------------------- new game
  function newGame() {
    const s = {
      year: D.START_YEAR, month: 0, money: D.START_MONEY, lastNet: 0,
      tiles: buildMap(),
      taxes: {
        res: { millbrook: D.DEFAULT_RES_TAX, elmwood: D.DEFAULT_RES_TAX, ironworks: D.DEFAULT_RES_TAX, market: D.DEFAULT_RES_TAX },
        bus: { ironworks: D.DEFAULT_BUS_TAX, market: D.DEFAULT_BUS_TAX },
      },
      policies: { rentCap: false },
      bridge2: false,
      districts: {},
      mods: { millbrook: 0, elmwood: 0, ironworks: 0, market: 0 },
      spendYear: { millbrook: 0, elmwood: 0, ironworks: 0, market: 0 },
      parksBuiltYear: 0, socialBuiltYear: 0,
      healthPenalty: { millbrook: 0, elmwood: 0, ironworks: 0, market: 0 },
      offered: [], chosen: [],
      phase: 'challenges',      // challenges | playing | event | election | over
      pendingEvent: null, firedEvents: [],
      debtMonths: 0,
      news: [], history: [],
      visual: { movingOut: 0 },
      result: null,
    };
    for (const id of Object.keys(D.DISTRICTS)) {
      const dd = D.DISTRICTS[id];
      s.districts[id] = {
        residents: dd.residents, approval: 50, rentPressure: id === 'millbrook' ? 30 : 20,
        pollution: 0, air: 0, health: 0, employment: 0, housing: 0, green: 0, qol: 0, taxPaid: 0,
      };
    }
    compute(s, true);
    s.emissionsStart = s.emissions;
    s.inequalityStart = s.inequality;
    s.spendBase = s.spendPower;
    compute(s, true);
    for (let k = 0; k < 12; k++) { updateShops(s); compute(s); }
    s._closedThisMonth = 0; s._reopenedThisMonth = 0;
    // start approvals at their targets so the first month is stable
    for (const id of Object.keys(s.districts)) s.districts[id].approval = s.districts[id].target;
    s.offered = D.CHALLENGES.slice(0, D.CHALLENGES_OFFERED).map(c => c.id);
    addNews(s, 'Welcome, Mayor. Northhaven is divided: choose your goals for the year.');
    return s;
  }

  function addNews(s, text, kind = 'info') {
    s.news.unshift({ when: `${D.MONTHS[Math.min(s.month, 11)].slice(0, 3)} ${s.year}`, text, kind });
    if (s.news.length > 40) s.news.pop();
  }

  // ---------------------------------------------------------------- core model
  // Recomputes every derived value from the buildings, taxes and policies.
  function compute(s, initial = false) {
    const ds = s.districts;
    const solar = countBuildings(s, 'solar');
    const coalShare = clamp(1 - solar * D.SOLAR_SHARE, 0, 1);
    const busLines = Math.min(2, countBuildings(s, 'bus'));
    s.coalShare = coalShare;
    s.busLines = busLines;

    // --- emissions and pollution (wind blows east, from Ironworks over Millbrook)
    let E = 0;
    eachTile(s, t => {
      const b = t.building;
      if (!b || b.buildLeft > 0) return;
      if (b.type === 'factory') E += D.BUILDINGS.factory.emission * (b.filtered === true ? 1 - D.FILTER_CUT : 1);
      if (b.type === 'coal') E += D.BUILDINGS.coal.emission * coalShare;
    });
    s.emissions = E;
    for (const id in ds) {
      const parks = countBuildings(s, 'park', id);
      let p = E * D.POLLUTION_SPREAD[id] * D.POLLUTION_SCALE + D.TRAFFIC_POLLUTION[id];
      p -= busLines * D.BUS_TRAFFIC_CUT * (id === 'market' ? 1 : 0.5);
      p -= parks * D.PARK_AIR_BONUS;
      ds[id].pollution = clamp(p, 0, 100);
      ds[id].air = 100 - ds[id].pollution;
    }

    // --- jobs and access to jobs
    const shopFactor = b => (b.state === 'open' ? 1 : b.state === 'sale' ? 0.7 : 0);
    let northJobs = 0, southJobs = 0;
    eachTile(s, t => {
      const b = t.building;
      if (!b || b.buildLeft > 0) return;
      const def = D.BUILDINGS[b.type];
      if (!def.jobs) return;
      const j = def.jobs * (b.type === 'shop' ? shopFactor(b) : 1);
      if (t.district === 'elmwood' || t.district === 'market') northJobs += j; else southJobs += j;
    });
    const workers = id => ds[id].residents * D.WORKER_SHARE;
    const northWorkers = workers('elmwood') + workers('market');
    const southWorkers = workers('ironworks') + workers('millbrook');
    const access = clamp(D.SOUTH_ACCESS_BASE + D.BUS_ACCESS * busLines + (s.bridge2 ? D.BRIDGE_ACCESS : 0), 0, 1);
    s.access = access;
    const northFilled = Math.min(northWorkers, northJobs);
    const southAvail = southJobs + (northJobs - northFilled) * access;
    const empSouth = clamp(southAvail / southWorkers, 0, 0.97);
    const empNorth = clamp((northFilled + southJobs * 0.05) / northWorkers, 0, 0.97);
    ds.elmwood.employment = empNorth; ds.market.employment = empNorth;
    // Ironworks workers live next to the factories, so they get first pick of local jobs.
    ds.ironworks.employment = clamp(empSouth + 0.08, 0, 0.97);
    ds.millbrook.employment = clamp(empSouth - 0.03, 0, 0.97);
    s.jobs = { north: northJobs, south: southJobs };

    // --- health, housing, green space
    for (const id in ds) {
      const clinics = countBuildings(s, 'clinic', id);
      const services = clamp(D.BASE_SERVICES[id] + clinics * D.CLINIC_HEALTH, 0, 100);
      ds[id].services = services;
      ds[id].health = clamp(0.6 * ds[id].air + 0.4 * services - s.healthPenalty[id], 0, 100);
      const parks = countBuildings(s, 'park', id);
      ds[id].green = clamp(D.BASE_GREEN[id] + parks * D.PARK_GREEN, 0, 100);
      if (s.policies.rentCap) ds[id].rentPressure = Math.min(ds[id].rentPressure, D.RENT_CAP_MAX);
      ds[id].housing = clamp(100 - ds[id].rentPressure, 0, 100);
    }

    // --- spending power of residents (customers for shops)
    let spend = 0;
    for (const id in ds) {
      const d = ds[id];
      d.localSpend = d.residents * D.DISTRICTS[id].income * d.employment * (1 - s.taxes.res[id]) * (0.7 + 0.3 * d.health / 100);
      spend += d.localSpend;
    }
    s.spendPower = spend;
    if (!initial && s.spendBase) {
      s.spendNorm = spend / s.spendBase;
      for (const id in ds) ds[id].spendNorm = ds[id].localSpend / ds[id].localSpendBase;
    } else {
      s.spendNorm = 1;
      for (const id in ds) { ds[id].localSpendBase = ds[id].localSpend; ds[id].spendNorm = 1; }
    }

    // --- taxes (income per month)
    let income = 0;
    for (const id in ds) {
      const d = ds[id];
      d.taxPaid = d.residents * D.DISTRICTS[id].income * s.taxes.res[id] * D.RES_TAX_FACTOR;
    }
    eachTile(s, t => {
      const b = t.building;
      if (!b || b.buildLeft > 0) return;
      const def = D.BUILDINGS[b.type];
      if (!def.businessBase) return;
      const rate = s.taxes.bus[t.district] !== undefined ? s.taxes.bus[t.district] : D.DEFAULT_BUS_TAX;
      const f = b.type === 'shop' ? shopFactor(b) : 1;
      ds[t.district].taxPaid += def.businessBase * rate * f;
    });
    for (const id in ds) income += ds[id].taxPaid;
    s.income = income;
    let upkeep = D.BASE_UPKEEP;
    eachTile(s, t => {
      const b = t.building;
      if (b && b.buildLeft === 0 && D.BUILDINGS[b.type].upkeep) upkeep += D.BUILDINGS[b.type].upkeep;
      if (b && b.type === 'factory' && b.filtered === true) upkeep += D.BUILDINGS.filter.upkeep;
    });
    if (s.bridge2) upkeep += D.BUILDINGS.bridge.upkeep;
    s.upkeep = upkeep;

    // --- quality of life and inequality
    let qmax = -1, qmin = 101, qsum = 0;
    for (const id in ds) {
      const d = ds[id];
      d.qol = (d.air + d.health + d.employment * 100 + d.housing + d.green) / 5;
      qmax = Math.max(qmax, d.qol); qmin = Math.min(qmin, d.qol); qsum += d.qol;
    }
    s.qolAvg = qsum / 4;
    s.inequality = qmax - qmin;

    // --- shop counts
    s.shops = { open: 0, sale: 0, closed: 0 };
    eachTile(s, t => { const b = t.building; if (b && b.type === 'shop' && b.buildLeft === 0) s.shops[b.state]++; });

    computeTargets(s);
  }

  // What each faction thinks of the mayor right now (approval moves toward this).
  function computeTargets(s) {
    const ds = s.districts;
    const totalTax = Object.values(ds).reduce((a, d) => a + d.taxPaid, 0) || 1;
    const totalRes = Object.values(ds).reduce((a, d) => a + d.residents, 0) || 1;
    const totalSpend = Object.values(s.spendYear).reduce((a, v) => a + v, 0);
    const attention = id => {
      if (totalSpend < 1) return 0;
      // Tenants expect spending in line with how many people live there;
      // the others expect it in line with how much tax they pay.
      const expected = id === 'millbrook' ? ds[id].residents / totalRes : ds[id].taxPaid / totalTax;
      return clamp((s.spendYear[id] / totalSpend - expected) * 45, -12, 12);
    };
    const fairness = id => -Math.max(0, s.qolAvg - ds[id].qol) * 0.35; // feeling left behind
    const filters = countBuildings(s, 'factory', null, { filter: b => b.filtered === true });
    const social = countBuildings(s, 'social');
    let shopHealth = 0, shopN = 0;
    eachTile(s, t => { const b = t.building; if (b && b.type === 'shop' && t.district === 'market' && b.buildLeft === 0) { shopHealth += b.health; shopN++; } });
    const avgShop = shopN ? shopHealth / shopN : 50;

    const m = ds.millbrook;
    m.target = 0.30 * m.air + 0.20 * m.health + 0.30 * m.employment * 100 + 0.20 * m.housing - 14
      - (s.taxes.res.millbrook - 0.10) * 250 + attention('millbrook') + fairness('millbrook') + s.mods.millbrook;

    const e = ds.elmwood;
    e.target = 0.30 * e.green + 0.20 * e.air + 0.20 * e.services + 0.30 * (100 - s.taxes.res.elmwood * 400)
      - social * 3 - (s.policies.rentCap ? 4 : 0) + attention('elmwood') + fairness('elmwood') + s.mods.elmwood - 2;

    const i = ds.ironworks;
    i.target = 0.40 * (100 - s.taxes.bus.ironworks * 500) + 0.30 * i.employment * 100 + 0.30 * (s.coalShare * 100)
      - filters * 5 - 14 + attention('ironworks') + fairness('ironworks') + s.mods.ironworks;

    const k = ds.market;
    k.target = 0.40 * avgShop + 0.30 * (100 - s.taxes.bus.market * 500) + 0.20 * s.access * 100 + 0.10 * k.air
      - (s.policies.rentCap ? 3 : 0) + attention('market') + fairness('market') + s.mods.market;

    for (const id in ds) ds[id].target = clamp(ds[id].target, 0, 100);
  }

  // ---------------------------------------------------------------- monthly tick
  function updateShops(s) {
    eachTile(s, t => {
      const b = t.building;
      if (!b || b.type !== 'shop' || b.buildLeft > 0) return;
      const d = s.districts[t.district];
      const spend = t.district === 'market' ? s.spendNorm : d.spendNorm;
      const rate = s.taxes.bus[t.district] !== undefined ? s.taxes.bus[t.district] : D.DEFAULT_BUS_TAX;
      const target = 70 + 120 * (spend - 1) + 20 * (s.access - D.SOUTH_ACCESS_BASE)
        - (rate - 0.10) * 350 - d.pollution * 0.15 + b.jitter;
      b.health += (target - b.health) * 0.3;
      const before = b.state;
      if (b.state === 'closed') { if (b.health > D.SHOP_REOPEN) b.state = 'sale'; }
      else if (b.health < D.SHOP_CLOSED) b.state = 'closed';
      else b.state = b.health >= D.SHOP_OPEN ? 'open' : 'sale';
      if (before !== 'closed' && b.state === 'closed') s._closedThisMonth = (s._closedThisMonth || 0) + 1;
      if (before === 'closed' && b.state !== 'closed') s._reopenedThisMonth = (s._reopenedThisMonth || 0) + 1;
    });
  }

  function endMonth(s) {
    if (s.phase !== 'playing') return;
    s._closedThisMonth = 0; s._reopenedThisMonth = 0;

    // construction
    eachTile(s, t => {
      const b = t.building;
      if (b && b.buildLeft > 0) {
        b.buildLeft--;
        if (b.buildLeft === 0) finishBuilding(s, t);
      }
      if (b && b.type === 'factory' && typeof b.filtered === 'number') {
        b.filtered--;
        if (b.filtered <= 0) { b.filtered = true; addNews(s, 'Factory filters installed. Less smoke over the south bank.', 'good'); }
      }
    });
    if (typeof s.bridgeLeft === 'number' && s.bridgeLeft > 0) {
      s.bridgeLeft--;
      if (s.bridgeLeft === 0) {
        s.bridge2 = true;
        eachTile(s, t => { if (t.kind === 'bridgeBuilding') t.kind = 'bridge'; });
        addNews(s, 'The second bridge is open! Millbrook workers can reach the Market Quarter.', 'good');
      }
    }

    // rents and gentrification
    const m = s.districts.millbrook;
    m.rentPressure += (30 - m.rentPressure) * D.RENT_DECAY;
    s.visual.movingOut = 0;
    if (!s.policies.rentCap && m.rentPressure > D.MOVE_OUT_THRESHOLD) {
      const rate = D.MOVE_OUT_RATE * (m.rentPressure - D.MOVE_OUT_THRESHOLD) / 20 + 0.005;
      const leaving = Math.round(m.residents * rate);
      m.residents -= leaving;
      s.visual.movingOut = Math.min(4, 1 + Math.floor(leaving / 40));
      addNews(s, `${leaving} Millbrook residents moved away because of rising rents.`, 'bad');
    }
    for (const id in s.healthPenalty) s.healthPenalty[id] *= 0.6;

    compute(s);
    updateShops(s);
    compute(s);
    if (s._closedThisMonth) addNews(s, `${s._closedThisMonth} shop${s._closedThisMonth > 1 ? 's' : ''} closed this month. Fewer jobs and less tax.`, 'bad');
    if (s._reopenedThisMonth) addNews(s, `${s._reopenedThisMonth} shop${s._reopenedThisMonth > 1 ? 's' : ''} reopened.`, 'good');

    // money
    s.lastNet = s.income - s.upkeep;
    s.money += s.lastNet;
    if (s.money < D.DEBT_LIMIT) s.debtMonths++; else s.debtMonths = 0;

    // approval moves toward its target
    for (const id in s.districts) {
      const d = s.districts[id];
      d.approval += (d.target - d.approval) * D.APPROVAL_SMOOTHING;
    }
    for (const id in s.districts) {
      const d = s.districts[id];
      if (d.approval < 35 && !d._protestWarned) { addNews(s, `${D.DISTRICTS[id].faction} is protesting at the town hall.`, 'bad'); d._protestWarned = true; }
      if (d.approval > 42) d._protestWarned = false;
    }

    checkPromises(s);
    logHistory(s);

    if (s.debtMonths >= D.BANKRUPT_MONTHS) {
      s.phase = 'over';
      s.result = { type: 'bankrupt' };
      addNews(s, 'Northhaven is bankrupt. The national government has taken over.', 'bad');
      return;
    }

    s.month++;
    if (s.month >= 12) {
      s.month = 11;
      s.phase = 'election';
      return;
    }
    const ev = D.EVENTS.find(e => e.month === s.month && !s.firedEvents.includes(e.id));
    if (ev) {
      s.firedEvents.push(ev.id);
      s.pendingEvent = ev;
      s.phase = 'event';
    }
  }

  function finishBuilding(s, t) {
    const b = t.building, name = D.BUILDINGS[b.type].name, dn = D.DISTRICTS[t.district].name;
    if (b.type === 'park') s.parksBuiltYear++;
    if (b.type === 'social') {
      s.socialBuiltYear++;
      s.districts[t.district].residents += D.SOCIAL_HOUSING_PEOPLE;
      s.districts[t.district].rentPressure = Math.max(0, s.districts[t.district].rentPressure - 15);
    }
    if (b.type === 'shop') { b.health = 58; b.state = 'sale'; }
    addNews(s, `${name} finished in ${dn}.`, 'good');
  }

  // ---------------------------------------------------------------- player actions
  function canPlace(s, type, c, r) {
    const def = D.BUILDINGS[type];
    const t = s.tiles[r] && s.tiles[r][c];
    if (!t) return { ok: false, reason: 'Outside the map.' };
    if (s.phase !== 'playing') return { ok: false, reason: 'Not now.' };
    if (s.money - def.cost < D.DEBT_LIMIT) return { ok: false, reason: 'Not enough money (debt limit reached).' };
    if (def.special === 'bridge') {
      if (s.bridge2 || typeof s.bridgeLeft === 'number') return { ok: false, reason: 'The second bridge is already built or under construction.' };
      if (t.kind !== 'bridgeSite') return { ok: false, reason: 'Build the bridge on the marked river crossing.' };
      return { ok: true };
    }
    if (def.upgradeOf) {
      if (!t.building || t.building.type !== def.upgradeOf || t.building.buildLeft > 0) return { ok: false, reason: 'Click on a factory.' };
      if (t.building.filtered) return { ok: false, reason: 'This factory already has filters.' };
      return { ok: true };
    }
    if (t.kind !== 'land') return { ok: false, reason: 'You can only build on land plots.' };
    if (t.building && t.building.type !== 'tree') return { ok: false, reason: 'This plot is taken.' };
    if (def.canBuild !== 'all' && !def.canBuild.includes(t.district))
      return { ok: false, reason: `${def.name} can only be built in: ${def.canBuild.map(x => D.DISTRICTS[x].name).join(', ')}.` };
    return { ok: true };
  }

  // How much a building counts as "the mayor cares about this district".
  const ATTENTION = { park: 1, clinic: 1, social: 1, bus: 1, solar: 0.3, filter: 0, bridge: 1, shop: 1 };

  function place(s, type, c, r) {
    const check = canPlace(s, type, c, r);
    if (!check.ok) return check;
    const def = D.BUILDINGS[type], t = s.tiles[r][c];
    s.money -= def.cost;
    if (def.special === 'bridge') {
      s.bridgeLeft = def.months;
      eachTile(s, x => { if (x.kind === 'bridgeSite') x.kind = 'bridgeBuilding'; });
      s.spendYear.millbrook += def.cost * 0.6;
      s.spendYear.market += def.cost * 0.4;
      s.districts.millbrook.rentPressure += D.RENT_PRESSURE_PER_UPGRADE;
      addNews(s, `Construction of the second bridge started (${def.months} months).`);
    } else if (def.upgradeOf) {
      t.building.filtered = def.months;
      addNews(s, 'Filters ordered for a factory. Industry Association grumbles about costs.');
    } else {
      t.building = makeBuilding(type, def.months, Math.random);
      addNews(s, `${def.name} under construction in ${D.DISTRICTS[t.district].name} (${def.months} month${def.months > 1 ? 's' : ''}).`);
      if (t.district === 'millbrook' && ['park', 'clinic', 'bus', 'shop'].includes(type))
        s.districts.millbrook.rentPressure += D.RENT_PRESSURE_PER_UPGRADE;
    }
    if (!def.special) s.spendYear[t.district] += def.cost * (ATTENTION[type] ?? 1);
    compute(s);
    return { ok: true };
  }

  function setTax(s, kind, id, value) {
    s.taxes[kind][id] = clamp(Math.round(value * 100) / 100, D.MIN_TAX, D.MAX_TAX);
    compute(s);
  }

  function setRentCap(s, on) {
    s.policies.rentCap = on;
    addNews(s, on ? 'Rent cap introduced in Millbrook. Landlords and businesses complain.' : 'Rent cap removed.');
    compute(s);
  }

  function pickChallenges(s, ids) {
    s.chosen = ids.map(id => ({ id, status: 'active' }));
    for (const id of ids) {
      const ch = D.CHALLENGES.find(c => c.id === id);
      // People react to promises right away, but the effect fades unless the promise is kept.
      for (const d in ch.reactions) s.districts[d].approval = clamp(s.districts[d].approval + ch.reactions[d] * 0.5, 0, 100);
    }
    s.phase = 'playing';
    addNews(s, 'Your goals for the year are set. The city is watching.');
    compute(s);
  }

  function challengeProgress(s, id) {
    switch (id) {
      case 'smoke': return { done: s.emissions <= s.emissionsStart * 0.75 + 1e-6, text: `Emissions ${Math.round(s.emissions)} / target ${Math.round(s.emissionsStart * 0.75)}` };
      case 'busline': return { done: countBuildings(s, 'bus') >= 1, text: `Bus lines: ${countBuildings(s, 'bus')}` };
      case 'bridge': return { done: s.bridge2, text: s.bridge2 ? 'Bridge open' : typeof s.bridgeLeft === 'number' ? `Under construction (${s.bridgeLeft} months left)` : 'Not started' };
      case 'lowtax': return { done: s.taxes.bus.ironworks <= 0.0801 && s.taxes.bus.market <= 0.0801, text: `Ironworks ${Math.round(s.taxes.bus.ironworks * 100)}%, Market ${Math.round(s.taxes.bus.market * 100)}%` };
      case 'parks': return { done: s.parksBuiltYear >= 2, text: `Parks finished: ${s.parksBuiltYear} / 2` };
      case 'shops': return { done: s.shops.closed === 0, text: `Closed shops: ${s.shops.closed}` };
      case 'housing': return { done: s.socialBuiltYear >= 1, text: `Social housing finished: ${s.socialBuiltYear} / 1` };
    }
    return { done: false, text: '' };
  }

  // Build-type promises are rewarded as soon as they are finished.
  const LOCKING = ['busline', 'bridge', 'parks', 'housing'];
  function rewardPromise(s, def) {
    for (const d in def.reactions) if (def.reactions[d] > 0) s.mods[d] += def.reactions[d];
  }
  function checkPromises(s) {
    for (const ch of s.chosen) {
      if (ch.status !== 'active' || !LOCKING.includes(ch.id)) continue;
      if (challengeProgress(s, ch.id).done) {
        ch.status = 'kept';
        const def = D.CHALLENGES.find(c => c.id === ch.id);
        rewardPromise(s, def);
        addNews(s, `Promise kept: ${def.title}. Supporters are pleased.`, 'good');
      }
    }
    compute(s);
  }

  function resolveEvent(s, effect) {
    const m = s.mods;
    switch (effect) {
      case 'factoryStay':
        s.taxes.bus.ironworks = clamp(s.taxes.bus.ironworks - 0.03, D.MIN_TAX, D.MAX_TAX);
        m.ironworks += 8; m.millbrook -= 3;
        addNews(s, 'Ironworks business tax cut. The factory stays.');
        break;
      case 'factoryLeave': {
        let removed = false;
        eachTile(s, t => {
          if (!removed && t.building && t.building.type === 'factory' && t.building.filtered !== true) { t.building = null; removed = true; }
        });
        m.ironworks -= 12;
        addNews(s, 'The factory closed and moved abroad: 300 jobs lost, but less smoke.', 'bad');
        break;
      }
      case 'luxuryYes':
        s.money += 400; s.districts.millbrook.rentPressure += 25;
        m.elmwood += 4; m.market += 5; m.millbrook -= 10;
        addNews(s, 'Luxury flats approved on the Millbrook riverbank. Rents start rising.', 'bad');
        break;
      case 'luxuryNo':
        m.market -= 4; m.millbrook += 5;
        addNews(s, 'Riverbank stays public. Tenants cheer, developers grumble.');
        break;
      case 'heatFund':
        s.money -= 120; m.millbrook += 3;
        addNews(s, 'Emergency care funded during the heat wave.', 'good');
        break;
      case 'heatNothing':
        for (const id in s.districts) s.healthPenalty[id] = s.districts[id].pollution * 0.5;
        m.millbrook -= 6; m.ironworks -= 3;
        addNews(s, 'The heat wave hit polluted districts hardest. Many people fell ill.', 'bad');
        break;
    }
    s.pendingEvent = null;
    s.phase = 'playing';
    compute(s);
  }

  // ---------------------------------------------------------------- election
  function runElection(s) {
    // 1. judge the year's challenges
    const outcomes = [];
    for (const ch of s.chosen) {
      const def = D.CHALLENGES.find(c => c.id === ch.id);
      if (ch.status === 'kept') { outcomes.push({ title: def.title, kept: true }); continue; }
      const p = challengeProgress(s, ch.id);
      ch.status = p.done ? 'kept' : 'broken';
      for (const d in def.reactions) {
        const r = def.reactions[d];
        if (r <= 0) continue;
        const delta = p.done ? r : -r * 1.2;
        s.districts[d].approval = clamp(s.districts[d].approval + delta, 0, 100);
      }
      outcomes.push({ title: def.title, kept: p.done });
    }
    // 2. every district votes
    const rows = [];
    let yes = 0, total = 0;
    for (const id of D.DISTRICT_ORDER) {
      const d = s.districts[id];
      const support = clamp(d.approval / 100 - D.RIVAL.appeal[id], 0.05, 0.95);
      const turnout = 0.45 + 0.35 * Math.abs(d.approval - 50) / 50;
      const voters = d.residents * turnout;
      yes += voters * support; total += voters;
      rows.push({ id, name: D.DISTRICTS[id].name, voters: Math.round(voters), support, approval: d.approval });
    }
    const share = yes / total;
    const won = share > 0.5;
    s.result = { type: won ? 'won' : 'lost', share, rows, outcomes, card: reportCard(s) };
    s.phase = 'over';
    logHistory(s);
    return s.result;
  }

  function grade(v, cuts) { // cuts: [A,B,C,D] thresholds, higher value is better
    const g = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 4; i++) if (v >= cuts[i]) return g[i];
    return 'F';
  }

  function reportCard(s) {
    const m = s.districts.millbrook;
    const items = [
      { name: 'Fairness between districts', value: `gap ${s.inequality.toFixed(1)} (start ${s.inequalityStart.toFixed(1)})`, g: grade(-s.inequality, [-10, -15, -20, -26]) },
      { name: 'Air quality in Millbrook', value: `${Math.round(m.air)} / 100`, g: grade(m.air, [85, 75, 65, 55]) },
      { name: 'Affordable housing in Millbrook', value: `${Math.round(m.housing)} / 100`, g: grade(m.housing, [75, 65, 55, 45]) },
      { name: 'Jobs in Millbrook', value: `${Math.round(m.employment * 100)}% employed`, g: grade(m.employment, [0.92, 0.85, 0.78, 0.7]) },
      { name: 'Local shops', value: `${s.shops.open} open, ${s.shops.sale} struggling, ${s.shops.closed} closed`, g: grade(-s.shops.closed, [0, -1, -3, -5]) },
      { name: 'City budget', value: `${Math.round(s.money)} k€`, g: grade(s.money, [500, 200, 0, -200]) },
    ];
    const ending = s.inequality < s.inequalityStart - 1 ? 'Common Ground' : 'Divided City';
    return { items, ending };
  }

  // ---------------------------------------------------------------- data log
  function logHistory(s) {
    const row = {
      year: s.year, month: D.MONTHS[s.month], money: Math.round(s.money), net: Math.round(s.lastNet),
      emissions: s.emissions.toFixed(1), inequality: s.inequality.toFixed(1),
      shops_open: s.shops.open, shops_sale: s.shops.sale, shops_closed: s.shops.closed,
    };
    for (const id of D.DISTRICT_ORDER) {
      const d = s.districts[id];
      row[id + '_residents'] = d.residents;
      row[id + '_approval'] = d.approval.toFixed(1);
      row[id + '_pollution'] = d.pollution.toFixed(1);
      row[id + '_employment'] = (d.employment * 100).toFixed(1);
      row[id + '_qol'] = d.qol.toFixed(1);
      row[id + '_spend'] = Math.round(s.spendYear[id]);
    }
    s.history.push(row);
  }

  function historyCSV(s) {
    if (!s.history.length) return '';
    const cols = Object.keys(s.history[0]);
    return [cols.join(','), ...s.history.map(r => cols.map(c => r[c]).join(','))].join('\n');
  }

  return {
    newGame, compute, endMonth, canPlace, place, setTax, setRentCap, pickChallenges,
    challengeProgress, resolveEvent, runElection, historyCSV, countBuildings, addNews, districtOf,
  };
})();
