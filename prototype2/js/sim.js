const SIM = (() => {
  const D = DATA;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const O = D.CORE_MIN;             // the original city layout is placed at this offset
  const ORIGINAL_FACTORIES = [[2, 12], [6, 13], [3, 17], [7, 18]].map(([c, r]) => (c + O) + ',' + (r + O));
  const COAL_SITE = (1 + O) + ',' + (14 + O);
  // smooth value noise for natural-looking woods outside the city
  function noise(c, r, seed) {
    const h = (x, y) => { let n = Math.imul(x * 374761393 + y * 668265263 + seed * 1442695041, 1274126177); n ^= n >>> 13; n = Math.imul(n, 1103515245); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    const S = 5, x = c / S, y = r / S, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sm = t => t * t * (3 - 2 * t);
    const a = h(x0, y0), b = h(x0 + 1, y0), cc = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
    return (a + (b - a) * sm(fx)) * (1 - sm(fy)) + (cc + (d - cc) * sm(fx)) * sm(fy);
  }

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const shuffle = (arr, r = Math.random) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // Map
  function districtOf(c, r) {
    if (D.RIVER_ROWS.includes(r)) return null;
    const north = r < D.RIVER_ROWS[0];
    const west = c <= D.ROAD_COLS[0];
    if (north) return west ? 'elmwood' : 'market';
    return west ? 'ironworks' : 'millbrook';
  }
  const inCore = (c, r) => c >= D.CORE_MIN && c <= D.CORE_MAX && r >= D.CORE_MIN && r <= D.CORE_MAX;
  const onRoadLine = (c, r) => D.ROAD_COLS.includes(c) || D.ROAD_ROWS.includes(r);

  function buildMap() {
    const N = D.MAP_SIZE, rand = rng(7), wild = rng(99);
    const tiles = [];
    for (let r = 0; r < N; r++) {
      const row = [];
      for (let c = 0; c < N; c++) {
        const t = { c, r, district: districtOf(c, r), kind: 'land', building: null, owned: inCore(c, r) };
        if (D.RIVER_ROWS.includes(r)) {
          t.kind = !t.owned ? 'river' : c === D.OLD_BRIDGE_COL ? 'bridge' : c === D.NEW_BRIDGE_COL ? 'bridgeSite' : 'river';
        } else if (!t.owned) {
          const n = noise(c, r, 3);
          if (n > 0.55 ? wild() < 0.85 : wild() < 0.08) t.building = makeBuilding('wildtree');
        } else if (onRoadLine(c, r)) {
          t.kind = 'road';
        } else {
          const key = c + ',' + r, x = rand();
          let b = null;
          switch (t.district) {
            case 'elmwood': b = x < 0.62 ? 'villa' : x < 0.85 ? 'tree' : null; break;
            case 'market': b = x < 0.3 ? 'shop' : x < 0.44 ? 'office' : x < 0.56 ? 'flats' : x < 0.66 ? 'tree' : null; break;
            case 'ironworks':
              if (ORIGINAL_FACTORIES.includes(key)) b = 'factory';
              else if (key === COAL_SITE) b = 'coal';
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
    if (type === 'shop') { b.health = 72; b.state = 'open'; b.jitter = rand ? (rand() * 16 - 8) : 0; }
    if (type === 'factory') b.filtered = false;
    if (type === 'school') b.age = 0;
    return b;
  }

  const tileAt = (s, c, r) => (s.tiles[r] && s.tiles[r][c]) || null;
  function eachTile(s, fn) { for (const row of s.tiles) for (const t of row) fn(t); }
  function neighbours(s, t) {
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => tileAt(s, t.c + dc, t.r + dr)).filter(Boolean);
  }
  function countBuildings(s, type, district, opts = {}) {
    let n = 0;
    eachTile(s, t => {
      const b = t.building;
      if (!b || b.type !== type) return;
      if (district && t.district !== district) return;
      if (!opts.includeUnfinished && b.buildLeft > 0) return;
      if (opts.filter && !opts.filter(b, t)) return;
      n++;
    });
    return n;
  }
  const bank = (t) => (t.r < D.RIVER_ROWS[0] ? 'north' : 'south');

  // New game and years
  function newGame(mode = 'challenge') {
    const s = {
      mode, year: D.START_YEAR, yearIndex: 1, month: 0, money: D.START_MONEY, lastNet: 0,
      tiles: buildMap(),
      taxes: {
        res: { millbrook: D.DEFAULT_RES_TAX, elmwood: D.DEFAULT_RES_TAX, ironworks: D.DEFAULT_RES_TAX, market: D.DEFAULT_RES_TAX },
        bus: { ironworks: D.DEFAULT_BUS_TAX, market: D.DEFAULT_BUS_TAX },
      },
      policies: { rentCap: false },
      bridge2: false, riverClean: false,
      lines: [], nextLineId: 1,
      landBought: 0,
      districts: {},
      mods: { millbrook: 0, elmwood: 0, ironworks: 0, market: 0 },
      spendYear: { millbrook: 0, elmwood: 0, ironworks: 0, market: 0 },
      healthPenalty: { millbrook: 0, elmwood: 0, ironworks: 0, market: 0 },
      offered: [], chosen: [],
      phase: 'challenges',     // challenges | playing | event | election | yearEnd | over
      pendingEvent: null, eventPlan: [],
      debtMonths: 0, yearsWon: 0,
      news: [], history: [], results: [],
      visual: { movingOut: 0 },
      result: null,
    };
    for (const id of Object.keys(D.DISTRICTS)) {
      const dd = D.DISTRICTS[id];
      s.districts[id] = {
        residents: dd.residents, baseCapacity: Math.round(dd.residents * D.HOUSING_CAPACITY_SLACK),
        approval: 50, rentPressure: id === 'millbrook' ? 30 : 20,
        pollution: 0, air: 0, health: 0, employment: 0, housing: 0, green: 0, qol: 0, taxPaid: 0,
      };
    }
    compute(s, true);
    s.spendBase = s.spendPower;
    for (let k = 0; k < 12; k++) { updateShops(s); compute(s); }
    s._closed = 0; s._reopened = 0;
    for (const id in s.districts) s.districts[id].approval = s.districts[id].target;
    s.inequalityStart = s.inequality;
    beginYear(s, true);
    addNews(s, 'Welcome, Mayor. Northhaven is divided: choose your goals for the year.');
    return s;
  }

  // Set up a new year: goals on offer, events, counters.
  function beginYear(s, first) {
    s.month = 0;
    s.chosen = [];
    s.yearStart = { emissions: s.emissions, residents: totalResidents(s) };
    s.yearCount = { parks: 0, social: 0, school: 0, clean: 0, crossLines: 0, land: 0 };
    const available = D.CHALLENGES.filter(ch => challengeAvailable(s, ch.id)).map(ch => ch.id);
    s.offered = first ? ['smoke', 'busline', 'bridge', 'lowtax', 'parks', 'housing'] : shuffle(available).slice(0, D.CHALLENGES_OFFERED);
    const months = shuffle([2, 3, 4, 5, 6, 7, 8, 9, 10]).slice(0, D.EVENTS_PER_YEAR).sort((a, b) => a - b);
    const ids = first ? ['factory_leave', 'luxury', 'heatwave'] : shuffle(D.EVENTS.map(e => e.id)).slice(0, D.EVENTS_PER_YEAR);
    s.eventPlan = months.map((m, i) => ({ month: m, id: ids[i] }));
    s.rival = D.RIVALS[(s.yearIndex - 1) % D.RIVALS.length];
    s.phase = 'challenges';
  }

  function startNextYear(s) {
    s.year++; s.yearIndex++;
    for (const id in s.mods) s.mods[id] *= D.MODS_YEARLY_DECAY;
    for (const id in s.spendYear) s.spendYear[id] *= 0.3;
    for (const id in s.healthPenalty) s.healthPenalty[id] = 0;
    s.result = null;
    compute(s);
    beginYear(s, false);
    addNews(s, `${s.year} begins. ${s.rival.name} is running against you this year.`);
  }

  function totalResidents(s) { return Object.values(s.districts).reduce((a, d) => a + d.residents, 0); }

  function addNews(s, text, kind = 'info') {
    s.news.unshift({ when: `${D.MONTHS[Math.min(s.month, 11)].slice(0, 3)} ${s.year}`, text, kind });
    if (s.news.length > 50) s.news.pop();
  }

  // Core model
  function compute(s, initial = false) {
    const ds = s.districts;
    const clean = countBuildings(s, 'solar') + countBuildings(s, 'wind');
    s.coalShare = clamp(1 - clean * 0.2, 0, 1);
    const done = s.lines.filter(l => l.buildLeft === 0);
    s.busLines = done.length;
    s.crossLines = done.filter(l => l.cross).length;
    const localLines = s.busLines - s.crossLines;

    // emissions and pollution (wind blows east, from Ironworks over Millbrook)
    let E = 0;
    eachTile(s, t => {
      const b = t.building;
      if (!b || b.buildLeft > 0) return;
      if (b.type === 'factory') E += D.BUILDINGS.factory.emission * (b.filtered === true ? 1 - D.FILTER_CUT : 1);
      if (b.type === 'coal') E += D.BUILDINGS.coal.emission * s.coalShare;
    });
    s.emissions = E;
    const lineCut = Math.min(3, s.busLines);
    for (const id in ds) {
      const parks = countBuildings(s, 'park', id);
      let p = E * D.POLLUTION_SPREAD[id] * D.POLLUTION_SCALE + D.TRAFFIC_POLLUTION[id];
      p -= lineCut * D.BUS_TRAFFIC_CUT * (id === 'market' ? 1 : 0.5);
      p -= parks * D.PARK_AIR_BONUS;
      ds[id].pollution = clamp(p, 0, 100);
      ds[id].air = 100 - ds[id].pollution;
    }

    // jobs and access to jobs across the river
    const shopFactor = b => (b.state === 'open' ? 1 : b.state === 'sale' ? 0.7 : 0);
    let northJobs = 0, southJobs = 0;
    eachTile(s, t => {
      const b = t.building;
      if (!b || b.buildLeft > 0 || !t.district) return;
      const def = D.BUILDINGS[b.type];
      if (!def.jobs) return;
      const j = def.jobs * (b.type === 'shop' ? shopFactor(b) : 1);
      if (bank(t) === 'north') northJobs += j; else southJobs += j;
    });
    const workers = id => ds[id].residents * D.WORKER_SHARE;
    const northWorkers = workers('elmwood') + workers('market');
    const southWorkers = workers('ironworks') + workers('millbrook');
    const access = clamp(D.SOUTH_ACCESS_BASE + D.BUS_CROSS_ACCESS * Math.min(2, s.crossLines)
      + D.BUS_LOCAL_ACCESS * Math.min(2, localLines) + (s.bridge2 ? D.BRIDGE_ACCESS : 0), 0, 1);
    s.access = access;
    const northFilled = Math.min(northWorkers, northJobs);
    const southAvail = southJobs + (northJobs - northFilled) * access;
    const empSouth = clamp(southAvail / southWorkers, 0, 0.97);
    const empNorth = clamp((northFilled + southJobs * 0.05) / northWorkers, 0, 0.97);
    ds.elmwood.employment = empNorth; ds.market.employment = empNorth;
    ds.ironworks.employment = clamp(empSouth + 0.08, 0, 0.97);
    ds.millbrook.employment = clamp(empSouth - 0.03, 0, 0.97);
    s.jobs = { north: Math.round(northJobs), south: Math.round(southJobs) };

    // health, housing, green space, education, homes
    for (const id in ds) {
      const d = ds[id];
      const clinics = countBuildings(s, 'clinic', id);
      const community = Math.min(2, countBuildings(s, 'community', id));
      const police = Math.min(2, countBuildings(s, 'police', id));
      const fire = Math.min(2, countBuildings(s, 'fire', id));
      d.services = clamp(D.BASE_SERVICES[id] + clinics * D.CLINIC_HEALTH + community * D.COMMUNITY_SERVICES + police * 6 + fire * 6, 0, 100);
      d.police = police;
      const riverBonus = s.riverClean && (id === 'millbrook' || id === 'ironworks') ? D.RIVER_CLEAN_HEALTH : 0;
      d.health = clamp(0.6 * d.air + 0.4 * d.services + riverBonus - s.healthPenalty[id], 0, 100);
      const parks = countBuildings(s, 'park', id);
      d.green = clamp(D.BASE_GREEN[id] + parks * D.PARK_GREEN + (s.riverClean && id !== 'elmwood' ? D.RIVER_CLEAN_GREEN : 0), 0, 100);
      if (s.policies.rentCap) d.rentPressure = Math.min(d.rentPressure, D.RENT_CAP_MAX);
      d.housing = clamp(100 - d.rentPressure, 0, 100);
      let edu = 0;
      eachTile(s, t => { const b = t.building; if (b && b.type === 'school' && b.buildLeft === 0 && t.district === id) edu += Math.min(8, b.age) * D.SCHOOL_INCOME; });
      d.incomeMult = 1 + Math.min(0.24, edu);
      let homes = 0;
      eachTile(s, t => { const b = t.building; if (b && b.buildLeft === 0 && t.district === id && D.BUILDINGS[b.type].homes) homes += D.BUILDINGS[b.type].homes; });
      d.capacity = d.baseCapacity + homes;
    }

    // spending power (customers for shops)
    let spend = 0;
    for (const id in ds) {
      const d = ds[id];
      d.localSpend = d.residents * D.DISTRICTS[id].income * d.incomeMult * d.employment * (1 - s.taxes.res[id]) * (0.7 + 0.3 * d.health / 100);
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

    // taxes and upkeep
    for (const id in ds) {
      const d = ds[id];
      d.taxPaid = d.residents * D.DISTRICTS[id].income * d.incomeMult * s.taxes.res[id] * D.RES_TAX_FACTOR;
    }
    eachTile(s, t => {
      const b = t.building;
      if (!b || b.buildLeft > 0 || !t.district) return;
      const def = D.BUILDINGS[b.type];
      if (!def.businessBase) return;
      const rate = s.taxes.bus[t.district] !== undefined ? s.taxes.bus[t.district] : D.DEFAULT_BUS_TAX;
      ds[t.district].taxPaid += def.businessBase * rate * (b.type === 'shop' ? shopFactor(b) : 1);
    });
    s.income = Object.values(ds).reduce((a, d) => a + d.taxPaid, 0);
    let upkeep = D.BASE_UPKEEP;
    eachTile(s, t => {
      const b = t.building;
      if (b && b.buildLeft === 0 && D.BUILDINGS[b.type].upkeep) upkeep += D.BUILDINGS[b.type].upkeep;
      if (b && b.type === 'factory' && b.filtered === true) upkeep += D.BUILDINGS.filter.upkeep;
    });
    upkeep += done.length * D.BUILDINGS.bus.upkeep;
    if (s.bridge2) upkeep += D.BUILDINGS.bridge.upkeep;
    s.upkeep = upkeep;

    // quality of life and inequality
    let qmax = -1, qmin = 101, qsum = 0;
    for (const id in ds) {
      const d = ds[id];
      d.qol = (d.air + d.health + d.employment * 100 + d.housing + d.green) / 5;
      qmax = Math.max(qmax, d.qol); qmin = Math.min(qmin, d.qol); qsum += d.qol;
    }
    s.qolAvg = qsum / 4;
    s.inequality = qmax - qmin;

    s.shops = { open: 0, sale: 0, closed: 0 };
    eachTile(s, t => { const b = t.building; if (b && b.type === 'shop' && b.buildLeft === 0) s.shops[b.state]++; });

    computeTargets(s);
  }

  // Services make the district's faction happier (capped).
  function amenity(s, id) {
    let sum = 0;
    for (const [type, v] of Object.entries(D.AMENITY_BONUS)) sum += countBuildings(s, type, id) * (v[id] || 0);
    return Math.min(D.AMENITY_CAP, sum);
  }

  function computeTargets(s) {
    const ds = s.districts;
    const totalTax = Object.values(ds).reduce((a, d) => a + d.taxPaid, 0) || 1;
    const totalRes = totalResidents(s) || 1;
    const totalSpend = Object.values(s.spendYear).reduce((a, v) => a + v, 0);
    const attention = id => {
      if (totalSpend < 1) return 0;
      const expected = id === 'millbrook' ? ds[id].residents / totalRes : ds[id].taxPaid / totalTax;
      return clamp((s.spendYear[id] / totalSpend - expected) * 45, -12, 12);
    };
    const fairness = id => -Math.max(0, s.qolAvg - ds[id].qol) * 0.35;
    const filters = countBuildings(s, 'factory', null, { filter: b => b.filtered === true });
    const newFactories = Math.max(0, countBuildings(s, 'factory') - ORIGINAL_FACTORIES.length);
    const social = countBuildings(s, 'social');
    const community = id => amenity(s, id);
    let shopHealth = 0, shopN = 0;
    eachTile(s, t => { const b = t.building; if (b && b.type === 'shop' && t.district === 'market' && b.buildLeft === 0) { shopHealth += b.health; shopN++; } });
    const avgShop = shopN ? shopHealth / shopN : 50;

    const m = ds.millbrook;
    m.target = 0.30 * m.air + 0.20 * m.health + 0.30 * m.employment * 100 + 0.20 * m.housing - 14
      - (s.taxes.res.millbrook - 0.10) * 250 - newFactories * 2 + (s.riverClean ? 3 : 0)
      + community('millbrook') + attention('millbrook') + fairness('millbrook') + s.mods.millbrook;
    const e = ds.elmwood;
    e.target = 0.30 * e.green + 0.20 * e.air + 0.20 * e.services + 0.30 * (100 - s.taxes.res.elmwood * 400)
      - social * 3 - countBuildings(s, 'wind', 'elmwood') * 4 - (s.policies.rentCap ? 4 : 0)
      + community('elmwood') + attention('elmwood') + fairness('elmwood') + s.mods.elmwood - 2;
    const i = ds.ironworks;
    i.target = 0.40 * (100 - s.taxes.bus.ironworks * 500) + 0.30 * i.employment * 100 + 0.30 * (s.coalShare * 100)
      - filters * 5 + newFactories * 4 - 14 + community('ironworks') + attention('ironworks') + fairness('ironworks') + s.mods.ironworks;
    const k = ds.market;
    k.target = 0.40 * avgShop + 0.30 * (100 - s.taxes.bus.market * 500) + 0.20 * s.access * 100 + 0.10 * k.air
      + countBuildings(s, 'officenew') * 3 - (s.policies.rentCap ? 3 : 0)
      + community('market') + attention('market') + fairness('market') + s.mods.market;
    for (const id in ds) ds[id].target = clamp(ds[id].target, 0, 100);
  }

  // Monthly tick
  function updateShops(s) {
    eachTile(s, t => {
      const b = t.building;
      if (!b || b.type !== 'shop' || b.buildLeft > 0 || !t.district) return;
      const d = s.districts[t.district];
      const spend = t.district === 'market' ? s.spendNorm : d.spendNorm;
      const rate = s.taxes.bus[t.district] !== undefined ? s.taxes.bus[t.district] : D.DEFAULT_BUS_TAX;
      const target = 70 + 120 * (spend - 1) + 20 * (s.access - D.SOUTH_ACCESS_BASE) - (rate - 0.10) * 350 - d.pollution * 0.15 + (d.police ? 5 : 0) + b.jitter;
      b.health += (target - b.health) * 0.3;
      const before = b.state;
      if (b.state === 'closed') { if (b.health > D.SHOP_REOPEN) b.state = 'sale'; }
      else if (b.health < D.SHOP_CLOSED) b.state = 'closed';
      else b.state = b.health >= D.SHOP_OPEN ? 'open' : 'sale';
      if (before !== 'closed' && b.state === 'closed') s._closed = (s._closed || 0) + 1;
      if (before === 'closed' && b.state !== 'closed') s._reopened = (s._reopened || 0) + 1;
    });
  }

  function endMonth(s) {
    if (s.phase !== 'playing') return;
    s._closed = 0; s._reopened = 0;
    s.finished = [];

    // construction
    eachTile(s, t => {
      const b = t.building;
      if (!b) return;
      if (b.buildLeft > 0) { b.buildLeft--; if (b.buildLeft === 0) finishBuilding(s, t); }
      else if (b.type === 'school') b.age++;
      if (b.type === 'factory' && typeof b.filtered === 'number') {
        b.filtered--;
        if (b.filtered <= 0) { b.filtered = true; addNews(s, 'Factory filters installed. Less smoke over the south bank.', 'good'); }
      }
    });
    for (const l of s.lines) if (l.buildLeft > 0) {
      l.buildLeft--;
      if (l.buildLeft === 0) {
        if (l.cross) s.yearCount.crossLines++;
        addNews(s, l.cross ? 'A bus line across the river opened. The south bank is closer to jobs.' : 'A new bus line opened.', 'good');
      }
    }
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

    // people move in where life is good and homes are free, and leave where it is bad
    for (const id in s.districts) {
      const d = s.districts[id];
      if (d.qol > 58 && d.residents < d.capacity) {
        const slow = id === 'millbrook' && m.rentPressure > D.MOVE_OUT_THRESHOLD ? 0.5 : 1;
        d.residents = Math.min(d.capacity, Math.round(d.residents + d.residents * D.GROWTH_RATE * Math.min(1, (d.qol - 58) / 20) * slow));
      } else if (d.qol < 42) {
        d.residents = Math.round(d.residents * (1 - 0.005 * Math.min(1, (42 - d.qol) / 20)));
      }
    }
    compute(s);
    if (s._closed) addNews(s, `${s._closed} shop${s._closed > 1 ? 's' : ''} closed this month. Fewer jobs and less tax.`, 'bad');
    if (s._reopened) addNews(s, `${s._reopened} shop${s._reopened > 1 ? 's' : ''} reopened.`, 'good');

    // money
    s.lastNet = s.income - s.upkeep;
    s.money += s.lastNet;
    if (s.money < D.DEBT_LIMIT) s.debtMonths++; else s.debtMonths = 0;

    // approval moves toward its target
    for (const id in s.districts) {
      const d = s.districts[id];
      d.approval += (d.target - d.approval) * D.APPROVAL_SMOOTHING;
      if (d.approval < 35 && !d._protestWarned) { addNews(s, `${D.DISTRICTS[id].faction} is protesting at the town hall.`, 'bad'); d._protestWarned = true; }
      if (d.approval > 42) d._protestWarned = false;
    }

    checkPromises(s);
    logHistory(s);

    if (s.debtMonths >= D.BANKRUPT_MONTHS) {
      s.phase = 'over';
      s.result = { type: 'bankrupt', card: reportCard(s) };
      addNews(s, 'Northhaven is bankrupt. The national government has taken over.', 'bad');
      return;
    }

    s.month++;
    if (s.month >= 12) { s.month = 11; s.phase = 'election'; return; }
    const planned = s.eventPlan.find(p => p.month === s.month);
    if (planned) { s.pendingEvent = D.EVENTS.find(e => e.id === planned.id); s.phase = 'event'; }
  }

  function finishBuilding(s, t) {
    const b = t.building, def = D.BUILDINGS[b.type];
    if (b.type === 'busstop') return;
    const dn = D.DISTRICTS[t.district].name;
    const bonus = D.AMENITY_BONUS[b.type] ? D.AMENITY_BONUS[b.type][t.district] : 0;
    if (D.AMENITY_BONUS[b.type]) (s.finished = s.finished || []).push({ c: t.c, r: t.r, text: bonus ? `+${bonus} ${D.DISTRICTS[t.district].short}` : `${D.DISTRICTS[t.district].short} don't mind`, good: bonus > 0 });
    if (b.type === 'park') s.yearCount.parks++;
    if (b.type === 'school') s.yearCount.school++;
    if (b.type === 'solar' || b.type === 'wind') s.yearCount.clean++;
    if (b.type === 'social') {
      s.yearCount.social++;
      s.districts[t.district].rentPressure = Math.max(0, s.districts[t.district].rentPressure - 15);
    }
    if (b.type === 'apartments' && t.district === 'millbrook') s.districts.millbrook.rentPressure += 8;
    if (b.type === 'water') { s.riverClean = true; addNews(s, 'The water treatment plant is running. The river is clean again!', 'good'); return; }
    if (b.type === 'shop') { b.health = 58; b.state = 'sale'; }
    addNews(s, `${def.name} finished in ${dn}.`, 'good');
  }

  // Player actions
  const ATTENTION = { park: 1, clinic: 1, school: 1, community: 1, social: 1, apartments: 0.6, solar: 0.3, wind: 0.3, filter: 0, water: 0.6, shop: 1, officenew: 1, factory: 1 };
  const RENT_RAISERS = ['park', 'clinic', 'school', 'community', 'shop'];

  function canPlace(s, type, c, r) {
    const def = D.BUILDINGS[type];
    const t = tileAt(s, c, r);
    if (!t) return { ok: false, reason: 'Outside the map.' };
    if (s.phase !== 'playing') return { ok: false, reason: 'Not now.' };
    if (s.money - def.cost < D.DEBT_LIMIT) return { ok: false, reason: 'Not enough money (debt limit reached).' };
    if (def.special === 'bridge') {
      if (s.bridge2 || typeof s.bridgeLeft === 'number') return { ok: false, reason: 'The second bridge is already built or under construction.' };
      if (t.kind !== 'bridgeSite') return { ok: false, reason: 'Build the bridge on the marked river crossing.' };
      return { ok: true };
    }
    if (def.special === 'bus') return canPlaceStop(s, c, r);
    if (def.upgradeOf) {
      if (!t.building || t.building.type !== def.upgradeOf || t.building.buildLeft > 0) return { ok: false, reason: 'Click on a factory.' };
      if (t.building.filtered) return { ok: false, reason: 'This factory already has filters.' };
      return { ok: true };
    }
    if (!t.owned) return { ok: false, reason: 'The city does not own this land yet. Buy it first.' };
    if (t.kind !== 'land') return { ok: false, reason: 'You can only build on land plots.' };
    if (t.building && t.building.type !== 'tree') return { ok: false, reason: 'This plot is taken.' };
    if (def.canBuild !== 'all' && !def.canBuild.includes(t.district))
      return { ok: false, reason: `${def.name} can only be built in: ${def.canBuild.map(x => D.DISTRICTS[x].name).join(', ')}.` };
    if (def.unique && countBuildings(s, type, null, { includeUnfinished: true }) > 0) return { ok: false, reason: `The city already has a ${def.name.toLowerCase()}.` };
    return { ok: true };
  }

  function place(s, type, c, r) {
    const check = canPlace(s, type, c, r);
    if (!check.ok) return check;
    const def = D.BUILDINGS[type], t = tileAt(s, c, r);
    s.money -= def.cost;
    if (def.special === 'bridge') {
      s.bridgeLeft = def.months;
      eachTile(s, x => { if (x.kind === 'bridgeSite') x.kind = 'bridgeBuilding'; });
      s.spendYear.millbrook += def.cost * 0.6; s.spendYear.market += def.cost * 0.4;
      s.districts.millbrook.rentPressure += D.RENT_PRESSURE_PER_UPGRADE;
      addNews(s, `Construction of the second bridge started (${def.months} months).`);
    } else if (def.upgradeOf) {
      t.building.filtered = def.months;
      addNews(s, 'Filters ordered for a factory. Industry Association grumbles about costs.');
    } else {
      t.building = makeBuilding(type, def.months, Math.random);
      addNews(s, `${def.name} under construction in ${D.DISTRICTS[t.district].name} (${def.months} month${def.months > 1 ? 's' : ''}).`);
      if (t.district === 'millbrook' && RENT_RAISERS.includes(type)) s.districts.millbrook.rentPressure += D.RENT_PRESSURE_PER_UPGRADE;
      if (type === 'factory') s.mods.ironworks += 2;
      s.spendYear[t.district] += def.cost * (ATTENTION[type] ?? 1);
    }
    compute(s);
    return { ok: true };
  }

  // Bus lines: two stops, each next to a road
  function canPlaceStop(s, c, r, other) {
    const t = tileAt(s, c, r);
    if (!t) return { ok: false, reason: 'Outside the map.' };
    if (s.phase !== 'playing') return { ok: false, reason: 'Not now.' };
    if (s.money - D.BUILDINGS.bus.cost < D.DEBT_LIMIT) return { ok: false, reason: 'Not enough money (debt limit reached).' };
    if (!t.owned || t.kind !== 'land') return { ok: false, reason: 'A bus stop needs a free plot in the city.' };
    if (t.building && t.building.type !== 'tree') return { ok: false, reason: 'This plot is taken.' };
    if (!neighbours(s, t).some(n => n.kind === 'road' || n.kind === 'bridge')) return { ok: false, reason: 'A bus stop must be next to a road.' };
    const gap = D.BUS_STOP_GAP;
    const near = (x, y) => Math.max(Math.abs(x - c), Math.abs(y - r)) <= gap;
    if (other && near(other.c, other.r)) return { ok: false, reason: `Bus stops need at least ${gap} tiles between them.` };
    for (let dr = -gap; dr <= gap; dr++) for (let dc = -gap; dc <= gap; dc++) {
      const n = tileAt(s, c + dc, r + dr);
      if (n && n.building && n.building.type === 'busstop') return { ok: false, reason: `Too close to another bus stop: keep ${gap} tiles between stops.` };
    }
    return { ok: true };
  }

  function placeBusLine(s, a, b) {
    { const ch = canPlaceStop(s, a.c, a.r); if (!ch.ok) return ch; }
    { const ch = canPlaceStop(s, b.c, b.r, a); if (!ch.ok) return ch; }
    if (a.c === b.c && a.r === b.r) return { ok: false, reason: 'The two stops must be in different places.' };
    const def = D.BUILDINGS.bus;
    const ta = tileAt(s, a.c, a.r), tb = tileAt(s, b.c, b.r);
    const id = s.nextLineId++;
    const cross = bank(ta) !== bank(tb);
    s.lines.push({ id, a: { c: a.c, r: a.r }, b: { c: b.c, r: b.r }, buildLeft: def.months, cross });
    for (const t of [ta, tb]) {
      t.building = { type: 'busstop', line: id, buildLeft: def.months };
      s.spendYear[t.district] += def.cost / 2;
      if (t.district === 'millbrook') s.districts.millbrook.rentPressure += D.RENT_PRESSURE_PER_UPGRADE / 2;
    }
    s.money -= def.cost;
    addNews(s, cross ? 'A bus line across the river is being set up (1 month).' : 'A bus line is being set up (1 month).');
    compute(s);
    return { ok: true, cross };
  }

  // Shortest path along roads and bridges between two road tiles (used for vehicles).
  function roadPath(s, from, to) {
    const key = t => t.c + ',' + t.r;
    const isRoad = t => t && (t.kind === 'road' || t.kind === 'bridge');
    const start = tileAt(s, from.c, from.r), goal = tileAt(s, to.c, to.r);
    if (!isRoad(start) || !isRoad(goal)) return null;
    const prev = new Map([[key(start), null]]);
    const queue = [start];
    while (queue.length) {
      const t = queue.shift();
      if (t === goal) break;
      for (const n of neighbours(s, t)) if (isRoad(n) && !prev.has(key(n))) { prev.set(key(n), t); queue.push(n); }
    }
    if (!prev.has(key(goal))) return null;
    const path = [];
    for (let t = goal; t; t = prev.get(key(t))) path.unshift({ c: t.c, r: t.r });
    return path;
  }
  function roadNextTo(s, c, r) {
    const t = tileAt(s, c, r);
    return t ? neighbours(s, t).find(n => n.kind === 'road' || n.kind === 'bridge') || null : null;
  }
  function roadTiles(s) { const out = []; eachTile(s, t => { if (t.kind === 'road' || t.kind === 'bridge') out.push(t); }); return out; }

  // Land
  function landPrice(s) { return D.LAND_PRICE + D.LAND_PRICE_STEP * s.landBought; }
  function canBuyLand(s, c, r) {
    const t = tileAt(s, c, r);
    if (!t) return { ok: false, reason: 'Outside the map.' };
    if (s.phase !== 'playing') return { ok: false, reason: 'Not now.' };
    if (t.owned) return { ok: false, reason: 'The city already owns this land.' };
    if (t.kind === 'river') return { ok: false, reason: 'You cannot buy the river.' };
    if (!neighbours(s, t).some(n => n.owned && n.kind !== 'river')) return { ok: false, reason: 'Land must border the city.' };
    if (s.money - landPrice(s) < D.DEBT_LIMIT) return { ok: false, reason: 'Not enough money (debt limit reached).' };
    return { ok: true, price: landPrice(s) };
  }
  function buyLand(s, c, r) {
    const ch = canBuyLand(s, c, r);
    if (!ch.ok) return ch;
    const t = tileAt(s, c, r);
    s.money -= ch.price;
    t.owned = true;
    if (onRoadLine(c, r)) { t.kind = 'road'; t.building = null; }
    else if (t.building && t.building.type === 'wildtree') t.building = { type: 'tree', buildLeft: 0 };
    s.landBought++; s.yearCount.land++;
    s.spendYear[t.district] += ch.price * 0.5;
    compute(s);
    return { ok: true };
  }

  function setTax(s, kind, id, value) { s.taxes[kind][id] = clamp(Math.round(value * 100) / 100, D.MIN_TAX, D.MAX_TAX); compute(s); }
  function setRentCap(s, on) {
    s.policies.rentCap = on;
    addNews(s, on ? 'Rent cap introduced in Millbrook. Landlords and businesses complain.' : 'Rent cap removed.');
    compute(s);
  }

  // Yearly goals
  function challengeAvailable(s, id) {
    switch (id) {
      case 'smoke': return s.emissions >= 15;
      case 'bridge': return !s.bridge2 && typeof s.bridgeLeft !== 'number';
      case 'lowtax': return s.taxes.bus.ironworks > 0.0801 || s.taxes.bus.market > 0.0801;
      case 'clean': return s.coalShare > 0.01;
      case 'river': return !s.riverClean && countBuildings(s, 'water', null, { includeUnfinished: true }) === 0;
      case 'jobs': return s.districts.millbrook.employment < 0.85;
      case 'restax': return s.taxes.res.millbrook > 0.0801;
      case 'expand': { let any = false; eachTile(s, t => { if (!any && !t.owned && t.kind !== 'river' && neighbours(s, t).some(n => n.owned && n.kind !== 'river')) any = true; }); return any; }
      default: return true;
    }
  }

  function pickChallenges(s, ids) {
    s.chosen = ids.map(id => ({ id, status: 'active' }));
    for (const id of ids) {
      const ch = D.CHALLENGES.find(c => c.id === id);
      for (const d in ch.reactions) s.districts[d].approval = clamp(s.districts[d].approval + ch.reactions[d] * 0.5, 0, 100);
    }
    s.phase = 'playing';
    addNews(s, 'Your goals for the year are set. The city is watching.');
    compute(s);
  }

  function challengeProgress(s, id) {
    const yc = s.yearCount;
    switch (id) {
      case 'smoke': { const target = s.yearStart.emissions * 0.75; return { done: s.emissions <= target + 1e-6, text: `Emissions ${Math.round(s.emissions)} / target ${Math.round(target)}` }; }
      case 'busline': return { done: yc.crossLines >= 1, text: yc.crossLines ? 'Line across the river open' : 'No new line across the river yet' };
      case 'bridge': return { done: s.bridge2, text: s.bridge2 ? 'Bridge open' : typeof s.bridgeLeft === 'number' ? `Under construction (${s.bridgeLeft} months left)` : 'Not started' };
      case 'lowtax': return { done: s.taxes.bus.ironworks <= 0.0801 && s.taxes.bus.market <= 0.0801, text: `Ironworks ${Math.round(s.taxes.bus.ironworks * 100)}%, Market ${Math.round(s.taxes.bus.market * 100)}%` };
      case 'parks': return { done: yc.parks >= 2, text: `Parks finished: ${yc.parks} / 2` };
      case 'shops': return { done: s.shops.closed === 0, text: `Closed shops: ${s.shops.closed}` };
      case 'housing': return { done: yc.social >= 1, text: `Social housing finished: ${yc.social} / 1` };
      case 'school': return { done: yc.school >= 1, text: `Schools finished: ${yc.school} / 1` };
      case 'clean': return { done: yc.clean >= 2, text: `Clean energy projects: ${yc.clean} / 2` };
      case 'river': return { done: s.riverClean, text: s.riverClean ? 'River is clean' : countBuildings(s, 'water', null, { includeUnfinished: true }) ? 'Plant under construction' : 'Not started' };
      case 'grow': { const g = totalResidents(s) - s.yearStart.residents; return { done: g >= 500, text: `Growth: ${g >= 0 ? '+' : ''}${g} / +500 residents` }; }
      case 'jobs': return { done: s.districts.millbrook.employment >= 0.85, text: `Millbrook employment ${Math.round(s.districts.millbrook.employment * 100)}% / 85%` };
      case 'expand': return { done: yc.land >= 6, text: `Land bought: ${yc.land} / 6 tiles` };
      case 'restax': return { done: s.taxes.res.millbrook <= 0.0801, text: `Millbrook tax ${Math.round(s.taxes.res.millbrook * 100)}%` };
    }
    return { done: false, text: '' };
  }

  // Build-type promises are rewarded as soon as they are finished.
  const LOCKING = ['busline', 'bridge', 'parks', 'housing', 'school', 'clean', 'river', 'expand'];
  function checkPromises(s) {
    for (const ch of s.chosen) {
      if (ch.status !== 'active' || !LOCKING.includes(ch.id)) continue;
      if (challengeProgress(s, ch.id).done) {
        ch.status = 'kept';
        const def = D.CHALLENGES.find(c => c.id === ch.id);
        for (const d in def.reactions) if (def.reactions[d] > 0) s.mods[d] += def.reactions[d];
        addNews(s, `Promise kept: ${def.title}. Supporters are pleased.`, 'good');
      }
    }
    compute(s);
  }

  // Events
  function resolveEvent(s, effect) {
    const m = s.mods;
    const firstFactory = pred => { let f = null; eachTile(s, t => { if (!f && t.building && t.building.type === 'factory' && t.building.buildLeft === 0 && pred(t.building)) f = t; }); return f; };
    switch (effect) {
      case 'factoryStay':
        s.taxes.bus.ironworks = clamp(s.taxes.bus.ironworks - 0.03, D.MIN_TAX, D.MAX_TAX);
        m.ironworks += 8; m.millbrook -= 3;
        addNews(s, 'Ironworks business tax cut. The factory stays.');
        break;
      case 'factoryLeave': {
        const f = firstFactory(b => b.filtered !== true) || firstFactory(() => true);
        if (f) f.building = null;
        m.ironworks -= 12;
        addNews(s, 'The factory closed and moved abroad: 300 jobs lost, but less smoke.', 'bad');
        break;
      }
      case 'luxuryYes':
        s.money += 150; s.districts.millbrook.rentPressure += 25;
        m.elmwood += 4; m.market += 5; m.millbrook -= 10;
        addNews(s, 'Luxury flats approved on the Millbrook riverbank. Rents start rising.', 'bad');
        break;
      case 'luxuryNo': m.market -= 4; m.millbrook += 5; addNews(s, 'Riverbank stays public. Tenants cheer, developers grumble.'); break;
      case 'heatFund': s.money -= 120; m.millbrook += 3; addNews(s, 'Emergency care funded during the heat wave.', 'good'); break;
      case 'heatNothing':
        for (const id in s.districts) s.healthPenalty[id] = s.districts[id].pollution * 0.5;
        m.millbrook -= 6; m.ironworks -= 3;
        addNews(s, 'The heat wave hit polluted districts hardest. Many people fell ill.', 'bad');
        break;
      case 'lobbyYes':
        s.money += 120; s.taxes.bus.market = clamp(s.taxes.bus.market - 0.02, D.MIN_TAX, D.MAX_TAX);
        m.market += 6; m.millbrook -= 5; m.elmwood -= 1;
        addNews(s, 'You took the Business Council\'s money. Tenants call it a backroom deal.', 'bad');
        break;
      case 'lobbyNo': m.market -= 3; m.millbrook += 2; addNews(s, 'You turned down the Business Council\'s offer.'); break;
      case 'festivalYes': s.money -= 80; m.millbrook += 5; m.market += 2; addNews(s, 'The Millbrook street festival was a hit.', 'good'); break;
      case 'festivalNo': m.millbrook -= 2; addNews(s, 'No festival this year in Millbrook.'); break;
      case 'strikeFilter': {
        const f = firstFactory(b => b.filtered !== true);
        s.money -= 100;
        if (f) f.building.filtered = true;
        m.ironworks -= 3; m.millbrook += 4;
        addNews(s, 'The city paid for filters. Workers go back to work breathing cleaner air.', 'good');
        break;
      }
      case 'strikeOwners': m.ironworks += 4; m.millbrook -= 6; addNews(s, 'The strike ended without changes. Tenants are angry.', 'bad'); break;
      case 'fireCrews': {
        let wh = null;
        eachTile(s, t => { if (!wh && t.district === 'ironworks' && t.building && t.building.type === 'warehouse') wh = t; });
        if (countBuildings(s, 'fire', 'ironworks')) {
          m.ironworks += 3;
          addNews(s, 'The Ironworks fire station put the fire out within minutes. Industry thanks the city.', 'good');
        } else if (countBuildings(s, 'fire')) {
          s.money -= 40; m.ironworks -= 2;
          addNews(s, 'Fire crews came from across the city. The warehouse was saved, but repairs cost 40k€.');
        } else {
          if (wh) wh.building = null;
          s.money -= 60; m.ironworks -= 6;
          addNews(s, 'With no fire station, a warehouse burned down. Industry blames the city.', 'bad');
        }
        break;
      }
      case 'coalPay': {
        const bill = Math.round(120 * s.coalShare);
        s.money -= bill;
        addNews(s, bill > 0 ? `The coal bill cost the city ${bill}k€. Clean energy would have saved it.` : 'The coal price jump did not hurt: the city runs on clean energy.', bill > 60 ? 'bad' : 'good');
        break;
      }
    }
    s.pendingEvent = null;
    s.phase = 'playing';
    compute(s);
  }

  // Election
  function runElection(s) {
    const outcomes = [];
    for (const ch of s.chosen) {
      const def = D.CHALLENGES.find(c => c.id === ch.id);
      if (ch.status === 'kept') { outcomes.push({ title: def.title, kept: true }); continue; }
      const p = challengeProgress(s, ch.id);
      ch.status = p.done ? 'kept' : 'broken';
      for (const d in def.reactions) {
        const r = def.reactions[d];
        if (r <= 0) continue;
        s.districts[d].approval = clamp(s.districts[d].approval + (p.done ? r : -r * 1.2), 0, 100);
      }
      outcomes.push({ title: def.title, kept: p.done });
    }
    const rows = [];
    let yes = 0, total = 0;
    for (const id of D.DISTRICT_ORDER) {
      const d = s.districts[id];
      const support = clamp(d.approval / 100 - s.rival.appeal[id], 0.05, 0.95);
      const turnout = 0.45 + 0.35 * Math.abs(d.approval - 50) / 50;
      const voters = d.residents * turnout;
      yes += voters * support; total += voters;
      rows.push({ id, name: D.DISTRICTS[id].name, voters: Math.round(voters), support, approval: d.approval });
    }
    const share = yes / total;
    const won = share > 0.5;
    if (won) s.yearsWon++;
    const final = won && s.mode === 'challenge' && s.yearIndex >= D.MODES.challenge.years;
    s.result = { type: won ? 'won' : 'lost', share, rows, outcomes, card: reportCard(s), final, year: s.year, rival: s.rival.name };
    s.results.push({ year: s.year, share, won });
    s.phase = won && !final ? 'yearEnd' : 'over';
    logHistory(s);
    return s.result;
  }

  function grade(v, cuts) { const g = ['A', 'B', 'C', 'D']; for (let i = 0; i < 4; i++) if (v >= cuts[i]) return g[i]; return 'F'; }
  function reportCard(s) {
    const m = s.districts.millbrook;
    const items = [
      { name: 'Fairness between districts', value: `gap ${s.inequality.toFixed(1)} (start ${s.inequalityStart.toFixed(1)})`, g: grade(-s.inequality, [-10, -15, -20, -26]) },
      { name: 'Air quality in Millbrook', value: `${Math.round(m.air)} / 100`, g: grade(m.air, [85, 75, 65, 55]) },
      { name: 'Clean energy', value: `${Math.round((1 - s.coalShare) * 100)}% of power from solar and wind`, g: grade(1 - s.coalShare, [0.8, 0.6, 0.4, 0.2]) },
      { name: 'Affordable housing in Millbrook', value: `${Math.round(m.housing)} / 100`, g: grade(m.housing, [75, 65, 55, 45]) },
      { name: 'Jobs in Millbrook', value: `${Math.round(m.employment * 100)}% employed`, g: grade(m.employment, [0.92, 0.85, 0.78, 0.7]) },
      { name: 'Local shops', value: `${s.shops.open} open, ${s.shops.sale} struggling, ${s.shops.closed} closed`, g: grade(-s.shops.closed, [0, -1, -3, -5]) },
      { name: 'City budget', value: `${Math.round(s.money)} k€`, g: grade(s.money, [500, 200, 0, -200]) },
    ];
    const ending = s.inequality < s.inequalityStart - 1 ? 'Common Ground' : 'Divided City';
    return { items, ending, population: totalResidents(s) };
  }

  // Data log
  function logHistory(s) {
    const row = {
      mode: s.mode, year: s.year, month: D.MONTHS[s.month], money: Math.round(s.money), net: Math.round(s.lastNet),
      emissions: s.emissions.toFixed(1), clean_share: (1 - s.coalShare).toFixed(2), inequality: s.inequality.toFixed(1),
      land_bought: s.landBought, bus_lines: s.busLines,
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
    newGame, startNextYear, compute, endMonth, canPlace, place, canPlaceStop, placeBusLine, roadPath, roadNextTo, roadTiles,
    landPrice, canBuyLand, buyLand, setTax, setRentCap, pickChallenges, challengeProgress, resolveEvent, runElection,
    historyCSV, countBuildings, addNews, districtOf, totalResidents, bank,
  };
})();
