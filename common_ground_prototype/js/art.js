// Common Ground - placeholder pixel art
// Every texture is drawn in code at low resolution (a tile is 32 x 16 pixels)
// and shown at 2x size with pixelArt filtering, which gives the chunky
// isometric look. Replace these with real sprite sheets later: keep the same
// texture keys and nothing else in the game needs to change.

const ART = (() => {
  const TW = 32, TH = 16;      // tile size in art pixels
  const BH = 64;               // building canvas height in art pixels

  // ---- colour helpers
  function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }
  function shade(color, f) {
    const n = typeof color === 'number' ? color : parseInt(color.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r * f)));
    g = Math.max(0, Math.min(255, Math.round(g * f)));
    b = Math.max(0, Math.min(255, Math.round(b * f)));
    return hex((r << 16) | (g << 8) | b);
  }
  function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

  function canvas(scene, key, w, h) {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.createCanvas(key, w, h);
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    return { tex, ctx };
  }
  const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  // ---- shapes, drawn row by row so there is no anti-aliasing
  // Diamond of width w (multiple of 4) centred at (cx, cy).
  function diamond(ctx, cx, cy, w, color, noise) {
    const rows = w / 2, q = w / 4;
    for (let i = 0; i < rows; i++) {
      const half = i < q ? 2 * (i + 1) : 2 * (rows - i);
      px(ctx, cx - half, cy - q + i, half * 2, 1, color);
    }
    if (noise) {
      const r = rng(noise.seed || 3);
      for (let i = 0; i < rows; i++) {
        const half = i < q ? 2 * (i + 1) : 2 * (rows - i);
        for (let x = cx - half; x < cx + half; x++) {
          const v = r();
          if (v < noise.amount) px(ctx, x, cy - q + i, 1, 1, v < noise.amount / 2 ? noise.dark : noise.light);
        }
      }
    }
  }
  function diamondOutline(ctx, cx, cy, w, color, dashed) {
    const rows = w / 2, q = w / 4;
    for (let i = 0; i < rows; i++) {
      const half = i < q ? 2 * (i + 1) : 2 * (rows - i);
      if (dashed && i % 3 === 2) continue;
      px(ctx, cx - half, cy - q + i, 2, 1, color);
      px(ctx, cx + half - 2, cy - q + i, 2, 1, color);
    }
  }
  // An isometric box: footprint width w (multiple of 4), wall height h, centred on (cx, cy).
  function box(ctx, cx, cy, w, h, c) {
    const q = w / 4;
    for (let x = cx - w / 2; x < cx; x++) {           // left wall
      const yb = cy + q - Math.floor((cx - x) / 2);
      px(ctx, x, yb - h, 1, h, c.left);
    }
    for (let x = cx; x < cx + w / 2; x++) {           // right wall
      const yb = cy + q - Math.floor((x - cx + 1) / 2);
      px(ctx, x, yb - h, 1, h, c.right);
    }
    diamond(ctx, cx, cy - h, w, c.top);               // roof
    if (c.edge) { // a light line along the roof's front edges
      for (let x = cx - w / 2; x < cx + w / 2; x++) {
        const d = x < cx ? Math.floor((cx - x) / 2) : Math.floor((x - cx + 1) / 2);
        px(ctx, x, cy + q - d - h, 1, 1, c.edge);
      }
    }
  }
  // Windows on both walls: rows every `vy` pixels, columns every `vx` pixels.
  function windows(ctx, cx, cy, w, h, color, vx = 3, vy = 4, from = 3, lit) {
    const q = w / 4, r = rng(11);
    for (let x = cx - w / 2 + 2; x < cx + w / 2 - 1; x += vx) {
      if (Math.abs(x - cx) < 1) continue;
      for (let lv = from; lv < h - 2; lv += vy) {
        const col = lit && r() < 0.5 ? lit : color;
        for (let k = 0; k < 2; k++) {
          const xx = x + k;
          const d = xx < cx ? Math.floor((cx - xx) / 2) : Math.floor((xx - cx + 1) / 2);
          px(ctx, xx, cy + q - d - lv - 2, 1, 2, col);
        }
      }
    }
  }
  function tree(ctx, x, y, s = 1, color = '#3f7d3a') {
    px(ctx, x, y - 4, 2, 4, '#6b4a2b');
    const rr = 4 * s;
    for (let dy = -rr; dy <= rr; dy++)
      for (let dx = -rr; dx <= rr; dx++)
        if (dx * dx + dy * dy <= rr * rr) px(ctx, x + 1 + dx, y - 6 - rr + dy, 1, 1, dy < -1 && dx < 0 ? shade(color, 1.25) : color);
  }

  // ---- tiny 3x5 pixel font for signs
  const GLYPHS = {
    S: ['111', '100', '111', '001', '111'], A: ['010', '101', '111', '101', '101'],
    L: ['100', '100', '100', '100', '111'], E: ['111', '100', '110', '100', '111'],
    F: ['111', '100', '110', '100', '100'], O: ['111', '101', '101', '101', '111'],
    R: ['110', '101', '110', '101', '101'], N: ['101', '111', '111', '111', '101'],
    T: ['111', '010', '010', '010', '010'], '!': ['010', '010', '010', '000', '010'],
  };
  function text(ctx, str, x, y, color) {
    for (const ch of str) {
      const g = GLYPHS[ch];
      if (g) g.forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') px(ctx, x + i, y + j, 1, 1, color); }));
      x += 4;
    }
  }

  // ------------------------------------------------------------------ textures
  function makeAll(scene) {
    const cx = TW / 2, gy = TH / 2;      // ground tile centre

    // Ground per district
    const grounds = {
      elmwood: { c: '#6fa65a', d: '#5e9450', l: '#86ba6c' },
      market: { c: '#b8b09c', d: '#a59d88', l: '#cbc4b2' },
      ironworks: { c: '#8b8a6b', d: '#77765a', l: '#9d9c7d' },
      millbrook: { c: '#8e9b5b', d: '#7c894e', l: '#a2ae6c' },
    };
    for (const id in grounds) {
      const g = grounds[id];
      let { ctx, tex } = canvas(scene, 'ground_' + id, TW, TH);
      diamond(ctx, cx, gy, TW, g.c, { amount: 0.18, dark: g.d, light: g.l, seed: id.length * 7 });
      tex.refresh();
      // empty plot: same ground with a dirt patch and corner pegs
      ({ ctx, tex } = canvas(scene, 'plot_' + id, TW, TH));
      diamond(ctx, cx, gy, TW, g.c, { amount: 0.18, dark: g.d, light: g.l, seed: id.length * 7 });
      diamond(ctx, cx, gy, 20, '#a08560', { amount: 0.25, dark: '#8c7350', light: '#b39a72', seed: 5 });
      px(ctx, cx - 1, gy - 5, 2, 1, '#f2e6c9'); px(ctx, cx - 1, gy + 4, 2, 1, '#f2e6c9');
      px(ctx, cx - 10, gy, 2, 1, '#f2e6c9'); px(ctx, cx + 8, gy, 2, 1, '#f2e6c9');
      tex.refresh();
    }

    // Roads: along c (down-right on screen), along r (down-left) and crossings
    const road = (key, dir) => {
      const { ctx, tex } = canvas(scene, key, TW, TH);
      diamond(ctx, cx, gy, TW, '#55585c', { amount: 0.08, dark: '#4b4e52', light: '#606368', seed: 9 });
      diamondOutline(ctx, cx, gy, TW, '#7a7d80');
      if (dir === 'c') for (let i = 0; i < 16; i += 4) { px(ctx, 8 + i, 4 + i / 2, 2, 1, '#e8d36a'); }
      if (dir === 'r') for (let i = 0; i < 16; i += 4) { px(ctx, 22 - i, 4 + i / 2, 2, 1, '#e8d36a'); }
      if (dir === 'x') { px(ctx, cx - 4, gy - 1, 8, 2, '#6b6e72'); }
      tex.refresh();
    };
    road('road_c', 'c'); road('road_r', 'r'); road('road_x', 'x');

    // Water (two frames for a shimmer)
    for (const f of ['a', 'b']) {
      const { ctx, tex } = canvas(scene, 'river_' + f, TW, TH);
      diamond(ctx, cx, gy, TW, '#3f78a8', { amount: 0.16, dark: '#356a96', light: f === 'a' ? '#6ea3cf' : '#5b93c2', seed: f === 'a' ? 21 : 37 });
      tex.refresh();
    }
    // Bridges (they run along r)
    const bridge = (key, stage) => {
      const { ctx, tex } = canvas(scene, key, TW, TH + 6);
      diamond(ctx, cx, gy, TW, '#3f78a8', { amount: 0.16, dark: '#356a96', light: '#6ea3cf', seed: 21 });
      if (stage === 'site') { diamondOutline(ctx, cx, gy, TW, '#f2d14b', true); }
      if (stage === 'building' || stage === 'done') {
        px(ctx, cx - 7, gy - 2, 3, 8, '#7d6a55'); px(ctx, cx + 4, gy - 2, 3, 8, '#7d6a55');
      }
      if (stage === 'done') {
        diamond(ctx, cx, gy, 20, '#5f6266');
        for (let i = 0; i < 10; i++) { px(ctx, cx + 4 - i, gy - 5 + Math.floor(i / 2) - 2, 1, 2, '#c9c2b0'); px(ctx, cx + 12 - i - 8, gy + Math.floor(i / 2), 1, 2, '#c9c2b0'); }
      }
      tex.refresh();
    };
    bridge('bridge_site', 'site'); bridge('bridge_building', 'building'); bridge('bridge_done', 'done');

    // Marker for plots where the selected building can go
    {
      const { ctx, tex } = canvas(scene, 'validmark', TW, TH);
      diamond(ctx, cx, gy, TW, '#6dff7e');
      diamondOutline(ctx, cx, gy, TW, '#e9ffe9');
      tex.refresh();
    }
    // Highlight cursor
    {
      const { ctx, tex } = canvas(scene, 'cursor', TW, TH);
      diamondOutline(ctx, cx, gy, TW, '#ffffff');
      tex.refresh();
    }

    // ---- buildings (canvas 32 x 64, tile centre at (16, 56))
    const by = BH - 8;
    const B = (key, draw) => { const { ctx, tex } = canvas(scene, key, TW, BH); draw(ctx); tex.refresh(); };

    B('villa', ctx => {
      box(ctx, cx - 2, by + 1, 16, 9, { left: '#efe2c4', right: '#cdbf9f', top: '#b5533c', edge: '#d0705a' });
      windows(ctx, cx - 2, by + 1, 16, 9, '#5b7da3', 4, 5, 3);
      px(ctx, cx + 1, by - 16, 2, 5, '#7a3b2c');
      tree(ctx, cx + 9, by + 3, 0.8);
    });
    B('flats', ctx => {
      box(ctx, cx, by, 24, 19, { left: '#b7695a', right: '#94524a', top: '#6f6f72', edge: '#c98375' });
      windows(ctx, cx, by, 24, 19, '#3c4f63', 3, 4, 3, '#f0d27a');
    });
    B('office', ctx => {
      box(ctx, cx, by, 20, 40, { left: '#7fa6c4', right: '#5d86a8', top: '#d5dde3', edge: '#b9d3e6' });
      windows(ctx, cx, by, 20, 40, '#cfe6f5', 2, 3, 3);
    });
    const shop = (key, s) => B(key, ctx => {
      const wall = s === 'closed' ? { left: '#9b9184', right: '#7f776c', top: '#5d5a55' } : { left: '#e8d9b5', right: '#c7b893', top: '#7b6a58' };
      box(ctx, cx, by, 24, 11, wall);
      const aw = s === 'open' ? ['#3f9b5a', '#f4f1e8'] : s === 'sale' ? ['#e08a2e', '#f4f1e8'] : ['#6b5d50', '#6b5d50'];
      for (let x = cx - 12; x < cx + 12; x++) {     // awning stripe along the walls
        const d = x < cx ? Math.floor((cx - x) / 2) : Math.floor((x - cx + 1) / 2);
        px(ctx, x, by + 6 - d - 9, 1, 2, (Math.floor(x / 2) % 2) ? aw[0] : aw[1]);
      }
      const win = s === 'open' ? '#f6d77d' : s === 'sale' ? '#c9b98a' : '#3b3631';
      windows(ctx, cx, by, 24, 7, win, 3, 4, 1);
      if (s === 'closed') { for (let x = cx - 9; x < cx - 2; x += 3) { const d = Math.floor((cx - x) / 2); px(ctx, x, by + 6 - d - 6, 2, 1, '#8a6a46'); } }
    });
    shop('shop_open', 'open'); shop('shop_sale', 'sale'); shop('shop_closed', 'closed');

    const factory = (key, filtered) => B(key, ctx => {
      box(ctx, cx - 1, by, 24, 14, { left: '#8c8f93', right: '#6e7175', top: '#585b5f', edge: '#a3a6aa' });
      windows(ctx, cx - 1, by, 24, 14, '#3e4245', 4, 5, 4);
      px(ctx, cx + 5, by - 34, 3, 24, '#7a4f3e');           // chimney
      px(ctx, cx + 5, by - 34, 3, 2, filtered ? '#4caf6a' : '#3e2a22');
      if (filtered) px(ctx, cx + 5, by - 26, 3, 2, '#4caf6a');
    });
    factory('factory', false); factory('factory_f', true);
    B('coal', ctx => {
      box(ctx, cx - 2, by + 1, 20, 12, { left: '#5c5552', right: '#47413f', top: '#3a3533', edge: '#6e6663' });
      px(ctx, cx + 4, by - 40, 4, 34, '#6b4a3c'); px(ctx, cx + 9, by - 36, 3, 28, '#6b4a3c');
      px(ctx, cx + 4, by - 40, 4, 2, '#d8d8d8'); px(ctx, cx + 9, by - 36, 3, 2, '#d8d8d8');
      px(ctx, cx - 10, by - 6, 6, 3, '#2a2523');                       // coal heap
    });
    B('warehouse', ctx => {
      box(ctx, cx, by, 28, 10, { left: '#7d93a3', right: '#62788a', top: '#9aa5ad', edge: '#b4c0c8' });
      for (let x = cx - 13; x < cx + 13; x += 2) {       // corrugated walls
        const d = x < cx ? Math.floor((cx - x) / 2) : Math.floor((x - cx + 1) / 2);
        px(ctx, x, by + 7 - d - 9, 1, 9, x < cx ? '#6f8595' : '#566b7c');
      }
      px(ctx, cx - 7, by + 1, 4, 5, '#3f4a52');           // loading door
      px(ctx, cx + 2, by - 14, 3, 2, '#5d676e'); px(ctx, cx - 4, by - 16, 3, 2, '#5d676e');
    });
    B('tree', ctx => { tree(ctx, cx - 5, by + 2, 1); tree(ctx, cx + 5, by + 4, 0.8, '#4b8c41'); });
    B('park', ctx => {
      diamond(ctx, cx, by, 28, '#79c25f', { amount: 0.2, dark: '#69b052', light: '#91d477', seed: 13 });
      for (let i = 0; i < 12; i++) px(ctx, cx - 6 + i, by - 3 + Math.floor(i / 2), 1, 1, '#d8c79a');
      tree(ctx, cx - 7, by + 1, 0.9); tree(ctx, cx + 7, by - 1, 1.1, '#4b8c41'); tree(ctx, cx + 1, by + 6, 0.7);
      px(ctx, cx - 2, by - 4, 4, 1, '#7b5a3a');
      px(ctx, cx - 8, by + 4, 2, 2, '#e85d75'); px(ctx, cx + 9, by + 2, 2, 2, '#f2d14b');
    });
    B('clinic', ctx => {
      box(ctx, cx, by, 20, 16, { left: '#f4f4f2', right: '#d6d6d2', top: '#9fb7c4', edge: '#ffffff' });
      windows(ctx, cx, by, 20, 16, '#7fa9c9', 4, 5, 3);
      px(ctx, cx - 7, by - 12, 4, 1, '#d83a3a'); px(ctx, cx - 6, by - 13, 2, 3, '#d83a3a');
    });
    B('social', ctx => {
      box(ctx, cx, by, 24, 30, { left: '#8fc7bf', right: '#6fa69e', top: '#5f6e73', edge: '#b1ddd6' });
      windows(ctx, cx, by, 24, 30, '#33525a', 3, 4, 3, '#f0d27a');
      tree(ctx, cx - 11, by + 5, 0.6);
    });
    B('bus', ctx => {
      diamond(ctx, cx, by, 24, '#8b8e91');
      box(ctx, cx - 4, by - 1, 8, 8, { left: '#4b7fb5', right: '#3a6694', top: '#2f5478' });
      box(ctx, cx + 5, by + 2, 12, 6, { left: '#f2c230', right: '#d0a21c', top: '#f7da74' });
      px(ctx, cx + 1, by - 3, 6, 1, '#2c2c2c');
    });
    B('solar', ctx => {
      diamond(ctx, cx, by, 28, '#9aa86a');
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 14; i++) px(ctx, cx - 10 + i + row * 3, by - 5 + Math.floor(i / 2) + row * 2 - row, 1, 2, i % 3 === 0 ? '#6f8fb8' : '#2f4f7f');
    });
    B('construction', ctx => {
      diamond(ctx, cx, by, 24, '#a08560');
      box(ctx, cx, by, 16, 12, { left: 'rgba(0,0,0,0)', right: 'rgba(0,0,0,0)', top: 'rgba(0,0,0,0)' });
      for (const [x, h] of [[cx - 8, 14], [cx, 18], [cx + 7, 14], [cx - 1, 10]]) px(ctx, x, by + 2 - h, 1, h, '#8a6a3b');
      for (let x = cx - 8; x < cx + 8; x++) px(ctx, x, by - 10 + Math.floor(Math.abs(x - cx) / 2), 1, 1, '#8a6a3b');
      for (let x = cx - 10; x < cx + 10; x++) px(ctx, x, by + 5 - Math.floor(Math.abs(x - cx) / 2), 1, 1, (Math.floor(x / 2) % 2) ? '#f2c230' : '#2c2c2c');
      px(ctx, cx + 2, by - 26, 1, 22, '#e0a020'); px(ctx, cx - 6, by - 26, 14, 1, '#e0a020');
    });

    // ---- small sprites
    const S = (key, w, h, draw) => { const { ctx, tex } = canvas(scene, key, w, h); draw(ctx); tex.refresh(); };
    S('puff', 6, 6, ctx => { px(ctx, 1, 0, 4, 6, '#9a9a9a'); px(ctx, 0, 1, 6, 4, '#9a9a9a'); px(ctx, 1, 1, 2, 2, '#b8b8b8'); });
    S('puff_light', 6, 6, ctx => { px(ctx, 1, 0, 4, 6, '#d9dedf'); px(ctx, 0, 1, 6, 4, '#d9dedf'); });
    S('sign_sale', 19, 9, ctx => { px(ctx, 0, 0, 19, 9, '#f2c230'); px(ctx, 0, 8, 19, 1, '#a07a10'); text(ctx, 'SALE', 2, 2, '#c0392b'); });
    S('sign_rent', 15, 15, ctx => {
      px(ctx, 0, 0, 15, 14, '#c0392b'); px(ctx, 0, 13, 15, 1, '#7a2219'); px(ctx, 7, 14, 1, 1, '#5a4a3a');
      text(ctx, 'FOR', 2, 1, '#ffffff'); text(ctx, 'RENT', 0, 7, '#ffffff');
    });
    S('sign_protest', 11, 16, ctx => {
      px(ctx, 5, 8, 1, 8, '#6b4a2b'); px(ctx, 0, 0, 11, 9, '#f4f1e8'); px(ctx, 0, 8, 11, 1, '#b8b2a0'); text(ctx, '!', 4, 2, '#c0392b');
    });
    S('person', 3, 6, ctx => { px(ctx, 1, 0, 1, 1, '#f0c9a0'); px(ctx, 0, 1, 3, 3, '#3a6694'); px(ctx, 0, 4, 1, 2, '#333'); px(ctx, 2, 4, 1, 2, '#333'); });
    const car = (key, col) => S(key, 12, 10, ctx => box(ctx, 6, 6, 8, 3, { left: col, right: shade(col, 0.8), top: shade(col, 1.15) }));
    car('car_red', '#c94c4c'); car('car_blue', '#4c7cc9'); car('car_white', '#e6e6e6'); car('car_yellow', '#e3c04a');
    S('truck', 16, 14, ctx => {
      box(ctx, 8, 9, 12, 7, { left: '#f2f2f2', right: '#cfcfcf', top: '#ffffff' });
      px(ctx, 3, 3, 4, 1, '#c0392b'); px(ctx, 9, 3, 4, 1, '#c0392b');
    });
    S('smog', 32, 16, ctx => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
        const dx = (x - 16) / 16, dy = (y - 8) / 8, d = dx * dx + dy * dy;
        if (d < 1) { ctx.fillStyle = `rgba(128,112,82,${Math.min(1, (1 - d) * 1.4)})`; ctx.fillRect(x, y, 1, 1); }
      }
    });
  }

  return { makeAll, TW, TH, BH };
})();
