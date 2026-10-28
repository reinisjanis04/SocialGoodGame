// Common Ground - the isometric city map (Phaser 3 scene)
// Draws SIM state, handles camera, hovering and clicking on tiles, and runs the game clock.

class CityScene extends Phaser.Scene {
  constructor() { super('city'); }

  // tile (c, r) -> world position of its top corner
  tileXY(c, r) {
    return { x: (c - r) * (DATA.TILE_W / 2), y: (c + r) * (DATA.TILE_H / 2) };
  }
  worldToTile(wx, wy) {
    const a = wx / (DATA.TILE_W / 2), b = wy / (DATA.TILE_H / 2);
    return { c: Math.floor((a + b) / 2), r: Math.floor((b - a) / 2) };
  }

  create() {
    this.state = GAME.state;
    ART.makeAll(this);
    const N = DATA.MAP_SIZE;
    this.ground = [];
    this.buildings = {};
    this.signs = {};
    this.smog = [];
    this.protests = {};
    this.emitters = [];
    this.validMarks = [];
    this.monthClock = 0;

    // ground layer
    for (let r = 0; r < N; r++) {
      this.ground.push([]);
      for (let c = 0; c < N; c++) {
        const { x, y } = this.tileXY(c, r);
        const img = this.add.image(x, y, 'ground_elmwood').setOrigin(0.5, 0).setScale(2).setDepth(0);
        this.ground[r].push(img);
      }
    }
    // smog layer
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const t = this.state.tiles[r][c];
      if (!t.district) continue;
      const { x, y } = this.tileXY(c, r);
      const s = this.add.image(x, y + 2, 'smog').setOrigin(0.5, 0).setScale(2.3, 2.1).setDepth(3500).setAlpha(0);
      s.tile = t;
      this.smog.push(s);
    }

    this.cursor = this.add.image(0, 0, 'cursor').setOrigin(0.5, 0).setScale(2).setDepth(4000).setVisible(false);

