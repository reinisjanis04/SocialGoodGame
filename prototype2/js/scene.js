class CityScene extends Phaser.Scene {
  constructor() { super('city'); }

  tileXY(c, r) { return { x: (c - r) * (DATA.TILE_W / 2), y: (c + r) * (DATA.TILE_H / 2) }; }
  worldToTile(wx, wy) {
    const a = wx / (DATA.TILE_W / 2), b = wy / (DATA.TILE_H / 2);
    return { c: Math.floor((a + b) / 2), r: Math.floor((b - a) / 2) };
  }
  depthAt(c, r) { return 100 + (c + r) * 2 + c * 0.001; }

  create() {
    this.state = GAME.state;
    ART.makeAll(this);
    const N = DATA.MAP_SIZE;
    this.ground = [];
    this.buildings = {};
    this.signs = {};
    this.blades = {};
    this.smog = [];
    this.protests = {};
    this.emitters = [];
    this.vehicles = [];
    this.buses = {};
    this.marks = [];
    this.monthClock = 0;
    this.riverFrame = 0;
    this.smogMap = {};

    for (let r = 0; r < N; r++) {
      this.ground.push([]);
      for (let c = 0; c < N; c++) {
        const { x, y } = this.tileXY(c, r);
        this.ground[r].push(this.add.image(x, y, 'ground_wild').setOrigin(0.5, 0).setDepth(0));
      }
    }
    this.cursor = this.add.image(0, 0, 'cursor').setOrigin(0.5, 0).setDepth(4000).setVisible(false);
    this.firstStopMark = this.add.image(0, 0, 'stopmark').setOrigin(0.5, 0).setDepth(3950).setAlpha(0.7).setVisible(false);

    const cam = this.cameras.main;
    cam.setBackgroundColor('#26343d');
    const mid = (DATA.CORE_MIN + DATA.CORE_MAX) / 2;
    const cpos = this.tileXY(mid, mid);
    cam.centerOn(cpos.x, cpos.y + 16);
    cam.setZoom(this.scale.width < 900 ? 0.55 : 0.8);
    this.onResize = size => this.cameras.resize(size.width, size.height);
    this.scale.on('resize', this.onResize);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize));

    this.setupInput();
    this.refresh();

    this.time.addEvent({ delay: 420, loop: true, callback: () => this.shimmer() });
    this.time.addEvent({ delay: 380, loop: true, callback: () => this.emitSmoke() });
    this.time.addEvent({ delay: 1100, loop: true, callback: () => this.spawnCar() });

    GAME.scene = this;
    UI.onSceneReady();
  }

  // Input
  setupInput() {
    const cam = this.cameras.main;
    this.input.on('pointerdown', p => { this.downAt = { x: p.x, y: p.y }; this.dragging = false; });
    this.input.on('pointermove', p => {
      if (p.isDown && this.downAt) {
        if (Math.abs(p.x - this.downAt.x) + Math.abs(p.y - this.downAt.y) > 6) this.dragging = true;
        if (this.dragging) { cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom; cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom; }
      }
      this.hover(p);
    });
    this.input.on('pointerup', p => { if (!this.dragging && p.button === 0) this.click(p); this.dragging = false; this.downAt = null; });
    this.input.on('wheel', (p, objs, dx, dy) => cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.3, 2.2)));
    this.input.on('gameout', () => { this.cursor.setVisible(false); UI.hoverTile(null); });
  }
  tileAtPointer(p) {
    const { c, r } = this.worldToTile(p.worldX, p.worldY);
    const row = this.state.tiles[r];
    return row ? row[c] || null : null;
  }
  hover(p) {
    const t = this.tileAtPointer(p);
    if (!t) { this.cursor.setVisible(false); UI.hoverTile(null); return; }
    const { x, y } = this.tileXY(t.c, t.r);
    this.cursor.setPosition(x, y).setVisible(true);
    const mode = UI.buildMode;
    if (mode) this.cursor.setTint(UI.canUseTool(t) ? 0x7dff8a : 0xff6b6b); else this.cursor.clearTint();
    UI.hoverTile(t, p);
  }
  click(p) {
    const t = this.tileAtPointer(p);
    if (!t) return;
    if (UI.buildMode) UI.useTool(t); else UI.selectTile(t);
  }

  // Clock and vehicles
  update(time, delta) {
    const s = this.state;
    if (s.phase === 'playing' && GAME.speed > 0) {
      this.monthClock += delta * GAME.speed;
      const monthMs = DATA.SECONDS_PER_MONTH * 1000;
      UI.setMonthProgress(this.monthClock / monthMs);
      if (this.monthClock >= monthMs) { this.monthClock = 0; GAME.endMonth(); }
    }
    const k = (GAME.speed > 0 ? Math.min(GAME.speed, 4) : 0) * delta / 1000;
    for (const v of this.vehicles.slice()) this.moveVehicle(v, k);
  }

  // A vehicle follows a list of tile centres. Bus lines go back and forth.
  addVehicle(path, keyBase, opts = {}) {
    if (!path || path.length < 2) return null;
    const pts = path.map(p => { const { x, y } = this.tileXY(p.c, p.r); return { x, y: y + 16, c: p.c, r: p.r }; });
    const spr = this.add.image(pts[0].x, pts[0].y, keyBase + '_c');
    if (keyBase === 'bus') spr.setOrigin(26 / 56, 30 / 48); else spr.setOrigin(0.5, 24 / 34);
    const v = { spr, pts, i: 0, d: 0, keyBase, speed: opts.speed || 42, pingpong: !!opts.pingpong, wait: 0, dir: 1, kind: opts.kind || 'car' };
    this.vehicles.push(v);
    this.placeVehicle(v);
    return v;
  }
  placeVehicle(v) {
    const a = v.pts[v.i], b = v.pts[v.i + v.dir] || a;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(1, v.d / len);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const alongC = a.c !== b.c;
    // keep to the right-hand lane
    const sgn = alongC ? (b.c > a.c ? 1 : -1) : (b.r > a.r ? 1 : -1);
    const off = alongC ? { x: -3 * sgn, y: 6 * sgn } : { x: -3 * sgn, y: -6 * sgn };
    v.spr.setPosition(x + off.x * 0.6, y + off.y * 0.5);
    v.spr.setTexture(v.keyBase + (alongC ? '_c' : '_r'));
    v.spr.setDepth(100 + (y / 16) * 2 + 0.6);
    return len;
  }
  moveVehicle(v, k) {
    if (v.wait > 0) { v.wait -= k; return; }
    let step = v.speed * k;
    while (step > 0) {
      const a = v.pts[v.i], b = v.pts[v.i + v.dir];
      if (!b) {
        if (v.pingpong) { v.dir = -v.dir; v.wait = 1.4; v.d = 0; return; }
        this.removeVehicle(v); return;
      }
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (v.d + step < len) { v.d += step; step = 0; }
      else { step -= len - v.d; v.d = 0; v.i += v.dir; }
    }
    this.placeVehicle(v);
  }
  removeVehicle(v) { v.spr.destroy(); this.vehicles = this.vehicles.filter(x => x !== v); }

  spawnCar() {
    const s = this.state;
    const roads = SIM.roadTiles(s);
    const cars = this.vehicles.filter(v => v.kind === 'car').length;
    const cap = Math.max(3, Math.round(roads.length / 8) - s.busLines * 2);
    if (cars >= cap || roads.length < 2) return;
    const a = Phaser.Utils.Array.GetRandom(roads), b = Phaser.Utils.Array.GetRandom(roads);
    const path = SIM.roadPath(s, a, b);
    if (!path || path.length < 4) return;
    this.addVehicle(path, 'car_' + Phaser.Utils.Array.GetRandom(['red', 'blue', 'white', 'yellow', 'green']), { speed: 38 + Math.random() * 14 });
  }

  syncBuses() {
    const s = this.state;
    const want = new Set(s.lines.filter(l => l.buildLeft === 0).map(l => l.id));
    for (const id of Object.keys(this.buses)) if (!want.has(+id)) { this.removeVehicle(this.buses[id]); delete this.buses[id]; }
    for (const l of s.lines) {
      if (l.buildLeft > 0 || this.buses[l.id]) continue;
      const ra = SIM.roadNextTo(s, l.a.c, l.a.r), rb = SIM.roadNextTo(s, l.b.c, l.b.r);
      if (!ra || !rb) continue;
      let path = SIM.roadPath(s, ra, rb);
      if (path && path.length === 1) path = [path[0], path[0]];
      const v = this.addVehicle(path, 'bus', { pingpong: true, speed: 34, kind: 'bus' });
      if (v) this.buses[l.id] = v;
    }
  }

  spawnTruck() {
    const s = this.state;
    const roads = SIM.roadTiles(s).filter(t => t.district === 'millbrook');
    if (!roads.length) return;
    const exit = SIM.roadTiles(s).filter(t => t.r === DATA.ROAD_ROWS[1]).sort((a, b) => b.c - a.c)[0];
    const path = SIM.roadPath(s, Phaser.Utils.Array.GetRandom(roads), exit);
    this.addVehicle(path, 'truck', { speed: 46, kind: 'truck' });
  }

  // Drawing
  groundKey(t) {
    const w = this.state.riverClean ? 'c' : 'd';
    switch (t.kind) {
      case 'river': {
        // each tile runs its own phase, so ripples never all change at once
        const f = (this.riverFrame + ((t.c * 7 + t.r * 3) % ART.RIVER_FRAMES)) % ART.RIVER_FRAMES;
        return `river_${w}_${t.r === DATA.RIVER_ROWS[0] ? 'top' : 'bot'}_${f}`;
      }
      case 'bridge': return 'bridge_done_' + w;
      case 'bridgeSite': return 'bridge_site_' + w;
      case 'bridgeBuilding': return 'bridge_building_' + w;
      case 'road': {
        const onRow = DATA.ROAD_ROWS.includes(t.r), onCol = DATA.ROAD_COLS.includes(t.c);
        return onRow && onCol ? 'road_x' : onRow ? 'road_c' : 'road_r';
      }
      default:
        if (!t.owned) return 'ground_wild';
        return ((t.building && t.building.type !== 'busstop') ? 'ground_' : 'plot_') + t.district;
    }
  }
  buildingKey(b) {
    if (!b) return null;
    if (b.buildLeft > 0) return b.type === 'busstop' ? 'busstop' : 'construction';
    if (b.type === 'shop') return 'shop_' + b.state;
    if (b.type === 'factory') return b.filtered === true ? 'factory_f' : 'factory';
    return b.type;
  }

  refresh() {
    const s = this.state, N = DATA.MAP_SIZE;
    this.emitters = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const t = s.tiles[r][c];
      const gk = this.groundKey(t);
      if (this.ground[r][c].texture.key !== gk) this.ground[r][c].setTexture(gk);
      const id = c + ',' + r;
      const key = this.buildingKey(t.building);
      const { x, y } = this.tileXY(c, r);
      let spr = this.buildings[id];
      if (!key) { if (spr) { spr.destroy(); delete this.buildings[id]; } }
      else if (!spr) {
        spr = this.add.image(x, y + DATA.TILE_H, key).setOrigin(0.5, 1).setDepth(this.depthAt(c, r));
        this.buildings[id] = spr;
        if (key === 'construction' || key === 'busstop') { spr.setScale(1, 0.15); this.tweens.add({ targets: spr, scaleY: 1, duration: 300, ease: 'Back.out' }); }
      } else if (spr.texture.key !== key) {
        spr.setTexture(key);
        this.tweens.add({ targets: spr, scaleY: { from: 0.85, to: 1 }, duration: 250, ease: 'Back.out' });
      }
      if (spr && key) spr.setAlpha(t.owned ? 1 : 0.92);

      // wind turbine blades
      const b = t.building;
      const wantBlades = b && b.type === 'wind' && b.buildLeft === 0;
      if (wantBlades && !this.blades[id]) {
        const bl = this.add.image(x + 1, y - 63, 'wind_blades').setDepth(this.depthAt(c, r) + 0.5);
        this.tweens.add({ targets: bl, angle: 360, duration: 3200, repeat: -1 });
        this.blades[id] = bl;
      } else if (!wantBlades && this.blades[id]) { this.blades[id].destroy(); delete this.blades[id]; }

      // shop signs
      const signKey = b && b.type === 'shop' && b.buildLeft === 0 ? (b.state === 'sale' ? 'sign_sale' : b.state === 'closed' ? 'sign_rent' : null) : null;
      let sign = this.signs[id];
      if (!signKey && sign) { sign.destroy(); delete this.signs[id]; }
      if (signKey) {
        if (!sign) {
          sign = this.add.image(x - 18, y - 22, signKey).setOrigin(0.5, 1).setDepth(4500);
          this.tweens.add({ targets: sign, y: y - 27, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
          this.signs[id] = sign;
        } else sign.setTexture(signKey);
      }
      // smoke sources (chimney tops in world coordinates)
      if (b && b.buildLeft === 0 && b.type === 'factory') this.emitters.push({ x: x + 13, y: y - 61, strength: b.filtered === true ? 0.35 : 1, light: b.filtered === true });
      if (b && b.buildLeft === 0 && b.type === 'coal') {
        this.emitters.push({ x: x + 14, y: y - 72, strength: 1.2 * s.coalShare, light: false });
        this.emitters.push({ x: x + 23, y: y - 58, strength: 0.9 * s.coalShare, light: false });
        this.emitters.push({ x: x - 14, y: y - 34, strength: 0.8 * s.coalShare, light: true });
      }
    }
    this.syncBuses();
    this.updateOverlays();
    if (UI.buildMode) this.showValid(UI.buildMode);
  }

  updateOverlays() {
    const s = this.state;
    for (const row of s.tiles) for (const t of row) {
      if (!t.owned || !t.district || this.smogMap[t.c + ',' + t.r]) continue;
      const { x, y } = this.tileXY(t.c, t.r);
      const sm = this.add.image(x, y + 2, 'smog').setOrigin(0.5, 0).setScale(1.15, 1.05).setDepth(3500).setAlpha(0);
      sm.tile = t;
      this.smogMap[t.c + ',' + t.r] = sm;
      this.smog.push(sm);
    }
    for (const sm of this.smog) {
      if (!sm.tile.owned) { sm.setAlpha(0); continue; }
      const d = s.districts[sm.tile.district];
      let a = Phaser.Math.Clamp((d.pollution - 6) / 30, 0, 1) * 0.6;
      if (sm.tile.district === 'millbrook') a *= Math.max(0.3, 1.25 - (sm.tile.c - DATA.ROAD_COLS[0]) / 14);
      this.tweens.add({ targets: sm, alpha: Math.max(0, a), duration: 1200 });
    }
    const O = DATA.CORE_MIN - 4;
    const centres = { elmwood: [8 + O, 6 + O], market: [16 + O, 10 + O], ironworks: [9 + O, 21 + O], millbrook: [16 + O, 17 + O] };
    for (const id in centres) {
      const unhappy = s.districts[id].approval < 35;
      const [c, r] = centres[id];
      if (unhappy && !this.protests[id]) {
        const { x, y } = this.tileXY(c, r);
        const g = this.add.container(x, y + 22).setDepth(4600);
        const sign = this.add.image(0, -12, 'sign_protest').setOrigin(0.5, 1);
        g.add(sign);
        this.tweens.add({ targets: sign, y: -18, yoyo: true, repeat: -1, duration: 350 });
        this.protests[id] = g;
      } else if (!unhappy && this.protests[id]) { this.protests[id].destroy(); delete this.protests[id]; }
    }
    for (let i = 0; i < s.visual.movingOut; i++) this.time.delayedCall(i * 800, () => this.spawnTruck());
  }

  shimmer() {
    this.riverFrame = (this.riverFrame + 1) % ART.RIVER_FRAMES;
    for (const r of DATA.RIVER_ROWS) for (let c = 0; c < DATA.MAP_SIZE; c++) {
      const t = this.state.tiles[r][c];
      if (t.kind === 'river') this.ground[r][c].setTexture(this.groundKey(t));
    }
  }

  // A short rising label, e.g. "+3 Tenants" when a park opens.
  floatText(c, r, text, good = true) {
    const { x, y } = this.tileXY(c, r);
    const t = this.add.text(x, y - 30, text, { fontFamily: 'Pixelify Sans, monospace', fontSize: '18px', color: good ? '#7dff8a' : '#c9d3d8', stroke: '#14211a', strokeThickness: 4 }).setOrigin(0.5).setDepth(5200);
    this.tweens.add({ targets: t, y: y - 80, alpha: { from: 1, to: 0 }, duration: 2600, ease: 'Sine.out', onComplete: () => t.destroy() });
  }

  emitSmoke() {
    for (const e of this.emitters) {
      if (Math.random() > e.strength) continue;
      const p = this.add.image(e.x, e.y, e.light ? 'puff_light' : 'puff').setDepth(4800).setAlpha(0.9).setScale(1.2);
      this.tweens.add({ targets: p, x: e.x + 120 + Math.random() * 50, y: e.y + 14 + Math.random() * 30, alpha: 0, scale: 3.8, duration: 3800, onComplete: () => p.destroy() });
    }
  }

  // Markers for where the current tool can be used.
  showValid(mode) {
    this.marks.forEach(m => m.destroy());
    this.marks = [];
    this.firstStopMark.setVisible(false);
    if (!mode) return;
    const key = mode === 'land' ? 'landmark' : mode === 'bus' ? 'stopmark' : 'validmark';
    for (const row of this.state.tiles) for (const t of row) {
      if (!UI.canUseTool(t)) continue;
      const { x, y } = this.tileXY(t.c, t.r);
      const m = this.add.image(x, y, key).setOrigin(0.5, 0).setDepth(3900).setAlpha(0.5);
      this.tweens.add({ targets: m, alpha: 0.2, yoyo: true, repeat: -1, duration: 700 });
      this.marks.push(m);
    }
    const first = UI.firstStop;
    if (mode === 'bus' && first) { const { x, y } = this.tileXY(first.c, first.r); this.firstStopMark.setPosition(x, y).setVisible(true); }
  }

  flashTile(t, ok) {
    const { x, y } = this.tileXY(t.c, t.r);
    const f = this.add.image(x, y, 'cursor').setOrigin(0.5, 0).setDepth(4100).setTint(ok ? 0x7dff8a : 0xff6b6b);
    this.tweens.add({ targets: f, alpha: 0, duration: 600, onComplete: () => f.destroy() });
  }
  focusTile(c, r) { const { x, y } = this.tileXY(c, r); this.cameras.main.pan(x, y + 16, 500, 'Sine.easeInOut'); }
}
