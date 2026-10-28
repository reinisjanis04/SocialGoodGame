// Common Ground - game data
// All numbers that control the game live in this file, so the game can be rebalanced without touching the logic. Money is in thousands of euros (k€).

const DATA = {
  // ---------- Time ----------
  // Real seconds per in-game month at 1x speed (the design says about 1 minute).
  SECONDS_PER_MONTH: 60,
  SPEEDS: [0, 1, 2, 4, 16],          // 16x is a debug speed for demos
  MONTHS: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
           'August', 'September', 'October', 'November', 'December'],
  START_YEAR: 2027,
  YEARS_IN_PROTOTYPE: 1,             // the prototype plays one year

  // ---------- Map ----------
  MAP_SIZE: 20,                      // 20 x 20 tiles
  TILE_W: 64,
  TILE_H: 32,
  RIVER_ROWS: [9, 10],
  ROAD_COLS: [9, 15],
  ROAD_ROWS: [4, 15],
  OLD_BRIDGE_COL: 9,                 // the existing bridge
  NEW_BRIDGE_COL: 15,                // where the second bridge can be built

  // ---------- Economy ----------
  START_MONEY: 600,
  DEBT_LIMIT: -400,                  // below this for 3 months = bankruptcy
  BANKRUPT_MONTHS: 3,
  BASE_UPKEEP: 500,                  // city services, salaries etc. per month
  RES_TAX_FACTOR: 0.1,               // residents * income * taxRate * factor
  DEFAULT_RES_TAX: 0.10,
  DEFAULT_BUS_TAX: 0.10,
  MIN_TAX: 0.04,
  MAX_TAX: 0.20,

  // ---------- Districts ----------
  // Order matters: it is used for UI cards.
  DISTRICTS: {
    elmwood: {
      name: 'Elmwood Heights', type: 'High-income housing',
      faction: "Homeowners' Association", short: 'Homeowners',
      residents: 2500, income: 4.0, color: 0x7fb069,
    },
    market: {
      name: 'Market Quarter', type: 'Business district',
      faction: 'Business Council', short: 'Business',
      residents: 1000, income: 3.0, color: 0xd9a441,
    },
    ironworks: {
      name: 'Ironworks', type: 'Industry',
      faction: 'Industry Association', short: 'Industry',
      residents: 1500, income: 1.2, color: 0x8d8d8d,
    },
    millbrook: {
      name: 'Millbrook', type: 'Low-income housing',
      faction: "Tenants' Union", short: 'Tenants',
      residents: 5000, income: 1.0, color: 0xc06c5b,
    },
  },
  DISTRICT_ORDER: ['millbrook', 'elmwood', 'ironworks', 'market'],

  // ---------- Buildings ----------
  // cost: one-off build cost, upkeep: per month, months: build time.
  // canBuild: districts where the player may place it ('all' = any land plot).
  BUILDINGS: {
    // existing city buildings (not in the build menu)
    villa:   { name: 'Family homes', existing: true },
    flats:   { name: 'Apartment block', existing: true },
    factory: { name: 'Factory', existing: true, emission: 10, jobs: 300, businessBase: 250 },
    coal:    { name: 'Coal power plant', existing: true, emission: 22, jobs: 300, businessBase: 200 },
    office:  { name: 'Office building', existing: true, jobs: 200, businessBase: 120 },
    warehouse: { name: 'Warehouse', existing: true, jobs: 10, businessBase: 6 },
    shop:    { name: 'Shop', jobs: 80, businessBase: 60, cost: 120, upkeep: 0, months: 1,
               canBuild: ['market', 'millbrook', 'elmwood'], menu: true,
               desc: 'Adds jobs and business tax, if it has customers.' },
    tree:    { name: 'Trees', existing: true },

    // player buildings
    park:    { name: 'Park', cost: 150, upkeep: 5, months: 2, canBuild: 'all', menu: true,
               desc: 'Cleaner air and happier residents nearby. Raises rents a little.' },
    clinic:  { name: 'Clinic', cost: 300, upkeep: 15, months: 2, canBuild: 'all', menu: true,
               desc: 'Improves health in its district.' },
    social:  { name: 'Social housing', cost: 250, upkeep: 5, months: 3, canBuild: ['millbrook', 'ironworks'], menu: true,
               desc: 'Homes for 300 people and lower rent pressure. Homeowners dislike it.' },
    bus:     { name: 'Bus line', cost: 200, upkeep: 12, months: 1, canBuild: ['millbrook', 'ironworks'], menu: true,
               desc: 'Connects the south bank to jobs in the north. Less traffic.' },
    solar:   { name: 'Solar field', cost: 400, upkeep: 5, months: 3, canBuild: ['ironworks'], menu: true,
               desc: 'Replaces 25% of coal power. Less smoke, slightly pricier energy.' },
    filter:  { name: 'Factory filter', cost: 200, upkeep: 5, months: 1, upgradeOf: 'factory', menu: true,
               desc: 'Click a factory: cuts its smoke by 60%. Industry is not happy.' },
    bridge:  { name: 'Second bridge', cost: 900, upkeep: 10, months: 4, special: 'bridge', menu: true,
               desc: 'Build on the marked river crossing. Big boost to jobs access.' },
  },

  // ---------- Simulation constants ----------
  POLLUTION_SPREAD: { ironworks: 0.55, millbrook: 0.42, market: 0.08, elmwood: 0.03 }, // wind blows east
  POLLUTION_SCALE: 1.0,
  TRAFFIC_POLLUTION: { market: 12, elmwood: 4, millbrook: 6, ironworks: 4 },
  BUS_TRAFFIC_CUT: 4,
  PARK_AIR_BONUS: 6,
  FILTER_CUT: 0.6,
  SOLAR_SHARE: 0.25,
  CLINIC_HEALTH: 22,
  PARK_GREEN: 18,
  BASE_GREEN: { elmwood: 60, market: 25, ironworks: 10, millbrook: 15 },
  BASE_SERVICES: { elmwood: 70, market: 60, ironworks: 35, millbrook: 30 },
  WORKER_SHARE: 0.55,
  SOUTH_ACCESS_BASE: 0.25,   // share of north-bank jobs reachable from the south over the old bridge
  BUS_ACCESS: 0.2,
  BRIDGE_ACCESS: 0.3,
  RENT_PRESSURE_PER_UPGRADE: 9,
  RENT_DECAY: 0.04,
  RENT_CAP_MAX: 35,
  MOVE_OUT_THRESHOLD: 60,
  MOVE_OUT_RATE: 0.015,
  SOCIAL_HOUSING_PEOPLE: 300,
  APPROVAL_SMOOTHING: 0.35,
  SHOP_OPEN: 60,
  SHOP_CLOSED: 35,
  SHOP_REOPEN: 52,

  // ---------- Yearly challenges (pick 3 in January) ----------
  // reactions: change in each faction's approval when the challenge is chosen.
  // Kept: those reactions again as a bonus. Failed: factions that wanted it get angry.
  CHALLENGES: [
    { id: 'smoke', title: 'Cut factory smoke by 25%',
      desc: 'Total city emissions at most 75% of January level.',
      reactions: { millbrook: 8, elmwood: 3, ironworks: -10, market: 0 } },
    { id: 'busline', title: 'Open a bus line from the south bank',
      desc: 'Build at least one bus line.',
      reactions: { millbrook: 6, elmwood: -2, ironworks: 2, market: 5 } },
    { id: 'bridge', title: 'Build a second bridge',
      desc: 'Finish the second bridge across the river.',
      reactions: { millbrook: 6, elmwood: -4, ironworks: 3, market: 6 } },
    { id: 'lowtax', title: 'Lower business tax to 8%',
      desc: 'Business tax at most 8% in both Ironworks and Market Quarter.',
      reactions: { millbrook: -5, elmwood: 3, ironworks: 8, market: 8 } },
    { id: 'parks', title: 'Build two new parks',
      desc: 'Finish two parks this year, anywhere in the city.',
      reactions: { millbrook: 3, elmwood: 6, ironworks: 0, market: 2 } },
    { id: 'shops', title: 'No closed shops in December',
      desc: 'Every shop open (or on sale) at the end of the year.',
      reactions: { millbrook: 2, elmwood: 1, ironworks: 0, market: 7 } },
    { id: 'housing', title: 'Build social housing',
      desc: 'Finish at least one social housing block.',
      reactions: { millbrook: 8, elmwood: -5, ironworks: 2, market: -2 } },
  ],
  CHALLENGES_OFFERED: 7,
  CHALLENGES_TO_PICK: 3,

  // ---------- Events ----------
  // month: 0-based month index when the event fires.
  EVENTS: [
    { month: 3, id: 'factory_leave', title: 'A factory threatens to leave',
      text: 'The owner of the Ironworks steel mill says taxes are too high and threatens to move abroad, taking 300 jobs.',
      options: [
        { label: 'Cut Ironworks business tax by 3%', effect: 'factoryStay' },
        { label: 'Refuse. The city will not be blackmailed.', effect: 'factoryLeave' },
      ] },
    { month: 6, id: 'luxury', title: 'Luxury flats on the Millbrook riverbank',
      text: 'A developer offers the city 400k€ to build luxury flats on the Millbrook riverside. Rents nearby would rise.',
      options: [
        { label: 'Approve the flats (+400k€)', effect: 'luxuryYes' },
        { label: 'Refuse and keep the riverbank public', effect: 'luxuryNo' },
      ] },
    { month: 8, id: 'heatwave', title: 'Heat wave',
      text: 'A heat wave hits Northhaven. Clinics are overloaded, especially where the air is bad.',
      options: [
        { label: 'Fund emergency care (-120k€)', effect: 'heatFund' },
        { label: 'Do nothing', effect: 'heatNothing' },
      ] },
  ],

  // ---------- Rival ----------
  RIVAL: { name: 'The Builder', appeal: { elmwood: 0.06, ironworks: 0.08, market: 0.03, millbrook: 0.0 } },
};