    // camera
    const cam = this.cameras.main;
    cam.setBackgroundColor('#26343d');
    cam.centerOn(0, N * DATA.TILE_H / 2);
    cam.setZoom(this.scale.width < 900 ? 0.6 : 0.85);
    this.onResize = size => this.cameras.resize(size.width, size.height);
    this.scale.on('resize', this.onResize);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize));

    this.setupInput();
    this.refresh();

    // ambient effects
    this.time.addEvent({ delay: 650, loop: true, callback: () => this.shimmer() });
    this.time.addEvent({ delay: 380, loop: true, callback: () => this.emitSmoke() });
    this.time.addEvent({ delay: 1400, loop: true, callback: () => this.spawnCar() });
    this.time.addEvent({ delay: 900, loop: true, callback: () => this.spawnPeople() });
    this.riverFrame = 'a';

    GAME.scene = this;
    UI.onSceneReady();
  }

  // ------------------------------------------------------------ input
  setupInput() {
    const cam = this.cameras.main;
    this.dragging = false;
    this.input.on('pointerdown', p => { this.downAt = { x: p.x, y: p.y }; this.dragging = false; });
    this.input.on('pointermove', p => {
      if (p.isDown && this.downAt) {
        if (Math.abs(p.x - this.downAt.x) + Math.abs(p.y - this.downAt.y) > 6) this.dragging = true;
        if (this.dragging) {
          cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
          cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
        }
      }
      this.hover(p);
    });
    this.input.on('pointerup', p => {
      if (!this.dragging) this.click(p);
      this.dragging = false; this.downAt = null;
    });
    this.input.on('wheel', (p, objs, dx, dy) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.35, 2.2));
    });
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
    if (UI.buildMode) {
      const ok = SIM.canPlace(this.state, UI.buildMode, t.c, t.r).ok;
      this.cursor.setTint(ok ? 0x7dff8a : 0xff6b6b);
    } else this.cursor.clearTint();
    UI.hoverTile(t, p);
  }

  click(p) {
    const t = this.tileAtPointer(p);
    if (!t) return;
    if (UI.buildMode) UI.tryBuild(t);
    else UI.selectTile(t);
  }

  // ------------------------------------------------------------ clock
  update(time, delta) {
    const s = this.state;
    if (s.phase !== 'playing' || GAME.speed === 0) return;
    this.monthClock += delta * GAME.speed;
    const monthMs = DATA.SECONDS_PER_MONTH * 1000;
    UI.setMonthProgress(this.monthClock / monthMs);
    if (this.monthClock >= monthMs) {
      this.monthClock = 0;
      GAME.endMonth();
    }
  }

  // ------------------------------------------------------------ drawing
  groundKey(t) {
    switch (t.kind) {
      case 'river': return 'river_' + this.riverFrame;
      case 'bridge': return 'bridge_done';
      case 'bridgeSite': return 'bridge_site';
      case 'bridgeBuilding': return 'bridge_building';
      case 'road': {
        const onRow = DATA.ROAD_ROWS.includes(t.r), onCol = DATA.ROAD_COLS.includes(t.c);
        return onRow && onCol ? 'road_x' : onRow ? 'road_c' : 'road_r';
      }
      default:
        return (t.building ? 'ground_' : 'plot_') + t.district;
    }
  }

  buildingKey(b) {
    if (!b) return null;
    if (b.buildLeft > 0) return 'construction';
    if (b.type === 'shop') return 'shop_' + b.state;
    if (b.type === 'factory') return b.filtered === true ? 'factory_f' : 'factory';
    return b.type;
  }

  refresh() {
    const s = this.state, N = DATA.MAP_SIZE;
    this.emitters = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const t = s.tiles[r][c];
      this.ground[r][c].setTexture(this.groundKey(t));
      const id = c + ',' + r;
      const key = this.buildingKey(t.building);
      const { x, y } = this.tileXY(c, r);
      let spr = this.buildings[id];
      if (!key) { if (spr) { spr.destroy(); delete this.buildings[id]; } }
      else {
        if (!spr) {
          spr = this.add.image(x, y + DATA.TILE_H, key).setOrigin(0.5, 1).setScale(2);
          spr.setDepth(100 + (c + r) * 2 + c * 0.001);
          this.buildings[id] = spr;
          if (t.building.buildLeft > 0 || key === 'construction') {
            spr.setScale(2, 0.2);
            this.tweens.add({ targets: spr, scaleY: 2, duration: 300, ease: 'Back.out' });
          }
        } else if (spr.texture.key !== key) {
          spr.setTexture(key);
          this.tweens.add({ targets: spr, scaleY: { from: 1.7, to: 2 }, duration: 250, ease: 'Back.out' });
        }
      }
      // shop signs
      const signKey = t.building && t.building.type === 'shop' && t.building.buildLeft === 0
        ? (t.building.state === 'sale' ? 'sign_sale' : t.building.state === 'closed' ? 'sign_rent' : null) : null;
      let sign = this.signs[id];
      if (!signKey && sign) { sign.destroy(); delete this.signs[id]; }
      if (signKey) {
        if (!sign) {
          sign = this.add.image(x - 10, y + 2, signKey).setOrigin(0.5, 1).setScale(2).setDepth(4500);
          this.tweens.add({ targets: sign, y: y - 2, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
          this.signs[id] = sign;
        } else sign.setTexture(signKey);
      }
      // smoke sources
      const b = t.building;
      if (b && b.buildLeft === 0 && (b.type === 'factory' || b.type === 'coal')) {
        const strength = b.type === 'coal' ? 1.4 * s.coalShare : (b.filtered === true ? 0.35 : 1);
        // chimney tops, converted from art pixels to world position
        this.emitters.push({ x: x + 12, y: y + (b.type === 'coal' ? -64 : -52), strength, light: b.filtered === true });
      }
    }
    this.updateOverlays();
  }

  updateOverlays() {
    const s = this.state;
    // smog: thicker where pollution is high, and thicker on the west (upwind) side of Millbrook
    for (const sm of this.smog) {
      const d = s.districts[sm.tile.district];
      let a = Phaser.Math.Clamp((d.pollution - 6) / 30, 0, 1) * 0.6;
      if (sm.tile.district === 'millbrook') a *= 1.25 - (sm.tile.c - 10) / 14;
      this.tweens.add({ targets: sm, alpha: a, duration: 1200 });
    }
    // protest signs at the centre of unhappy districts
    const centres = { elmwood: [4, 2], market: [12, 6], ironworks: [5, 16], millbrook: [12, 13] };
    for (const id in centres) {
      const unhappy = s.districts[id].approval < 35;
      const [c, r] = centres[id];
      if (unhappy && !this.protests[id]) {
        const { x, y } = this.tileXY(c, r);
        const g = this.add.container(x, y + 16).setDepth(4600);
        const sign = this.add.image(0, -8, 'sign_protest').setOrigin(0.5, 1).setScale(2);
        g.add(sign);
        for (let i = 0; i < 4; i++) g.add(this.add.image(-12 + i * 8, 4 + (i % 2) * 3, 'person').setOrigin(0.5, 1).setScale(2));
        this.tweens.add({ targets: sign, y: -14, yoyo: true, repeat: -1, duration: 350 });
        this.protests[id] = g;
      } else if (!unhappy && this.protests[id]) {
        this.protests[id].destroy(); delete this.protests[id];
      }
    }
    // moving trucks when residents leave Millbrook
    for (let i = 0; i < s.visual.movingOut; i++) this.time.delayedCall(i * 700, () => this.spawnTruck());
  }

  shimmer() {
    this.riverFrame = this.riverFrame === 'a' ? 'b' : 'a';
    for (const r of DATA.RIVER_ROWS) for (let c = 0; c < DATA.MAP_SIZE; c++)
      if (this.state.tiles[r][c].kind === 'river') this.ground[r][c].setTexture('river_' + this.riverFrame);
  }

  emitSmoke() {
    for (const e of this.emitters) {
      if (Math.random() > e.strength) continue;
      const p = this.add.image(e.x, e.y, e.light ? 'puff_light' : 'puff').setScale(3).setDepth(4800).setAlpha(0.9);
      // the wind blows east (towards Millbrook): down-right on screen
      this.tweens.add({
        targets: p, x: e.x + 110 + Math.random() * 40, y: e.y + 10 + Math.random() * 30,
        alpha: 0, scale: 8, duration: 3600, onComplete: () => p.destroy(),
      });
    }
  }

  // cars drive along the roads; fewer cars when there are bus lines
  spawnCar() {
    const s = this.state;
    const traffic = Math.max(1, 3 - s.busLines);
    if (this.children.list.filter(o => o.isCar).length > traffic * 3) return;
    const keys = ['car_red', 'car_blue', 'car_white', 'car_yellow'];
    const alongRow = Math.random() < 0.6;
    let from, to;
    if (alongRow) {
      const r = Phaser.Utils.Array.GetRandom(DATA.ROAD_ROWS);
      from = this.tileXY(0, r); to = this.tileXY(DATA.MAP_SIZE - 1, r);
    } else {
      const c = Phaser.Utils.Array.GetRandom(DATA.ROAD_COLS);
      if (c === DATA.NEW_BRIDGE_COL && !s.bridge2) return;
      from = this.tileXY(c, 0); to = this.tileXY(c, DATA.MAP_SIZE - 1);
    }
    if (Math.random() < 0.5) [from, to] = [to, from];
    const car = this.add.image(from.x, from.y + 16, Phaser.Utils.Array.GetRandom(keys)).setScale(2).setOrigin(0.5, 0.7);
    car.isCar = true;
    const upd = () => car.setDepth(100 + ((car.x / 32 + car.y / 16) / 2 + (car.y / 16 - car.x / 32) / 2) * 2 + 1);
    upd();
    this.tweens.add({ targets: car, x: to.x, y: to.y + 16, duration: 16000 / Math.max(GAME.speed, 1), onUpdate: upd, onComplete: () => car.destroy() });
  }

  spawnTruck() {
    const r = DATA.ROAD_ROWS[1];
    const from = this.tileXY(11, r), to = this.tileXY(DATA.MAP_SIZE + 2, r);
    const tr = this.add.image(from.x, from.y + 16, 'truck').setScale(2).setOrigin(0.5, 0.7).setDepth(4700);
    this.tweens.add({ targets: tr, x: to.x, y: to.y + 16, duration: 5000, onComplete: () => tr.destroy() });
  }

  // a few people walk around districts that are doing well
  spawnPeople() {
    const s = this.state;
    if (this.children.list.filter(o => o.isPerson).length > 14) return;
    const ids = Object.keys(s.districts).filter(id => s.districts[id].qol > 60 || Math.random() < 0.3);
    if (!ids.length) return;
    const id = Phaser.Utils.Array.GetRandom(ids);
    const tiles = [];
    for (const row of s.tiles) for (const t of row) if (t.district === id && t.kind === 'road') tiles.push(t);
    if (!tiles.length) return;
    const t = Phaser.Utils.Array.GetRandom(tiles);
    const { x, y } = this.tileXY(t.c, t.r);
    const p = this.add.image(x - 8, y + 14, 'person').setScale(2).setDepth(100 + (t.c + t.r) * 2 + 1.5);
    p.isPerson = true;
    this.tweens.add({ targets: p, x: x + 16, y: y + 22, duration: 4000, onComplete: () => p.destroy() });
  }

  // In build mode, tint every plot where the selected building can go.
  showValid(type) {
    const s = this.state;
    if (!this.validMarks) this.validMarks = [];
    this.validMarks.forEach(m => m.destroy());
    this.validMarks = [];
    if (!type) return;
    for (const row of s.tiles) for (const t of row) {
      if (!SIM.canPlace(s, type, t.c, t.r).ok) continue;
      const { x, y } = this.tileXY(t.c, t.r);
      const m = this.add.image(x, y, 'validmark').setOrigin(0.5, 0).setScale(2).setDepth(3900).setAlpha(0.55);
      this.tweens.add({ targets: m, alpha: 0.25, yoyo: true, repeat: -1, duration: 700 });
      this.validMarks.push(m);
    }
  }

  flashTile(t, ok) {
    const { x, y } = this.tileXY(t.c, t.r);
    const f = this.add.image(x, y, 'cursor').setOrigin(0.5, 0).setScale(2).setDepth(4100).setTint(ok ? 0x7dff8a : 0xff6b6b);
    this.tweens.add({ targets: f, alpha: 0, duration: 600, onComplete: () => f.destroy() });
  }

  focusTile(c, r) {
    const { x, y } = this.tileXY(c, r);
    this.cameras.main.pan(x, y + 16, 500, 'Sine.easeInOut');
  }
}