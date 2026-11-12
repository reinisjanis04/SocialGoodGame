const ART = (() => {
  const TW = 64, TH = 32, BH = 128;
  const CX = 32, BY = BH - 16;       // building canvas: tile centre at (32, 112)

  // Helpers
  const hexToRgb = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function shade(color, f) {
    const [r, g, b] = hexToRgb(color);
    const k = v => Math.max(0, Math.min(255, Math.round(v * f)));
    return '#' + ((k(r) << 16) | (k(g) << 8) | k(b)).toString(16).padStart(6, '0');
  }
  function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function canvas(scene, key, w, h) {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.createCanvas(key, w, h);
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    return { tex, ctx };
  }
  const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  const poly = (ctx, pts, c) => { ctx.fillStyle = c; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); };

  // Per-pixel painter for a ground tile: fn(cf, rf, x, y) returns a colour or null.
  // cf / rf go from 0 to 1 across the tile along the c and r map axes.
  function tilePaint(ctx, fn, ox = 0, oy = 0) {
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const dx = (x + 0.5 - 32) / 32, dy = (y + 0.5) / 16;
      const cf = (dx + dy) / 2, rf = (dy - dx) / 2;
      if (cf < 0 || cf > 1 || rf < 0 || rf > 1) continue;
      const col = fn(cf, rf, x, y);
      if (col) px(ctx, x + ox, y + oy, 1, 1, col);
    }
  }
  // Diamond of width w (multiple of 4) centred at (cx, cy), drawn row by row.
  function diamond(ctx, cx, cy, w, color, noise) {
    const rows = w / 2, q = w / 4, r = noise ? rng(noise.seed || 3) : null;
    for (let i = 0; i < rows; i++) {
      const half = i < q ? 2 * (i + 1) : 2 * (rows - i);
      px(ctx, cx - half, cy - q + i, half * 2, 1, color);
      if (noise) for (let x = cx - half; x < cx + half; x++) {
        const v = r();
        if (v < noise.amount) px(ctx, x, cy - q + i, 1, 1, v < noise.amount / 2 ? noise.dark : noise.light);
      }
    }
  }
  function diamondHalves(ctx, cx, cy, w, left, right) {
    const rows = w / 2, q = w / 4;
    for (let i = 0; i < rows; i++) {
      const half = i < q ? 2 * (i + 1) : 2 * (rows - i);
      px(ctx, cx - half, cy - q + i, half, 1, left);
      px(ctx, cx, cy - q + i, half, 1, right);
    }
  }
  function diamondOutline(ctx, cx, cy, w, color, dashed, thick = 2) {
    const rows = w / 2, q = w / 4;
    for (let i = 0; i < rows; i++) {
      const half = i < q ? 2 * (i + 1) : 2 * (rows - i);
      if (dashed && i % 4 >= 2) continue;
      px(ctx, cx - half, cy - q + i, thick, 1, color);
      px(ctx, cx + half - thick, cy - q + i, thick, 1, color);
    }
  }
  // y of the lower edge of a box's wall at column x (box footprint w, centred at cx, cy)
  const wallBase = (cx, cy, w, x) => cy + w / 4 - (x < cx ? Math.floor((cx - x) / 2) : Math.floor((x - cx + 1) / 2));
  // An isometric box: footprint width w (multiple of 4), wall height h.
  function box(ctx, cx, cy, w, h, c) {
    for (let x = cx - w / 2; x < cx + w / 2; x++) {
      const yb = wallBase(cx, cy, w, x);
      px(ctx, x, yb - h, 1, h, x < cx ? c.left : c.right);
    }
    if (c.top) diamond(ctx, cx, cy - h, w, c.top);
    if (c.edge) for (let x = cx - w / 2; x < cx + w / 2; x++) px(ctx, x, wallBase(cx, cy, w, x) - h, 1, 1, c.edge);
    if (c.outline) { // dark outer edges and the front corner
      for (let x = cx - w / 2; x < cx + w / 2; x++) px(ctx, x, wallBase(cx, cy, w, x) - 1, 1, 1, c.outline);
      px(ctx, cx - w / 2, cy - h, 1, h, c.outline); px(ctx, cx + w / 2 - 1, cy - h, 1, h, c.outline);
    }
  }
  // Horizontal lines on both walls (bricks, storeys, cladding).
  function wallLines(ctx, cx, cy, w, h, color, step, from = 2, to = h) {
    for (let lv = from; lv < to; lv += step)
      for (let x = cx - w / 2; x < cx + w / 2; x++) px(ctx, x, wallBase(cx, cy, w, x) - lv, 1, 1, color);
  }
  // A band on both walls between heights z0 and z1.
  function wallBand(ctx, cx, cy, w, z0, z1, colorL, colorR) {
    for (let x = cx - w / 2; x < cx + w / 2; x++) px(ctx, x, wallBase(cx, cy, w, x) - z1, 1, z1 - z0, x < cx ? colorL : (colorR || colorL));
  }
  // Windows on both walls.
  function windows(ctx, cx, cy, w, h, o) {
    const r = rng(o.seed || 11), ww = o.ww || 3, wh = o.wh || 4, vx = o.vx || 6, vy = o.vy || 8, from = o.from || 4;
    for (let x0 = cx - w / 2 + (o.margin || 3); x0 + ww <= cx + w / 2 - 2; x0 += vx) {
      if (x0 < cx && x0 + ww > cx - 1) continue;
      for (let lv = from; lv + wh <= h - (o.top || 3); lv += vy) {
        const col = o.lit && r() < (o.litShare || 0.45) ? o.lit : o.color;
        for (let k = 0; k < ww; k++) {
          const x = x0 + k;
          const yb = wallBase(cx, cy, w, x);
          px(ctx, x, yb - lv - wh, 1, wh, col);
          if (o.frame) px(ctx, x, yb - lv - wh - 1, 1, 1, o.frame);
        }
        if (o.sill) for (let k = -1; k <= ww; k++) { const x = x0 + k; px(ctx, x, wallBase(cx, cy, w, x) - lv, 1, 1, o.sill); }
      }
    }
  }
  // Hip roof: stacked shrinking diamonds.
  function hipRoof(ctx, cx, topY, w, left, right, ridge) {
    for (let i = 0, ww = w; ww >= 4; i++, ww -= 4) diamondHalves(ctx, cx, topY - i * 2, ww, left, right);
    if (ridge) px(ctx, cx - 1, topY - (w / 4) * 2 + 1, 2, 2, ridge);
  }
  function tree(ctx, x, y, s = 1, color = '#3f7d3a') {
    px(ctx, x - 1, y - 8 * s, 3, 8 * s, '#6b4a2b');
    const rr = Math.round(7 * s), hi = shade(color, 1.25), lo = shade(color, 0.78);
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      const d = dx * dx + dy * dy;
      if (d > rr * rr) continue;
      const c = dx + dy < -rr * 0.6 ? hi : dx + dy > rr * 0.7 ? lo : color;
      px(ctx, x + dx, y - 10 * s - rr + dy, 1, 1, c);
    }
  }
  function pine(ctx, x, y, s = 1) {
    px(ctx, x - 1, y - 5 * s, 3, 5 * s, '#5a3e26');
    for (let i = 0; i < 3; i++) {
      const w = Math.round((12 - i * 3) * s), top = y - 5 * s - (i + 1) * 7 * s;
      for (let k = 0; k < 9 * s; k++) {
        const half = Math.round(w * (k + 1) / (9 * s) / 2) + 1;
        px(ctx, x - half, top + k, half, 1, '#2f5f3a'); px(ctx, x, top + k, half, 1, '#244d2f');
      }
    }
  }
  // Rectangular prism for vehicles: a along the c axis, b along r, h tall, ground centre (cx, cy).
  function prism(ctx, cx, cy, a, b, h, c) {
    const P = (u, v, z = 0) => [cx + u - v, cy + (u + v) / 2 - z];
    poly(ctx, [P(-a, b), P(a, b), P(a, b, h), P(-a, b, h)], c.left);
    poly(ctx, [P(a, b), P(a, -b), P(a, -b, h), P(a, b, h)], c.right);
    poly(ctx, [P(-a, -b, h), P(a, -b, h), P(a, b, h), P(-a, b, h)], c.top);
  }

  // 3x5 pixel font for signs (s = pixel size)
  const GLYPHS = {
    S: ['111', '100', '111', '001', '111'], A: ['010', '101', '111', '101', '101'], L: ['100', '100', '100', '100', '111'],
    E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'], O: ['111', '101', '101', '101', '111'],
    R: ['110', '101', '110', '101', '101'], N: ['101', '111', '111', '111', '101'], T: ['111', '010', '010', '010', '010'],
    B: ['110', '101', '110', '101', '110'], U: ['101', '101', '101', '101', '111'], '!': ['010', '010', '010', '000', '010'],
    P: ['110', '101', '110', '100', '100'], I: ['111', '010', '010', '010', '111'], C: ['111', '100', '100', '100', '111'],
  };
  function text(ctx, str, x, y, color, s = 1) {
    for (const ch of str) {
      const g = GLYPHS[ch];
      if (g) g.forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') px(ctx, x + i * s, y + j * s, s, s, color); }));
      x += 4 * s;
    }
  }

  // Textures
  function makeAll(scene) {
    const G = (key, fn, h = TH) => { const { ctx, tex } = canvas(scene, key, TW, h); fn(ctx); tex.refresh(); };

    // Ground per district
    const grounds = {
      elmwood: { c: '#6fa65a', d: '#5e9450', l: '#86ba6c' },
      market: { c: '#bdb5a1', d: '#a9a18c', l: '#cfc8b6' },
      ironworks: { c: '#8b8a6b', d: '#77765a', l: '#9d9c7d' },
      millbrook: { c: '#8e9b5b', d: '#7c894e', l: '#a2ae6c' },
    };
    for (const id in grounds) {
      const g = grounds[id];
      const paint = (ctx, plot) => {
        const r = rng(id.length * 13);
        tilePaint(ctx, (cf, rf) => {
          const v = r();
          if (plot && cf > 0.16 && cf < 0.84 && rf > 0.16 && rf < 0.84) {
            const edge = cf < 0.2 || cf > 0.8 || rf < 0.2 || rf > 0.8;
            return edge ? '#8a7150' : v < 0.15 ? '#8c7350' : v > 0.88 ? '#b39a72' : '#a08560';
          }
          if (id === 'market') { // paving stones
            if ((cf * 64) % 8 < 0.9 || (rf * 64) % 8 < 0.9) return g.d;
            return v < 0.08 ? g.l : g.c;
          }
          return v < 0.1 ? g.d : v > 0.9 ? g.l : g.c;
        });
        if (plot) for (const [x, y] of [[32, 6], [32, 25], [12, 16], [52, 16]]) px(ctx, x - 1, y - 1, 2, 3, '#f2e6c9');
      };
      G('ground_' + id, ctx => paint(ctx, false));
      G('plot_' + id, ctx => paint(ctx, true));
    }
    G('ground_wild', ctx => {
      const r = rng(77);
      tilePaint(ctx, () => { const v = r(); return v < 0.008 ? '#d9c95e' : v < 0.12 ? '#577544' : v > 0.93 ? '#6f8f58' : '#62824d'; });
    });

    // Roads with sidewalks and lane markings
    const road = (key, dir) => G(key, ctx => {
      const r = rng(9);
      tilePaint(ctx, (cf, rf) => {
        const across = dir === 'c' ? rf : cf, along = dir === 'c' ? cf : rf;
        const side = v => v < 0.13 || v > 0.87;
        if (dir === 'x') {
          if (side(cf) && side(rf)) return '#a9aaa6';
          const zebra = (side(cf) && rf > 0.18 && rf < 0.82 && Math.floor(rf * 14) % 2 === 0) || (side(rf) && cf > 0.18 && cf < 0.82 && Math.floor(cf * 14) % 2 === 0);
          if (zebra) return '#d9d9d2';
          return r() < 0.06 ? '#4e5154' : '#56595d';
        }
        if (side(across)) return (across < 0.135 && across > 0.115) || (across > 0.865 && across < 0.885) ? '#7d7f7c' : '#a9aaa6';
        if (Math.abs(across - 0.5) < 0.025 && Math.floor(along * 6) % 2 === 0) return '#e8d36a';
        return r() < 0.06 ? '#4e5154' : '#56595d';
      });
    });
    road('road_c', 'c'); road('road_r', 'r'); road('road_x', 'x');

    // Water: polluted (murky teal) and clean (blue). Ripples drift downstream (along c),
    // with a stone bank on the edge that borders land.
    const RIPPLES = (() => { const r = rng(57), out = []; for (let i = 0; i < 16; i++) out.push({ c: r(), r: 0.12 + r() * 0.76, len: 3 + Math.floor(r() * 4) }); return out; })();
    const FRAMES = 6;
    const water = (key, base, ripple, dark, bank, frame) => G(key, ctx => {
      const r = rng(23);
      tilePaint(ctx, (cf, rf) => {
        if (bank === 'top' && rf < 0.1) return rf < 0.05 ? '#8f8a7c' : '#6f6a5e';
        if (bank === 'bot' && rf > 0.9) return rf > 0.95 ? '#8f8a7c' : '#6f6a5e';
        const v = r();
        return v < 0.05 ? dark : base;
      });
      for (const rp of RIPPLES) {
        const cf = (rp.c + frame * 0.045) % 1, rf = rp.r;
        if (bank === 'top' && rf < 0.14) continue;
        if (bank === 'bot' && rf > 0.86) continue;
        const x = Math.round(32 + 32 * (cf - rf)), y = Math.round(16 * (cf + rf));
        for (let k = 0; k < rp.len; k++) px(ctx, x + k * 2, y + k, 2, 1, ripple);
      }
    });
    for (let f = 0; f < FRAMES; f++) for (const bank of ['top', 'bot']) {
      water(`river_d_${bank}_${f}`, '#4d6a6a', '#7e9a92', '#45605f', bank, f);
      water(`river_c_${bank}_${f}`, '#3f78a8', '#8cbde2', '#3a6f9c', bank, f);
    }

    // Bridges (they run along r). Canvas is taller so the deck edge and piers show below.
    const bridge = (key, stage, wb, wd) => G(key, ctx => {
      tilePaint(ctx, () => wb);
      if (stage === 'site') { diamondOutline(ctx, 32, 16, 64, '#f2d14b', true); return; }
      // pier under the visible (south-east) deck edge
      const pier = (x, y) => { px(ctx, x, y, 6, 14, '#7d7468'); px(ctx, x + 4, y, 2, 14, '#625a50'); };
      if (stage === 'building') {
        pier(44, 24);
        tilePaint(ctx, (cf, rf) => (rf < 0.55 && cf > 0.08 && cf < 0.92 ? (Math.floor(rf * 16) % 2 ? '#8a6a46' : '#9c7a52') : null));
        return;
      }
      pier(44, 26);
      poly(ctx, [[64, 16], [32, 32], [32, 37], [64, 21]], '#6f675d');           // deck edge
      tilePaint(ctx, (cf, rf) => {
        if (cf < 0.12 || cf > 0.88) return cf < 0.035 || cf > 0.965 ? '#8d8579' : '#b3ab9d'; // footpaths
        if (Math.abs(cf - 0.5) < 0.025 && Math.floor(rf * 6) % 2 === 0) return '#e8d36a';
        return '#5a5d61';
      });
      // railings: a raised rail with posts along both long edges
      tilePaint(ctx, (cf, rf, x, y) => {
        if (cf > 0.012 && cf < 0.04) { px(ctx, x, y - 4, 1, 1, '#d8d2c6'); if (x % 6 === 0) px(ctx, x, y - 4, 1, 4, '#8d8579'); }
        if (cf > 0.96 && cf < 0.988) { px(ctx, x, y - 4, 1, 1, '#e6e0d4'); if (x % 6 === 0) px(ctx, x, y - 4, 1, 4, '#8d8579'); }
        return null;
      });
    }, TH + 18);
    for (const [suf, wb, wd] of [['d', '#4d6a6a', '#45605f'], ['c', '#3f78a8', '#3a6f9c']]) {
      bridge('bridge_site_' + suf, 'site', wb, wd); bridge('bridge_building_' + suf, 'building', wb, wd); bridge('bridge_done_' + suf, 'done', wb, wd);
    }

    // Markers
    G('cursor', ctx => diamondOutline(ctx, 32, 16, 64, '#ffffff'));
    G('validmark', ctx => { diamond(ctx, 32, 16, 64, '#6dff7e'); diamondOutline(ctx, 32, 16, 64, '#e9ffe9'); });
    G('landmark', ctx => { diamond(ctx, 32, 16, 64, '#f2d14b'); diamondOutline(ctx, 32, 16, 64, '#fff3b0', true); });
    G('stopmark', ctx => { diamond(ctx, 32, 16, 64, '#4c9be8'); diamondOutline(ctx, 32, 16, 64, '#dcefff'); });

    // Buildings (64 x 128, tile centre at (32, 112))
    const B = (key, draw) => { const { ctx, tex } = canvas(scene, key, TW, BH); draw(ctx); tex.refresh(); };
    const cx = CX, by = BY;

    B('villa', ctx => {
      diamond(ctx, cx, by, 56, '#5e9450');
      box(ctx, cx - 4, by + 2, 32, 18, { left: '#efe2c4', right: '#cdbf9f', outline: '#9a8c70' });
      windows(ctx, cx - 4, by + 2, 32, 18, { color: '#5b7da3', frame: '#ffffff', vx: 7, vy: 9, wh: 5, from: 5, ww: 3 });
      hipRoof(ctx, cx - 4, by + 2 - 18, 36, '#c96a50', '#9a4331', '#7a3324');
      tree(ctx, cx + 20, by + 4, 0.9);
    });
    B('flats', ctx => {
      box(ctx, cx, by, 52, 44, { left: '#b7695a', right: '#94524a', top: '#6f6f72', edge: '#c98375', outline: '#6e3a32' });
      wallLines(ctx, cx, by, 52, 44, '#a35d4f', 3, 2, 42);
      windows(ctx, cx, by, 52, 44, { color: '#3c4f63', lit: '#f0d27a', frame: '#e2c6b8', vx: 6, vy: 9, wh: 5, ww: 3 });
      diamond(ctx, cx, by - 44, 44, '#7d7d80');
      box(ctx, cx + 8, by - 44 - 2, 8, 5, { left: '#b9bcbf', right: '#9a9da0', top: '#d0d3d6' });
      box(ctx, cx - 10, by - 44 + 1, 8, 4, { left: '#b9bcbf', right: '#9a9da0', top: '#d0d3d6' });
    });
    B('office', ctx => {
      box(ctx, cx, by, 44, 84, { left: '#7fa6c4', right: '#5d86a8', top: '#d5dde3', edge: '#c9e0f0', outline: '#3d5f7a' });
      for (let lv = 6; lv < 82; lv += 6) wallBand(ctx, cx, by, 44, lv, lv + 3, '#a9cbe3', '#86aecd');
      px(ctx, cx - 1, by - 84 - 22, 2, 14, '#9aa5ad'); px(ctx, cx - 1, by - 84 - 23, 2, 2, '#e2574c');
    });
    B('officenew', ctx => {
      box(ctx, cx, by, 48, 92, { left: '#4f8fa0', right: '#3b7181', top: '#cfe3d8', edge: '#9fd0dc', outline: '#24505c' });
      for (let x = cx - 22; x < cx + 24; x += 4) { const yb = wallBase(cx, by, 48, x); px(ctx, x, yb - 90, 1, 88, x < cx ? '#78b4c4' : '#5a95a6'); }
      diamond(ctx, cx, by - 92, 36, '#6fa65a');
      tree(ctx, cx - 6, by - 94, 0.6); tree(ctx, cx + 8, by - 92, 0.5);
    });
    B('warehouse', ctx => {
      box(ctx, cx, by, 56, 20, { left: '#7d93a3', right: '#62788a', top: '#9aa5ad', edge: '#b4c0c8', outline: '#46586a' });
      for (let x = cx - 27; x < cx + 28; x += 3) { const yb = wallBase(cx, by, 56, x); px(ctx, x, yb - 19, 1, 18, x < cx ? '#6f8595' : '#566b7c'); }
      for (let k = 0; k < 9; k++) { const x = cx - 18 + k; px(ctx, x, wallBase(cx, by, 56, x) - 12, 1, 11, '#3f4a52'); }
      box(ctx, cx + 6, by - 20 - 1, 8, 4, { left: '#5d676e', right: '#4b545a', top: '#7c868d' });
      box(ctx, cx - 8, by - 20 - 4, 8, 4, { left: '#5d676e', right: '#4b545a', top: '#7c868d' });
    });
    const factory = (key, filtered) => B(key, ctx => {
      box(ctx, cx - 2, by, 48, 26, { left: '#8c8f93', right: '#6e7175', top: '#585b5f', outline: '#47494c' });
      windows(ctx, cx - 2, by, 48, 26, { color: '#3e4245', lit: '#d9b25c', vx: 7, vy: 10, wh: 6, ww: 4 });
      for (let i = 0; i < 5; i++) {                                                // sawtooth roof
        const x0 = cx - 22 + i * 9, y0 = wallBase(cx - 2, by, 48, x0) - 26;
        for (let k = 0; k < 8; k++) px(ctx, x0 + k, y0 - Math.min(k, 8 - k) - 2, 1, Math.min(k, 8 - k) + 2, k < 4 ? '#a9adb2' : '#7a7e83');
      }
      px(ctx, cx + 10, by - 76, 7, 58, '#8a4d3b'); px(ctx, cx + 15, by - 76, 2, 58, '#6e3c2e');   // chimney
      for (let y = by - 70; y < by - 20; y += 12) px(ctx, cx + 10, y, 7, 2, '#a86452');
      if (filtered) { px(ctx, cx + 9, by - 80, 9, 6, '#4caf6a'); px(ctx, cx + 9, by - 78, 9, 1, '#d9f2df'); px(ctx, cx + 10, by - 60, 7, 3, '#4caf6a'); }
      else px(ctx, cx + 10, by - 77, 7, 3, '#3e2a22');
    });
    factory('factory', false); factory('factory_f', true);
    B('coal', ctx => {
      // cooling tower
      for (let y = 0; y < 44; y++) {
        const t = y / 44, half = Math.round(9 + 4 * Math.pow(Math.abs(t - 0.62) / 0.62, 2) * (t < 0.62 ? 1 : 1.5));
        const yy = by - 6 - y, x0 = cx - 14;
        px(ctx, x0 - half, yy, half, 1, '#c9c6c0'); px(ctx, x0, yy, half, 1, '#a9a6a0');
      }
      box(ctx, cx + 6, by + 4, 32, 22, { left: '#5c5552', right: '#47413f', top: '#3a3533', outline: '#2c2826' });
      windows(ctx, cx + 6, by + 4, 32, 22, { color: '#2c2826', lit: '#e0a040', litShare: 0.3, vx: 6, vy: 9, wh: 5 });
      px(ctx, cx + 10, by - 88, 8, 70, '#6b4a3c'); px(ctx, cx + 16, by - 88, 2, 70, '#553a2f');
      px(ctx, cx + 20, by - 74, 6, 56, '#6b4a3c'); px(ctx, cx + 24, by - 74, 2, 56, '#553a2f');
      for (const [x, y, w] of [[cx + 10, by - 88, 8], [cx + 20, by - 74, 6]]) { px(ctx, x, y, w, 3, '#e6e6e6'); px(ctx, x, y + 12, w, 2, '#c9c9c9'); }
      for (let k = 0; k < 7; k++) px(ctx, cx - 22 + k * 2, by + 6 - Math.min(k, 7 - k), 3, Math.min(k, 7 - k) + 1, '#2a2523');
    });
    const shop = (key, st) => B(key, ctx => {
      const wall = st === 'closed' ? { left: '#9b9184', right: '#7f776c', top: '#5d5a55', outline: '#5d5650' } : { left: '#ecdcb6', right: '#cbbb94', top: '#7b6a58', outline: '#8f7f62' };
      box(ctx, cx, by, 52, 24, wall);
      const win = st === 'open' ? '#f6d77d' : st === 'sale' ? '#d6c48e' : '#3b3631';
      for (const x0 of [cx - 22, cx - 12, cx + 4, cx + 14]) for (let k = 0; k < 7; k++) {
        const x = x0 + k; px(ctx, x, wallBase(cx, by, 52, x) - 13, 1, 9, win);
      }
      if (st === 'closed') for (const x0 of [cx - 22, cx - 12, cx + 4, cx + 14]) for (let k = 0; k < 7; k++) {
        const x = x0 + k; const yb = wallBase(cx, by, 52, x); px(ctx, x, yb - 12 + (k % 7), 1, 1, '#8a6a46'); px(ctx, x, yb - 6 - (k % 7), 1, 1, '#8a6a46');
      }
      const aw = st === 'open' ? ['#3f9b5a', '#f4f1e8'] : st === 'sale' ? ['#e08a2e', '#f4f1e8'] : ['#6b5d50', '#5d5145'];
      for (let x = cx - 26; x < cx + 26; x++) { const yb = wallBase(cx, by, 52, x); px(ctx, x, yb - 18, 1, 4, Math.floor(x / 3) % 2 ? aw[0] : aw[1]); px(ctx, x, yb - 14, 1, 1, shade(aw[0], 0.7)); }
      const signC = st === 'closed' ? '#6b6560' : '#2f6fa8';
      box(ctx, cx, by - 24, 20, 6, { left: signC, right: shade(signC, 0.8), top: shade(signC, 1.2) });
    });
    shop('shop_open', 'open'); shop('shop_sale', 'sale'); shop('shop_closed', 'closed');
    B('tree', ctx => { tree(ctx, cx - 10, by + 4, 1.1); tree(ctx, cx + 10, by + 6, 0.9, '#4b8c41'); tree(ctx, cx + 1, by - 4, 0.8, '#3a7536'); });
    B('wildtree', ctx => { pine(ctx, cx - 10, by + 4, 1); pine(ctx, cx + 9, by + 6, 0.85); pine(ctx, cx, by - 4, 0.7); });
    B('park', ctx => {
      diamond(ctx, cx, by, 60, '#79c25f', { amount: 0.2, dark: '#69b052', light: '#91d477', seed: 13 });
      tilePaint(ctx, (cf, rf) => (Math.abs(cf - 0.5) < 0.05 || Math.abs(rf - 0.5) < 0.05) && cf > 0.06 && cf < 0.94 && rf > 0.06 && rf < 0.94 ? '#d8c79a' : null, 0, by - 16);
      for (let dy = -4; dy <= 4; dy++) for (let dx = -8; dx <= 8; dx++) if (dx * dx / 64 + dy * dy / 16 <= 1) px(ctx, cx + dx, by + dy, 1, 1, dx * dx / 64 + dy * dy / 16 > 0.55 ? '#9a9a96' : '#6fb7e6');
      px(ctx, cx - 1, by - 6, 2, 5, '#b9e2f7');
      tree(ctx, cx - 16, by + 2, 0.9); tree(ctx, cx + 16, by - 2, 1.1, '#4b8c41'); tree(ctx, cx + 2, by - 9, 0.8);
      px(ctx, cx + 6, by + 8, 8, 2, '#7b5a3a'); px(ctx, cx + 6, by + 10, 1, 2, '#5a4028'); px(ctx, cx + 13, by + 10, 1, 2, '#5a4028');
      for (const [x, y, c] of [[cx - 20, by + 8, '#e85d75'], [cx + 22, by + 4, '#f2d14b'], [cx - 8, by + 12, '#b38be0']]) { px(ctx, x, y, 2, 2, c); px(ctx, x + 3, y + 1, 2, 2, c); }
    });
    B('clinic', ctx => {
      box(ctx, cx, by, 44, 30, { left: '#f4f4f2', right: '#d6d6d2', top: '#9fb7c4', edge: '#ffffff', outline: '#a9a9a4' });
      wallBand(ctx, cx, by, 44, 25, 27, '#e2574c', '#c4463c');
      windows(ctx, cx, by, 44, 30, { color: '#7fa9c9', frame: '#ffffff', vx: 7, vy: 10, wh: 5, ww: 4, top: 7 });
      px(ctx, cx - 4, by - 30 - 10, 8, 3, '#e2574c'); px(ctx, cx - 1, by - 30 - 13, 3, 9, '#e2574c');
      box(ctx, cx - 12, by + 6, 12, 8, { left: '#c9e0ea', right: '#a9c4d0', top: '#e2574c' });
    });
    B('school', ctx => {
      diamond(ctx, cx, by + 2, 56, '#c9b77a');
      box(ctx, cx - 2, by, 48, 24, { left: '#d9894e', right: '#b56c38', top: '#6f6f72', edge: '#e6a26e', outline: '#8a4f28' });
      wallLines(ctx, cx - 2, by, 48, 24, '#c57a42', 3, 2, 22);
      windows(ctx, cx - 2, by, 48, 24, { color: '#5b7da3', frame: '#f4efe4', vx: 7, vy: 10, wh: 6, ww: 4, from: 5 });
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 9) px(ctx, cx - 14 + dx, by - 26 + dy, 1, 1, dx * dx + dy * dy > 4 ? '#5a3a20' : '#f4efe4');
      px(ctx, cx - 14, by - 28, 1, 3, '#222'); px(ctx, cx - 14, by - 26, 2, 1, '#222');
      px(ctx, cx + 20, by - 44, 1, 40, '#d0d0d0'); px(ctx, cx + 21, by - 44, 10, 6, '#3b6fb6'); px(ctx, cx + 21, by - 41, 10, 1, '#f2d14b');
    });
    B('community', ctx => {
      diamond(ctx, cx, by + 2, 52, '#9bb06a');
      box(ctx, cx, by, 40, 20, { left: '#c9925a', right: '#a8743f', outline: '#7a5228' });
      wallLines(ctx, cx, by, 40, 20, '#b68046', 4, 3, 19);
      hipRoof(ctx, cx, by - 20, 44, '#5f9a5a', '#477a44', '#355f33');
      for (let k = 0; k < 6; k++) { const x = cx - 12 + k; px(ctx, x, wallBase(cx, by, 40, x) - 11, 1, 10, '#5a3a20'); }
      for (let k = 0; k < 14; k++) { const x = cx + 4 + k; px(ctx, x, wallBase(cx, by, 40, x) - 17, 1, 4, ['#e2574c', '#f2c230', '#4c9be8', '#5fbf74'][k % 4]); }
      tree(ctx, cx - 22, by + 6, 0.7);
    });
    B('police', ctx => {
      diamond(ctx, cx, by + 2, 56, '#a9aaa6');
      box(ctx, cx - 2, by, 44, 28, { left: '#e9edf2', right: '#c6ccd4', top: '#3b5a8a', edge: '#ffffff', outline: '#8b939e' });
      wallBand(ctx, cx - 2, by, 44, 18, 22, '#2f5aa8', '#244a8c');
      windows(ctx, cx - 2, by, 44, 28, { color: '#4e6f96', frame: '#ffffff', vx: 7, vy: 10, wh: 5, ww: 4, top: 12 });
      for (let k = 0; k < 6; k++) { const x = cx - 16 + k; px(ctx, x, wallBase(cx - 2, by, 44, x) - 11, 1, 10, '#24364f'); }
      px(ctx, cx - 14, by - 46, 28, 9, '#2f5aa8'); text(ctx, 'POLICE', cx - 12, by - 44, '#ffffff');
      px(ctx, cx + 12, by - 36, 3, 3, '#e2574c'); px(ctx, cx + 16, by - 36, 3, 3, '#4c9be8');
      // patrol car in front
      prism(ctx, cx + 18, by + 10, 7, 3.5, 4, { left: '#f4f4f2', right: '#c9c9c4', top: '#ffffff' });
      px(ctx, cx + 16, by + 1, 2, 2, '#e2574c'); px(ctx, cx + 19, by + 2, 2, 2, '#4c9be8');
    });
    B('fire', ctx => {
      diamond(ctx, cx, by + 2, 56, '#a9aaa6');
      box(ctx, cx - 4, by, 40, 26, { left: '#c9473b', right: '#a8372d', top: '#5d5a55', edge: '#e0675b', outline: '#7a2a22' });
      wallLines(ctx, cx - 4, by, 40, 26, '#b9423a', 3, 2, 24);
      for (const x0 of [cx - 22, cx - 14]) for (let k = 0; k < 7; k++) {                 // garage doors
        const x = x0 + k, yb = wallBase(cx - 4, by, 40, x);
        px(ctx, x, yb - 14, 1, 13, '#e6e2d8'); if (k % 2) px(ctx, x, yb - 14, 1, 13, '#cfcabe');
      }
      windows(ctx, cx - 4, by, 40, 26, { color: '#4e6f96', frame: '#f4efe4', vx: 7, vy: 10, wh: 4, ww: 3, from: 17, margin: 22 });
      box(ctx, cx + 14, by - 4, 12, 44, { left: '#c9473b', right: '#a8372d', top: '#5d5a55', outline: '#7a2a22' });  // drill tower
      windows(ctx, cx + 14, by - 4, 12, 44, { color: '#3a2a26', vx: 4, vy: 9, wh: 4, ww: 2, from: 14, margin: 2 });
      px(ctx, cx - 16, by - 34, 20, 8, '#f4efe4'); text(ctx, 'FIRE', cx - 14, by - 32, '#c9473b');
      prism(ctx, cx - 18, by + 12, 8, 3.5, 5, { left: '#d63b2f', right: '#b02e24', top: '#e8574b' });
      px(ctx, cx - 22, by + 3, 8, 1, '#d0d0d0');
    });
    B('social', ctx => {
      box(ctx, cx, by, 52, 60, { left: '#8fc7bf', right: '#6fa69e', top: '#5f6e73', edge: '#b1ddd6', outline: '#4b7a74' });
      for (let lv = 10; lv < 58; lv += 10) wallBand(ctx, cx, by, 52, lv - 1, lv + 1, '#5f8f88', '#4f7a74');
      windows(ctx, cx, by, 52, 60, { color: '#33525a', lit: '#f0d27a', vx: 6, vy: 10, wh: 5, ww: 3, from: 3, top: 2 });
      tree(ctx, cx - 24, by + 8, 0.7);
    });
    B('apartments', ctx => {
      box(ctx, cx, by, 48, 76, { left: '#ebe6dc', right: '#cbc4b6', top: '#5d5a55', edge: '#ffffff', outline: '#9a9488' });
      for (let lv = 8; lv < 74; lv += 9) wallBand(ctx, cx, by, 48, lv, lv + 4, '#8fb9d6', '#6f9cbc');
      for (let lv = 7; lv < 74; lv += 9) wallBand(ctx, cx, by, 48, lv, lv + 1, '#b9b2a4', '#9a9488');
    });
    B('solar', ctx => {
      diamond(ctx, cx, by, 60, '#9aa86a', { amount: 0.15, dark: '#8a9860', light: '#aab87a', seed: 4 });
      for (let row = 0; row < 4; row++) {
        const ox = cx - 18 + row * 8, oy = by - 10 + row * 4;
        poly(ctx, [[ox, oy], [ox + 22, oy + 11], [ox + 18, oy + 13], [ox - 4, oy + 2]], '#2f4f7f');
        for (let k = 3; k < 22; k += 5) poly(ctx, [[ox + k, oy + k / 2], [ox + k + 1, oy + (k + 1) / 2], [ox + k - 3, oy + (k + 1) / 2 + 2], [ox + k - 4, oy + k / 2 + 2]], '#6f8fb8');
        px(ctx, ox + 10, oy + 8, 1, 3, '#555');
      }
    });
    B('wind', ctx => {
      diamond(ctx, cx, by, 24, '#a9aaa6');
      for (let y = 0; y < 82; y++) { const half = Math.max(1, Math.round(3 - y / 30)); px(ctx, cx - half, by - y, half, 1, '#f4f4f2'); px(ctx, cx, by - y, half, 1, '#d6d6d2'); }
      box(ctx, cx + 1, by - 82, 8, 5, { left: '#e6e6e6', right: '#c8c8c8', top: '#ffffff' });
    });
    const S = (key, w, h, draw) => { const { ctx, tex } = canvas(scene, key, w, h); draw(ctx); tex.refresh(); };
    S('wind_blades', 72, 72, ctx => {
      ctx.translate(36, 36);
      for (let i = 0; i < 3; i++) {
        ctx.rotate(Math.PI * 2 / 3);
        poly(ctx, [[-2, 0], [2, 0], [1.2, -33], [-0.5, -34]], '#f8f8f6');
        poly(ctx, [[0.5, -2], [2, 0], [1.2, -33]], '#d6d6d2');
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      px(ctx, 34, 34, 4, 4, '#bdbdb8');
    });
    B('water', ctx => {
      diamond(ctx, cx, by, 60, '#b9bab4');
      const tank = (x, y, rr, h) => {
        for (let k = 0; k < h; k++) { px(ctx, x - rr, y - k, rr, 1, '#a7b4bc'); px(ctx, x, y - k, rr, 1, '#8697a2'); }
        for (let dy = -rr / 2; dy <= rr / 2; dy++) for (let dx = -rr; dx <= rr; dx++) if (dx * dx / (rr * rr) + dy * dy * 4 / (rr * rr) <= 1) px(ctx, x + dx, y - h + dy, 1, 1, dx * dx / (rr * rr) + dy * dy * 4 / (rr * rr) > 0.7 ? '#c7d2d8' : '#4f9fd1');
      };
      tank(cx - 12, by + 2, 11, 10); tank(cx + 12, by + 6, 9, 8);
      box(ctx, cx + 10, by - 6, 16, 14, { left: '#e6e2d8', right: '#c9c4b8', top: '#7d9db0', outline: '#9a958a' });
    });
    B('busstop', ctx => {
      diamond(ctx, cx, by, 32, '#b5b6b1');
      box(ctx, cx - 2, by, 16, 14, { left: 'rgba(170,210,235,0.55)', right: 'rgba(140,185,215,0.55)' });
      diamond(ctx, cx - 2, by - 14, 20, '#2f6fa8');
      px(ctx, cx + 10, by - 26, 1, 28, '#6b6e72');
      px(ctx, cx + 6, by - 32, 13, 9, '#2f6fa8'); text(ctx, 'BUS', cx + 7, by - 30, '#ffffff');
      px(ctx, cx - 8, by + 1, 10, 2, '#7b5a3a');
    });
    B('construction', ctx => {
      diamond(ctx, cx, by, 52, '#a08560', { amount: 0.25, dark: '#8c7350', light: '#b39a72', seed: 5 });
      for (const [x, h] of [[cx - 18, 30], [cx - 6, 36], [cx + 6, 36], [cx + 18, 30], [cx, 26]]) px(ctx, x, by + 6 - h - Math.abs(x - cx) / 4, 2, h, '#8a6a3b');
      for (const lv of [10, 20, 30]) for (let x = cx - 18; x < cx + 20; x++) px(ctx, x, by - lv + Math.floor(Math.abs(x - cx) / 2) - 2, 1, 1, '#8a6a3b');
      for (let x = cx - 24; x < cx + 24; x++) px(ctx, x, by + 10 - Math.floor(Math.abs(x - cx) / 2), 1, 2, Math.floor(x / 3) % 2 ? '#f2c230' : '#2c2c2c');
      px(ctx, cx + 4, by - 92, 3, 90, '#e0a020');
      for (let y = by - 92; y < by - 4; y += 6) px(ctx, cx + 4, y, 3, 1, '#a87410');
      px(ctx, cx - 24, by - 92, 40, 3, '#e0a020'); px(ctx, cx - 20, by - 89, 1, 22, '#555'); px(ctx, cx - 22, by - 67, 5, 3, '#555');
    });

    // Vehicles (two directions each)
    const V = (key, draw) => S(key, 44, 34, draw);
    const car = (name, col) => {
      const c = { left: col, right: shade(col, 0.78), top: shade(col, 1.12) };
      const glass = { left: '#9fc4dc', right: '#7ea6c0', top: shade(col, 1.2) };
      V(`car_${name}_c`, ctx => { prism(ctx, 22, 24, 9, 4.5, 5, c); prism(ctx, 21, 19.5, 5, 4, 4, glass); });
      V(`car_${name}_r`, ctx => { prism(ctx, 22, 24, 4.5, 9, 5, c); prism(ctx, 22.5, 20, 4, 5, 4, glass); });
    };
    car('red', '#c94c4c'); car('blue', '#4c7cc9'); car('white', '#e6e6e6'); car('yellow', '#e3c04a'); car('green', '#4f9a6a');
    // Detailed bus: long body with livery stripe, window row, windscreen, wheels and roof.
    const drawBus = (ctx, along) => {
      const cx0 = 26, cy0 = 30, a = along === 'c' ? 16 : 6, b = along === 'c' ? 6 : 16, h = 14;
      const P = (u, v, z = 0) => [cx0 + u - v, cy0 + (u + v) / 2 - z];
      const quadL = (u0, u1, z0, z1, col) => poly(ctx, [P(u0, b, z0), P(u1, b, z0), P(u1, b, z1), P(u0, b, z1)], col); // face along c (v = +b)
      const quadR = (v0, v1, z0, z1, col) => poly(ctx, [P(a, v0, z0), P(a, v1, z0), P(a, v1, z1), P(a, v0, z1)], col); // face along r (u = +a)
      prism(ctx, cx0, cy0, a, b, h, { left: '#2f8f5a', right: '#247a4b', top: '#dfe9e2' });
      poly(ctx, [P(-a + 2, -b + 2, h + 1), P(a - 2, -b + 2, h + 1), P(a - 2, b - 2, h + 1), P(-a + 2, b - 2, h + 1)], '#c9d6cc'); // roof unit
      // the long side gets windows, a stripe and wheels; the short end gets the windscreen
      if (along === 'c') {
        quadL(-a, a, 2, 4, '#f2c230');
        for (let u = -a + 2; u < a - 3; u += 5) quadL(u, u + 4, 7, 12, '#bfe0f0');
        quadL(a - 4, a - 1, 1, 12, '#9fc8de');
        quadR(-b + 1, b - 1, 6, 12, '#9fd0ea'); quadR(-b + 1, b - 1, 2, 4, '#f2c230');
        for (const u of [-a + 4, a - 5]) poly(ctx, [P(u - 2, b, -1), P(u + 2, b, -1), P(u + 2, b, 2), P(u - 2, b, 2)], '#222');
      } else {
        quadR(-b, b, 2, 4, '#f2c230');
        for (let v = -b + 2; v < b - 3; v += 5) quadR(v, v + 4, 7, 12, '#bfe0f0');
        quadR(b - 4, b - 1, 1, 12, '#9fc8de');
        quadL(-a + 1, a - 1, 6, 12, '#9fd0ea'); quadL(-a + 1, a - 1, 2, 4, '#f2c230');
        for (const v of [-b + 4, b - 5]) poly(ctx, [P(a, v - 2, -1), P(a, v + 2, -1), P(a, v + 2, 2), P(a, v - 2, 2)], '#222');
      }
    };
    S('bus_c', 56, 48, ctx => drawBus(ctx, 'c'));
    S('bus_r', 56, 48, ctx => drawBus(ctx, 'r'));
    const truckCol = { left: '#f2f2f2', right: '#cfcfcf', top: '#ffffff' };
    V('truck_c', ctx => { prism(ctx, 20, 24, 11, 5, 11, truckCol); prism(ctx, 33, 30, 4, 5, 7, { left: '#c0392b', right: '#9a2c20', top: '#d65446' }); });
    V('truck_r', ctx => { prism(ctx, 24, 24, 5, 11, 11, truckCol); prism(ctx, 11, 30, 5, 4, 7, { left: '#c0392b', right: '#9a2c20', top: '#d65446' }); });

    // Small sprites
    S('puff', 12, 12, ctx => { for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) { const d = (x - 5.5) ** 2 + (y - 5.5) ** 2; if (d < 30) px(ctx, x, y, 1, 1, d < 8 && x < 6 && y < 6 ? '#b8b8b8' : '#929292'); } });
    S('puff_light', 12, 12, ctx => { for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) { const d = (x - 5.5) ** 2 + (y - 5.5) ** 2; if (d < 30) px(ctx, x, y, 1, 1, '#e4e8e9'); } });
    S('sign_sale', 38, 18, ctx => { px(ctx, 0, 0, 38, 16, '#f2c230'); px(ctx, 0, 15, 38, 1, '#a07a10'); px(ctx, 18, 16, 2, 2, '#5a4a3a'); text(ctx, 'SALE', 3, 3, '#c0392b', 2); });
    S('sign_rent', 34, 30, ctx => { px(ctx, 0, 0, 34, 27, '#c0392b'); px(ctx, 0, 26, 34, 1, '#7a2219'); px(ctx, 16, 27, 2, 3, '#5a4a3a'); text(ctx, 'FOR', 5, 2, '#ffffff', 2); text(ctx, 'RENT', 1, 14, '#ffffff', 2); });
    S('sign_protest', 22, 32, ctx => { px(ctx, 10, 16, 2, 16, '#6b4a2b'); px(ctx, 0, 0, 22, 18, '#f4f1e8'); px(ctx, 0, 17, 22, 1, '#b8b2a0'); text(ctx, '!', 7, 3, '#c0392b', 2); });
    S('smog', 64, 32, ctx => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
        const dx = (x - 32) / 32, dy = (y - 16) / 16, d = dx * dx + dy * dy;
        if (d < 1) { ctx.fillStyle = `rgba(128,112,82,${Math.min(1, (1 - d) * 1.4)})`; ctx.fillRect(x, y, 1, 1); }
      }
    });
  }

  return { makeAll, TW, TH, BH, RIVER_FRAMES: 6 };
})();
