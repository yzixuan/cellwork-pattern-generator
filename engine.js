/* Cellwork pattern engine.
   createCellworkEngine(S) draws patterns from a settings object S and nothing else: no DOM
   lookups, no UI state. The app calls it once with its live settings. The "Code (HTML)" export
   embeds this whole function's source (via toString) in a standalone player, so keep it
   self-contained: anything it needs must be defined inside it. */
function createCellworkEngine(S) {
  "use strict";
  const TAU = Math.PI * 2;
  const GLYPHS = ".:-=+*#%@";

  /* ---------- maths helpers ---------- */
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(x, y, z) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  // Seeded 2D value noise and fractal sum, both 0..1.
  function makeNoise(seed) {
    const rand = mulberry32(seed * 7919 + 17);
    const perm = new Uint8Array(512);
    const base = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
    const vals = Float32Array.from({ length: 256 }, rand);
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const X = xi & 255, Y = yi & 255;
      const a = vals[perm[perm[X] + Y]], b = vals[perm[perm[X + 1] + Y]];
      const c = vals[perm[perm[X] + Y + 1]], d = vals[perm[perm[X + 1] + Y + 1]];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm = (x, y, oct) => {
      let sum = 0, amp = 0.5, norm = 0;
      for (let o = 0; o < oct; o++) { sum += amp * noise(x, y); norm += amp; x = x * 2.03 + 11.1; y = y * 2.03 + 7.3; amp *= 0.5; }
      return sum / norm;
    };
    return { noise, fbm };
  }

  /* ---------- generators ----------
     Each returns a value 0..1 for a point (u, v) in a space where the frame's shorter side
     spans -1..1. T is the loop phase in radians (0..2π); every motion uses whole multiples
     of T so exported loops repeat seamlessly. */
  const GENS = {
    waves: {
      name: "Waves",
      fn(u, v, T, P) {
        const f = P.f, sway = P.dist / 50;
        const centre = sway * (0.18 * Math.sin(2.2 * u * f - T + P.r[0] * TAU) + 0.06 * Math.sin(5.1 * u * f + 2 * T + P.r[1] * TAU));
        const d = Math.abs(v - centre) * (1 + 0.6 * u * u);
        const bands = 1.5 + P.cx * 1.2;
        const wave = 0.5 + 0.5 * Math.sin(bands * Math.PI * d * f - 2 * T);
        const beat = 0.6 + 0.4 * Math.sin(1.4 * u * f + T - 2 * d + P.r[2] * TAU);
        const env = 1 - smooth(0.55, 1.2, d);
        return Math.pow(wave * beat * env, 0.7);
      },
    },
    ripples: {
      name: "Ripples",
      fn(u, v, T, P) {
        let s = 0;
        const n = P.cx, wob = (P.dist / 100) * 0.35;
        for (let i = 0; i < n; i++) {
          const src = P.src[i];
          const sx = (src[0] * 2 - 1) * 0.8 * P.ax, sy = (src[1] * 2 - 1) * 0.7 * P.ay;
          let d = Math.hypot(u - sx, v - sy);
          if (wob) d += wob * (P.noise(u * 1.6 + Math.cos(T) * 0.6, v * 1.6 + Math.sin(T) * 0.6) - 0.5);
          s += 0.5 + 0.5 * Math.sin(d * 9 * P.f - 2 * T + src[2]);
        }
        return Math.pow(s / n, 1.2);
      },
    },
    noise: {
      name: "Noise Field",
      fn(u, v, T, P) {
        const f = P.f * 1.4;
        let x = u * f + Math.cos(T) * 0.7, y = v * f + Math.sin(T) * 0.7;
        if (P.dist > 0) {
          const w = (P.dist / 100) * 1.6;
          x += w * (P.fbm(x + 1.7, y + 9.2, 2) - 0.5) * 2;
          y += w * (P.fbm(x + 8.3, y + 2.8, 2) - 0.5) * 2;
        }
        return smooth(0.28, 0.72, P.fbm(x, y, P.cx));
      },
    },
    spiral: {
      name: "Spiral",
      fn(u, v, T, P) {
        const r = Math.hypot(u, v), a = Math.atan2(v, u);
        const arms = P.cx + 1, twist = (P.dist / 100) * 7;
        const w = 0.5 + 0.5 * Math.sin(arms * a + twist * r * P.f - T + P.r[0] * TAU);
        const rings = 0.65 + 0.35 * Math.sin(r * P.f * 8 - 2 * T);
        return Math.pow(w * rings * (1 - smooth(0.85, 1.7, r / Math.max(P.f, 0.4))), 0.8);
      },
    },
    stripes: {
      name: "Stripes",
      fn(u, v, T, P) {
        const ang = P.r[3] * Math.PI;
        const x = u * Math.cos(ang) + v * Math.sin(ang);
        const warp = (P.dist / 100) * 2.4 * (P.fbm(u * 1.2 + Math.cos(T) * 0.5, v * 1.2 + Math.sin(T) * 0.5, 2) - 0.5) * 2;
        return 0.5 + 0.5 * Math.sin((x * P.f * (2 + P.cx * 1.5) + warp) * Math.PI - T);
      },
    },
    squares: {
      name: "Squares",
      hidden: true, // kept in code, left out of the pattern menu for now
      fn(u, v, T, P) {
        let m = 0;
        const width = 0.03 + (P.dist / 100) * 0.1;
        for (const q of P.sqPlaced) {
          const b = q.half / P.f, r = b * 0.22;
          const dx = u - q.x, dy = v - q.y;
          // Skip squares too far away to light this cell (exp(-5) is effectively 0).
          const reach = b * 1.42 + width * 5;
          if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
          // Squares look the same every quarter turn, so k/4 turns per loop repeats cleanly.
          const a = q.ph + (T * q.k) / 4;
          const c = Math.cos(a), s = Math.sin(a);
          const px = Math.abs(c * dx + s * dy), py = Math.abs(-s * dx + c * dy);
          const qx = px - b + r, qy = py - b + r;
          const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
          m = Math.max(m, Math.exp(-Math.abs(sd) / width));
        }
        return m;
      },
    },
    trees: {
      name: "Trees",
      spacing: 6, // thin branches need fine cells
      fn(u, v, T, P) {
        const A = P.lsys;
        const ix = Math.round((u - A.u0) / A.du), iy = Math.round((v - A.v0) / A.du);
        if (ix < 0 || iy < 0 || ix >= A.cols || iy >= A.rows) return 0;
        return A.val[iy * A.cols + ix];
      },
    },
    rain: {
      name: "Rain Drops",
      fn(u, v, T, P) {
        const tau = T / TAU, R = 0.5 / P.f, w = 0.022 + (P.dist / 100) * 0.05;
        const reach = R * 1.25 + w * 3;
        let m = 0;
        for (const q of P.drops) {
          // Each drop falls k times per loop; the landing spot cycles through k places,
          // so the loop still repeats seamlessly.
          const ph = tau * q.k - q.t0, cyc = Math.floor(ph), age = ph - cyc;
          const spot = q.spots[((cyc % q.k) + q.k) % q.k];
          const dx = u - spot[0], dy = v - spot[1];
          if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
          const d = Math.hypot(dx, dy);
          const radius = age * R * spot[2];
          const fade = (1 - age) * (1 - age);
          let val = Math.exp(-(((d - radius) / w) ** 2)) * fade;                   // outer ring
          val += 0.45 * Math.exp(-(((d - radius * 0.55) / (w * 0.8)) ** 2)) * fade * smooth(0.02, 0.1, radius); // trailing ring
          if (age < 0.06) val += (1 - age / 0.06) * Math.exp(-((d / (w * 1.6)) ** 2)); // splash on impact
          m += val;
        }
        return Math.min(1, m);
      },
    },
    attractor: {
      name: "Lorenz Attractor",
      hidden: true, // kept in code, left out of the pattern menu for now
      spacing: 9, // thin orbit lines need finer cells
      fn(u, v, T, P) {
        // Density was binned per cell in buildAttractor(); look this cell up.
        const A = P.att;
        const ix = Math.round((u - A.u0) / A.du), iy = Math.round((v - A.v0) / A.du);
        if (ix < 0 || iy < 0 || ix >= A.cols || iy >= A.rows) return 0;
        return A.val[iy * A.cols + ix];
      },
    },
    clifford: {
      name: "Clifford Attractor",
      minScale: 180, // at lower zoom the filaments are too fine to read
      noDistortion: true,
      spacing: 6, // fine cells show the speckle and filaments
      fn(u, v, T, P) {
        const A = P.cliff;
        const ix = Math.round((u - A.u0) / A.du), iy = Math.round((v - A.v0) / A.du);
        if (ix < 0 || iy < 0 || ix >= A.cols || iy >= A.rows) return 0;
        return A.val[iy * A.cols + ix];
      },
    },
  };

  let P = null;
  function buildP() {
    const rng = mulberry32(S.seed);
    const nz = makeNoise(S.seed);
    P = {
      f: S.scale / 100, cx: S.complexity, dist: S.distortion,
      r: [rng(), rng(), rng(), rng()],
      src: Array.from({ length: 8 }, () => [rng(), rng(), rng() * TAU]),
      noise: nz.noise, fbm: nz.fbm, ax: 1, ay: 1, sqKey: "", sqPlaced: [], dropKey: "", drops: [],
      attKey: "", att: null, lorenzKey: "", lorenz: null,
      cliffKey: "", cliff: null, cliffPickKey: "", cliffPick: null, cliffRefKey: "", cliffRef: 1, lsysKey: "", lsys: null, lsysPlantKey: "", lsysPlant: null, cliffOrbitKey: "", cliffOrbit: null,
    };
  }

  // Scatter the squares over the whole frame with best-candidate sampling: each new square
  // takes the spot, out of a dozen random tries, that is farthest from those already placed.
  // Depends on the frame's aspect, so it reruns when the format changes.
  function placeSquares() {
    const key = `${P.ax.toFixed(3)}:${P.ay.toFixed(3)}`;
    if (P.sqKey === key) return;
    const rng = mulberry32(S.seed * 31 + 5);
    const n = Math.min(40, Math.round((3 + P.cx * 2.5) * Math.sqrt(P.ax * P.ay)));
    const mx = P.ax * 0.92, my = P.ay * 0.92;
    const placed = [];
    for (let i = 0; i < n; i++) {
      let best = null, bestD = -1;
      for (let c = 0; c < 12; c++) {
        const x = (rng() * 2 - 1) * mx, y = (rng() * 2 - 1) * my;
        let d = Infinity;
        for (const q of placed) d = Math.min(d, Math.hypot(x - q.x, y - q.y));
        if (d > bestD) { bestD = d; best = { x, y }; }
      }
      best.half = 0.08 + 0.2 * Math.pow(rng(), 1.6); // mostly small, a few large
      best.ph = rng() * TAU;
      best.k = (1 + Math.floor(rng() * 3)) * (rng() < 0.5 ? -1 : 1);
      placed.push(best);
    }
    P.sqKey = key;
    P.sqPlaced = placed;
  }

  // Lorenz attractor: the 3D path of
  //   dx/dt = σ(y − x),  dy/dt = x(ρ − z) − y,  dz/dt = xy − βz
  // traced once per seed/detail, viewed face-on and projected onto the cells. Each cell counts
  // how much of the path passes through it, weighted so the near side reads brighter.
  function traceLorenz() {
    const key = `${S.seed}:${P.cx}`;
    if (P.lorenzKey === key) return P.lorenz;
    const rng = mulberry32(S.seed * 97 + 3);
    const sigma = 10 + (rng() - 0.5) * 2, rho = 28 + (rng() - 0.5) * 4, beta = 8 / 3;
    const f = (x, y, z) => [sigma * (y - x), x * (rho - z) - y, x * y - beta * z];
    // Few enough loops that individual orbits stay distinct instead of filling the wings.
    const N = 2500 + P.cx * 3500, dt = 0.005, skip = 1000;
    const pts = new Float32Array(N * 3);
    let x = 0.1 + rng() * 0.1, y = 0, z = 0;
    let mz = 0, R = 0;
    for (let i = 0; i < N + skip; i++) {
      // Runge-Kutta 4 keeps the path smooth at this step size.
      const k1 = f(x, y, z);
      const k2 = f(x + (dt / 2) * k1[0], y + (dt / 2) * k1[1], z + (dt / 2) * k1[2]);
      const k3 = f(x + (dt / 2) * k2[0], y + (dt / 2) * k2[1], z + (dt / 2) * k2[2]);
      const k4 = f(x + dt * k3[0], y + dt * k3[1], z + dt * k3[2]);
      x += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      y += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      z += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      if (i < skip) continue;
      const j = (i - skip) * 3;
      pts[j] = x; pts[j + 1] = y; pts[j + 2] = z;
      mz += z;
    }
    mz /= N;
    for (let j = 0; j < pts.length; j += 3) {
      pts[j + 2] -= mz;
      R = Math.max(R, Math.hypot(pts[j], pts[j + 1]));
    }
    // The wings' centres sit on the x = y diagonal, so face-on is a -45° turn; vary a little per seed.
    P.lorenz = { pts, R, yaw0: -Math.PI / 4 + (rng() - 0.5) * 0.5, tilt: (rng() - 0.5) * 16, viewKey: "" };
    P.lorenzKey = key;
    return P.lorenz;
  }

  function buildAttractor(T, cols, rows, u0, v0, du) {
    const key = `${T.toFixed(5)}:${cols}:${rows}:${u0.toFixed(4)}:${v0.toFixed(4)}`;
    if (P.attKey === key) return;
    const L = traceLorenz();
    const pitch = ((8 + P.dist * 0.5 + L.tilt) * Math.PI) / 180; // Distortion tilts the camera
    const cy = Math.cos(L.yaw0), sy = Math.sin(L.yaw0), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const pts = L.pts, count = pts.length / 3;

    // Project every point once per view and frame size; the drawing animation then just
    // bins a growing prefix of this list.
    const viewKey = `${P.dist}:${cols}:${rows}:${u0.toFixed(4)}:${v0.toFixed(4)}:${P.f}:${P.ax.toFixed(3)}:${P.ay.toFixed(3)}`;
    if (L.viewKey !== viewKey) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const X = new Float32Array(count), Y = new Float32Array(count), W = new Float32Array(count);
      for (let i = 0, j = 0; i < count; i++, j += 3) {
        const x = pts[j] * cy - pts[j + 1] * sy, y = pts[j] * sy + pts[j + 1] * cy, z = pts[j + 2];
        X[i] = x; Y[i] = -z * cp + y * sp;
        W[i] = 0.75 - 0.35 * ((y * cp + z * sp) / L.R); // nearer side brighter
        if (X[i] < x0) x0 = X[i]; if (X[i] > x1) x1 = X[i]; if (Y[i] < y0) y0 = Y[i]; if (Y[i] > y1) y1 = Y[i];
      }
      const fit = Math.min((2 * P.ax) / (x1 - x0), (2 * P.ay) / (y1 - y0)) * 0.9 * P.f;
      const cell = new Int32Array(count);
      const full = new Float32Array(cols * rows);
      for (let i = 0; i < count; i++) {
        const ix = Math.round(((X[i] - (x0 + x1) / 2) * fit - u0) / du);
        const iy = Math.round(((Y[i] - (y0 + y1) / 2) * fit - v0) / du);
        cell[i] = ix >= 0 && iy >= 0 && ix < cols && iy < rows ? iy * cols + ix : -1;
        if (cell[i] >= 0) full[cell[i]] += W[i];
      }
      // Brightness is set against the finished shape (90th percentile of its lit cells), so
      // lines keep the same brightness while they draw in.
      const lit = [];
      for (let i = 0; i < full.length; i++) if (full[i] > 0) lit.push(full[i]);
      lit.sort((a, b) => a - b);
      Object.assign(L, { viewKey, cell, W, ref: lit.length ? lit[Math.floor(lit.length * 0.9)] : 1 });
    }

    // The path draws itself over 80% of the loop with a bright head, holds, then fades out,
    // so the loop starts and ends empty. With Animation off it freezes on the current frame.
    const tau = T / TAU;
    const grow = smooth(0, 0.8, tau);
    const fade = 1 - smooth(0.9, 1, tau);
    const shown = Math.floor(count * grow);
    const head = Math.max(1, Math.floor(count * 0.02));
    const hist = new Float32Array(cols * rows);
    for (let i = 0; i < shown; i++) {
      const c = L.cell[i];
      if (c < 0) continue;
      hist[c] += L.W[i] * (grow < 1 && i > shown - head ? 4 : 1);
    }
    for (let i = 0; i < hist.length; i++) hist[i] = Math.pow(Math.min(1, hist[i] / L.ref), 0.6) * fade;
    P.att = { val: hist, cols, rows, u0, v0, du };
    P.attKey = key;
  }

  // Clifford attractor:  x' = sin(a·y) + c·cos(a·x),  y' = sin(b·x) + d·cos(b·y).
  // Iterated a few hundred thousand times; each cell counts how often the orbit lands in it.
  // In Ambient the four parameters glide along a short straight path and back once per loop
  // (sin T), so the filaments slide one way, ease to a stop, and retrace their course; the
  // loop joins seamlessly and only ever visits one short stretch of parameter space.
  const CLIFF_FLOW = 0.14; // how far the parameters travel from the centre of the path
  const CLIFF_CHECKS = 16; // points along the path tested for collapse when picking a shape
  const cliffordParams = (pick, T) => {
    const s = pick.amp * Math.sin(T);
    return pick.base.map((v, i) => v + s * pick.dir[i]);
  };
  const cliffordOrbit = (p, steps, visit) => {
    const [a, b, c, d] = p;
    let x = 0.1, y = 0.1;
    for (let i = 0; i < steps + 100; i++) {
      const nx = Math.sin(a * y) + c * Math.cos(a * x);
      y = Math.sin(b * x) + d * Math.cos(b * y);
      x = nx;
      if (i >= 100) visit(x, y); // skip the run-in before the orbit settles
    }
  };

  // Most random parameters collapse to a few points or a loop. Search seeded candidates and
  // keep the one whose orbit stays most spread out at its worst point along the whole path,
  // so the shape never collapses mid-animation. Also measures its bounds for framing.
  function pickClifford() {
    const key = `${S.seed}`;
    if (P.cliffPickKey === key) return P.cliffPick;
    const rng = mulberry32(S.seed * 97 + 3);
    const GRID = 64;
    let best = null, bestScore = -1;
    for (let tries = 0; tries < 150 && bestScore < 900; tries++) {
      const base = [rng() * 4 - 2, rng() * 4 - 2, rng() * 3 - 1.5, rng() * 3 - 1.5];
      const raw = [rng() - 0.5, rng() - 0.5, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5];
      const len = Math.hypot(...raw) || 1;
      const cand = { base, dir: raw.map((v) => v / len), amp: CLIFF_FLOW };
      let minCov = Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k < CLIFF_CHECKS && minCov > bestScore; k++) {
        // Points spread from one end of the path to the other (T = -π/2 … π/2).
        const T = -Math.PI / 2 + (Math.PI * k) / (CLIFF_CHECKS - 1);
        const seen = new Uint8Array(GRID * GRID);
        let cov = 0;
        cliffordOrbit(cliffordParams(cand, T), 4000, (x, y) => {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          const c = Math.floor(((y + 2.5) / 5) * GRID) * GRID + Math.floor(((x + 2.5) / 5) * GRID);
          if (!seen[c]) { seen[c] = 1; cov++; }
        });
        minCov = Math.min(minCov, cov);
      }
      if (minCov > bestScore) { bestScore = minCov; best = { ...cand, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, sx: x1 - x0, sy: y1 - y0 }; }
    }
    P.cliffPick = best;
    P.cliffPickKey = key;
    return best;
  }

  function buildClifford(T, cols, rows, u0, v0, du) {
    const key = `${T.toFixed(5)}:${cols}:${rows}:${u0.toFixed(4)}:${v0.toFixed(4)}`;
    if (P.cliffKey === key) return;
    const pick = pickClifford();
    const fit = Math.min((2 * P.ax) / pick.sx, (2 * P.ay) / pick.sy) * 0.88 * P.f; // Scale zooms
    const N = 60000 + P.cx * 60000;
    const binInto = (hist, p) => cliffordOrbit(p, N, (x, y) => {
      const ix = Math.round(((x - pick.cx) * fit - u0) / du), iy = Math.round(((y - pick.cy) * fit - v0) / du);
      if (ix >= 0 && iy >= 0 && ix < cols && iy < rows) hist[iy * cols + ix]++;
    });
    // One brightness reference for the whole loop (the busiest cell at the middle and both ends
    // of the path), instead of each frame's own busiest cell, so frames don't flash.
    const refKey = `${S.seed}:${N}:${cols}:${rows}:${u0.toFixed(4)}:${v0.toFixed(4)}:${fit.toFixed(5)}`;
    if (P.cliffRefKey !== refKey) {
      let max = 0;
      for (const t of [0, Math.PI / 2, -Math.PI / 2]) {
        const h = new Float32Array(cols * rows);
        binInto(h, cliffordParams(pick, t));
        for (let i = 0; i < h.length; i++) if (h[i] > max) max = h[i];
      }
      P.cliffRef = Math.log1p(max);
      P.cliffRefKey = refKey;
    }
    const hist = new Float32Array(cols * rows);
    binInto(hist, cliffordParams(pick, T));
    // Log scale so faint filaments still show next to dense cores.
    for (let i = 0; i < hist.length; i++) hist[i] = Math.pow(Math.min(1, Math.log1p(hist[i]) / P.cliffRef), 0.85);
    P.cliff = { val: hist, cols, rows, u0, v0, du };
    P.cliffKey = key;
  }

  // L-systems: a string of symbols is rewritten by plant rules a few times, then read by a
  // "turtle": F = step forward and draw, + / − = turn, [ ] = save / return to a branch point.
  // The canvas shows plants rooted just outside every edge (from below, hanging from above,
  // reaching in from the sides), each a seeded specimen of one of four rule sets, so only
  // their crowns are in frame. Three forests take turns: each grows in from its first visible
  // branch while the one before it fades away, so nothing ever "ungrows" and the loop starts
  // and ends on the first forest fully grown. A gentle wind sways every plant.
  const LSYS_PLANTS = [
    { axiom: "X", angle: 25, rules: { X: ["F+[[X]-X]-F[-FX]+X", "F-[[X]+X]+F[+FX]-X", "F+[[X]-X]-F[-FX]+X"], F: ["FF"] }, depth: [3, 4, 5, 5, 6, 6] },
    { axiom: "F", angle: 22.5, rules: { F: ["FF+[+F-F-F]-[-F+F+F]", "FF-[-F+F+F]+[+F-F-F]"] }, depth: [2, 3, 3, 4, 4, 4] },
    { axiom: "F", angle: 25.7, rules: { F: ["F[+F]F[-F]F", "F[+F]F", "F[-F]F"] }, depth: [3, 3, 4, 4, 5, 5] },
    { axiom: "X", angle: 22, rules: { X: ["F[+X][-X]FX", "F[-X]FX", "F[+X]FX", "F[+X][-X]X"], F: ["FF"] }, depth: [4, 5, 5, 6, 6, 7] },
  ];
  const LSYS_MAX = 250000; // cap on the forests' total rewritten symbols so high Detail stays fast
  const LSYS_FORESTS = 3;  // forests that take turns in one loop

  // Rewrite one plant's string, with a fixed random twist per turn (Distortion).
  function growPlant(rng, type, cap) {
    const plant = LSYS_PLANTS[type];
    let str = plant.axiom;
    for (let g = 0; g < plant.depth[Math.min(5, P.cx - 1)]; g++) {
      let next = "";
      for (const ch of str) {
        const opts = plant.rules[ch];
        next += opts ? opts[Math.floor(rng() * opts.length)] : ch;
        if (next.length > cap) break;
      }
      if (next.length > cap) break;
      str = next;
    }
    const jitter = new Float32Array(str.length);
    const j = (P.dist / 100) * 0.5;
    for (let i = 0; i < str.length; i++) jitter[i] = (rng() - 0.5) * j;
    return { str, angle: (plant.angle * Math.PI) / 180, jitter };
  }

  // Walk the turtle. `sway` bends every forward step a little (slightly more on higher branches);
  // callers divide it by the plant's length so the total lean at the tips stays gentle.
  // Returns segments as flat arrays plus each one's branch depth and distance from the root.
  function walkPlant(plant, sway) {
    const { str, angle, jitter } = plant;
    const segs = [];
    const stack = [];
    let x = 0, y = 0, h = -Math.PI / 2, depth = 0, dist = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "F") {
        h += sway * (1 + depth * 0.15);
        const nx = x + Math.cos(h), ny = y + Math.sin(h);
        segs.push(x, y, nx, ny, depth, dist);
        x = nx; y = ny; dist++;
      } else if (ch === "+") h += angle + jitter[i];
      else if (ch === "-") h -= angle + jitter[i];
      else if (ch === "[") { stack.push(x, y, h, depth, dist); depth++; }
      else if (ch === "]") { dist = stack.pop(); depth = stack.pop(); h = stack.pop(); y = stack.pop(); x = stack.pop(); }
    }
    return segs;
  }

  // Plant every forest: strings, anchor edge, direction, size and timing per plant. Depends on
  // the frame's shape, since wider formats get more plants.
  function plantForest() {
    const key = `${S.seed}:${P.cx}:${P.dist}:${P.ax.toFixed(3)}:${P.ay.toFixed(3)}`;
    if (P.lsysPlantKey === key) return P.lsysPlant;
    const ax = P.ax, ay = P.ay;
    const n = Math.max(3, Math.min(9, Math.round(ax * 2.4 + 0.5)));
    const trees = [];
    for (let gen = 0; gen < LSYS_FORESTS; gen++) {
      const rng = mulberry32(S.seed * 131 + 7 + gen * 7919);
      for (let i = 0; i < n; i++) {
        const plant = growPlant(rng, Math.floor(rng() * LSYS_PLANTS.length), LSYS_MAX / (LSYS_FORESTS * n));
        const segs = walkPlant(plant, 0);
        let top = 0, maxDepth = 0, maxDist = 1;
        for (let k = 0; k < segs.length; k += 6) {
          top = Math.min(top, segs[k + 3]);
          maxDepth = Math.max(maxDepth, segs[k + 4]); maxDist = Math.max(maxDist, segs[k + 5] + 1);
        }
        // About half the plants grow up from below; the rest hang from above or reach in from a side.
        const edge = i < Math.ceil(n / 2) ? "bottom" : ["top", "left", "right"][Math.floor(rng() * 3)];
        const along = (i + 0.5) / n + (rng() - 0.5) * (0.8 / n); // position along the edge, 0..1
        let rootU, rootV, dir;
        if (edge === "bottom") { rootU = (along * 2 - 1) * ax; rootV = ay; dir = -Math.PI / 2; }
        else if (edge === "top") { rootU = (1 - along) * 2 * ax - ax; rootV = -ay; dir = Math.PI / 2; }
        else if (edge === "left") { rootU = -ax; rootV = (rng() * 1.6 - 0.8) * ay; dir = 0; }
        else { rootU = ax; rootV = (rng() * 1.6 - 0.8) * ay; dir = Math.PI; }
        // Lean each plant toward the middle of the frame a little.
        const toMid = Math.atan2(-rootV, -rootU);
        let lean = toMid - dir; lean = Math.atan2(Math.sin(lean), Math.cos(lean));
        dir += Math.max(-0.45, Math.min(0.45, lean * 0.5)) + (rng() - 0.5) * 0.2;
        const size = 0.62 + 0.38 * rng();                       // 1 = biggest, drawn in front
        const len = size * 2 * ay * 1.45;                       // plant length in frame units
        const k = len / Math.max(1, -top);                      // plant units → frame units
        const back = len * 0.42;                                // root this far outside the edge
        const ca = Math.cos(dir), sa = Math.sin(dir);
        const t = { plant, k, size, maxDepth, maxDist, gen, delay: rng() * 0.08, phase: rng() * TAU,
          // Plant space has the stem pointing up (−y); rotate it to point along `dir`.
          ox: rootU - ca * back, oy: rootV - sa * back, cr: Math.cos(dir + Math.PI / 2), sr: Math.sin(dir + Math.PI / 2) };
        // Growth begins at the first branch that reaches into the frame.
        let startDist = maxDist;
        for (let s2 = 0; s2 < segs.length; s2 += 6) {
          const X = t.ox + (segs[s2 + 2] * t.cr - segs[s2 + 3] * t.sr) * k, Y = t.oy + (segs[s2 + 2] * t.sr + segs[s2 + 3] * t.cr) * k;
          if (Math.abs(X) < ax && Math.abs(Y) < ay && segs[s2 + 5] < startDist) startDist = segs[s2 + 5];
        }
        t.startDist = Math.min(startDist, maxDist - 1);
        trees.push(t);
      }
    }
    trees.sort((a, b) => a.size - b.size); // back to front
    P.lsysPlant = { trees };
    P.lsysPlantKey = key;
    return P.lsysPlant;
  }

  function buildLSystem(T, cols, rows, u0, v0, du) {
    const key = `${T.toFixed(5)}:${cols}:${rows}:${u0.toFixed(4)}:${v0.toFixed(4)}`;
    if (P.lsysKey === key) return;
    const forest = plantForest();
    const zoom = P.f; // Scale zooms in around the frame's centre
    const hist = new Float32Array(cols * rows);
    const stamp = (cxv, cyv, r, w) => {
      const ix = Math.round(cxv), iy = Math.round(cyv);
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > r * r + 0.25) continue;
        const X = ix + dx, Y = iy + dy;
        if (X < 0 || Y < 0 || X >= cols || Y >= rows) continue;
        const c = Y * cols + X;
        if (w > hist[c]) hist[c] = w;
      }
    };
    const ease = (q) => q * q * (3 - 2 * q);
    for (const t of forest.trees) {
      // Forests start 1/N of the loop apart (G). Each one grows over 1.25 G (quick start, easing
      // out), holds to 1.4 G, then fades out by 1.95 G. So the next forest is already growing
      // while this one is still full, and is about halfway up as this one fades behind it.
      // T = 0 lands on the first forest mid-hold, fully grown.
      const G = 1 / LSYS_FORESTS, GROW = 1.25 * G, HOLD = 1.4 * G, GONE = 1.95 * G;
      const tau = (((T / TAU + 1.32 * G - t.gen * G - t.delay) % 1) + 1) % 1;
      if (tau >= GONE) continue;
      const grow = tau < GROW ? 1 - (1 - tau / GROW) ** 2 : 1;
      const fade = tau < HOLD ? 1 : 1 - ease((tau - HOLD) / (GONE - HOLD));
      const front = t.startDist + grow * (t.maxDist - t.startDist);
      // About 4–5° of lean at the tips, however long the plant: the bend is shared across its steps.
      const segs = walkPlant(t.plant, (0.08 * Math.sin(T + t.phase)) / t.maxDist);
      const layer = (0.6 + 0.4 * t.size) * fade; // back plants dimmer
      const thick = 1.7 * t.size * zoom;
      const toCol = (x, y) => ((t.ox + (x * t.cr - y * t.sr) * t.k) * zoom - u0) / du;
      const toRow = (x, y) => ((t.oy + (x * t.sr + y * t.cr) * t.k) * zoom - v0) / du;
      for (let k = 0; k < segs.length; k += 6) {
        const d0 = segs[k + 5];
        if (d0 >= front) continue;
        const part = Math.min(1, front - d0); // the segment at the growth front draws partway
        const depth = segs[k + 4] / Math.max(1, t.maxDepth);
        const r = Math.max(0, (1 - depth) ** 2 * thick);
        // Limbs brighter than twigs; the growing tip glows.
        const w = (front - d0 < 3 && grow < 1 ? 1 : 0.55 + 0.45 * (1 - depth)) * layer;
        const x1 = segs[k] + (segs[k + 2] - segs[k]) * part, y1 = segs[k + 1] + (segs[k + 3] - segs[k + 1]) * part;
        const ax = toCol(segs[k], segs[k + 1]), ay = toRow(segs[k], segs[k + 1]);
        const bx = toCol(x1, y1), by = toRow(x1, y1);
        if ((ax < -2 && bx < -2) || (ax > cols + 2 && bx > cols + 2) || (ay < -2 && by < -2) || (ay > rows + 2 && by > rows + 2)) continue;
        const nPts = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 1.5));
        for (let i = 0; i <= nPts; i++) stamp(ax + ((bx - ax) * i) / nPts, ay + ((by - ay) * i) / nPts, r, w);
      }
    }
    P.lsys = { val: hist, cols, rows, u0, v0, du };
    P.lsysKey = key;
  }

  // Rain: landing spots spread over the frame (best of 4 random tries each, so drops
  // don't clump), each drop with its own timing and 1-3 falls per loop.
  function placeDrops() {
    const key = `${P.ax.toFixed(3)}:${P.ay.toFixed(3)}`;
    if (P.dropKey === key) return;
    const rng = mulberry32(S.seed * 53 + 11);
    const n = Math.min(60, Math.round((4 + P.cx * 4) * Math.sqrt(P.ax * P.ay)));
    const mx = P.ax * 0.95, my = P.ay * 0.95;
    const spots = [];
    const pick = () => {
      let best = null, bestD = -1;
      for (let c = 0; c < 4; c++) {
        const x = (rng() * 2 - 1) * mx, y = (rng() * 2 - 1) * my;
        let d = Infinity;
        for (const q of spots) d = Math.min(d, Math.hypot(x - q[0], y - q[1]));
        if (d > bestD) { bestD = d; best = [x, y, 0.6 + 0.6 * rng()]; }
      }
      spots.push(best);
      return best;
    };
    P.drops = Array.from({ length: n }, () => {
      const k = 1 + Math.floor(rng() * 3);
      return { k, t0: rng(), spots: Array.from({ length: k }, pick) };
    });
    P.dropKey = key;
  }

  /* ---------- colour ---------- */
  const hexToRgb = (hex) => { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  let BG = "#0f0e11", INK = "#f4f2f7", RAMP = [];
  function buildColours() {
    const base = hexToRgb(S.color);
    const dark = S.tone === "dark";
    const bg = mix(dark ? [14, 13, 16] : [241, 240, 237], base, 0.04);
    BG = rgb(bg);
    INK = dark ? "#f4f2f7" : "#141217";
    const end = dark ? [255, 255, 255] : [18, 16, 22];
    RAMP = Array.from({ length: S.shades }, (_, i) => {
      if (S.mapping === "size") return rgb(base);
      const k = (i + 1) / S.shades;
      return rgb(k <= 0.7 ? mix(bg, base, 0.3 + (k / 0.7) * 0.7) : mix(base, end, ((k - 0.7) / 0.3) * (dark ? 0.55 : 0.3)));
    });
  }

  /* ---------- layout: which cells show, how big, which shade ---------- */
  function layout(W, H, s, time) {
    const cell = S.spacing * s;
    const cols = Math.max(1, Math.floor(W / cell)), rows = Math.max(1, Math.floor(H / cell));
    const ox = (W - cols * cell) / 2 + cell / 2, oy = (H - rows * cell) / 2 + cell / 2;
    const half = Math.min(W, H) / 2;
    P.ax = W / 2 / half; P.ay = H / 2 / half;
    if (S.generator === "squares") placeSquares();
    if (S.generator === "rain") placeDrops();
    const T = TAU * ((time / S.loop) % 1);
    if (S.generator === "attractor") buildAttractor(T, cols, rows, (ox - W / 2) / half, (oy - H / 2) / half, cell / half);
    if (S.generator === "clifford") buildClifford(T, cols, rows, (ox - W / 2) / half, (oy - H / 2) / half, cell / half);
    if (S.generator === "trees") buildLSystem(T, cols, rows, (ox - W / 2) / half, (oy - H / 2) / half, cell / half);
    const gen = GENS[S.generator].fn;
    const n = S.shades, th = S.threshold / 100, tex = S.texture / 100;
    const sized = S.mapping !== "colour" && S.shape !== "glyph";
    const buckets = Array.from({ length: n }, () => []);
    for (let j = 0; j < rows; j++) {
      const y = oy + j * cell, v = (y - H / 2) / half;
      for (let i = 0; i < cols; i++) {
        const x = ox + i * cell, u = (x - W / 2) / half;
        let val = gen(u, v, T, P);
        if (!(val > th)) continue;
        val = Math.min(1, (val - th) / (1 - th));
        const level = Math.min(n - 1, Math.floor(val * n));
        const k = (level + 1) / n;
        let size = sized ? (S.shape === "dot" ? Math.sqrt(k) : k) : 1;
        if (tex > 0) size *= 1 - tex * 0.7 * hash(i, j, S.seed);
        buckets[level].push(x, y, size);
      }
    }
    return { base: cell * S.dotSize / 100, buckets };
  }

  /* ---------- text block ---------- */
  const measure = document.createElement("canvas").getContext("2d");
  // Text fonts: the label, headline and subtitle all use the chosen face.
  const TEXT_FONTS = {
    sans: { family: "Geist", css: "Geist, ui-sans-serif, system-ui, sans-serif", head: 600, label: 500, track: -0.02 },
    mono: { family: "Geist Mono", css: '"Geist Mono", ui-monospace, monospace', head: 500, label: 500, track: -0.01 },
    pixel: { family: "Pixelify Sans", css: '"Pixelify Sans", "Geist Mono", ui-monospace, monospace', head: 600, label: 400, track: 0 },
  };
  function textItems(W, H, s) {
    if (!S.textOn) return [];
    const pad = Math.round(Math.min(W, H) * 0.07);
    const hs = S.textSize * s, cs = Math.max(9 * s, hs * 0.26), ss = Math.max(10 * s, hs * 0.36);
    const F = TEXT_FONTS[S.textFont] || TEXT_FONTS.sans;
    const headFont = `${F.head} ${hs}px ${F.css}`;
    const capFont = `${F.label} ${cs}px ${F.css}`;
    const subFont = `400 ${ss}px ${F.css}`;
    const maxW = W * (S.textPos === "center" ? 0.8 : 0.62);
    const wrap = (text, font) => {
      measure.font = font;
      const out = [];
      let line = "";
      for (const word of text.trim().split(/\s+/).filter(Boolean)) {
        const test = line ? line + " " + word : word;
        if (line && measure.measureText(test).width > maxW) { out.push(line); line = word; } else line = test;
      }
      if (line) out.push(line);
      return out;
    };
    const lines = S.showHeadline ? wrap(S.headline, headFont) : [];
    const subLines = S.showSubtitle ? wrap(S.subtitle || "", subFont) : [];
    const cap = S.showCaption ? S.caption.trim().toUpperCase() : "";
    const lh = hs * 1.06, gap = cap ? cs * 1.9 : 0;
    const slh = ss * 1.35, subGap = subLines.length ? hs * 0.42 : 0;
    const blockH = gap + lines.length * lh + subGap + subLines.length * slh;
    const top = S.textPos === "tl" ? pad : S.textPos === "center" ? (H - blockH) / 2 : H - pad - blockH;
    const align = S.textPos === "center" ? "center" : "left";
    const x = align === "center" ? W / 2 : pad;
    const items = [];
    if (cap) items.push({ text: cap, x, y: top + cs, font: capFont, family: F.family, size: cs, weight: F.label, spacing: cs * 0.14, align, alpha: 0.7 });
    lines.forEach((t, i) => items.push({ text: t, x, y: top + gap + lh * (i + 1) - hs * 0.2, font: headFont, family: F.family, size: hs, weight: F.head, spacing: hs * F.track, align, alpha: 1 }));
    const subTop = top + gap + lines.length * lh + subGap;
    subLines.forEach((t, i) => items.push({ text: t, x, y: subTop + slh * (i + 1) - ss * 0.3, font: subFont, family: F.family, size: ss, weight: 400, spacing: 0, align, alpha: 0.72 }));
    return items;
  }

  /* ---------- grain tile ---------- */
  const grainTile = document.createElement("canvas");
  grainTile.width = grainTile.height = 160;
  {
    const g = grainTile.getContext("2d");
    const img = g.createImageData(160, 160);
    const rand = mulberry32(99);
    for (let i = 0; i < img.data.length; i += 4) {
      const on = rand() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = on;
      img.data[i + 3] = Math.floor(rand() * rand() * 255);
    }
    g.putImageData(img, 0, 0);
  }

  /* ---------- paint one frame ---------- */
  function paint(ctx, W, H, s, time, staticGrain = false) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const { base, buckets } = layout(W, H, s, time);
    ctx.globalAlpha = S.opacity / 100;
    buckets.forEach((b, level) => {
      if (!b.length) return;
      ctx.fillStyle = RAMP[level];
      if (S.shape === "glyph") {
        const ch = GLYPHS[Math.round((level / Math.max(1, S.shades - 1)) * (GLYPHS.length - 1))];
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        let cur = -1;
        for (let n = 0; n < b.length; n += 3) {
          const fs = Math.round(base * 1.3 * b[n + 2] * 2) / 2;
          if (fs < 1) continue;
          if (fs !== cur) { ctx.font = `500 ${fs}px "Geist Mono", ui-monospace, monospace`; cur = fs; }
          ctx.fillText(ch, b[n], b[n + 1]);
        }
        return;
      }
      ctx.beginPath();
      for (let n = 0; n < b.length; n += 3) {
        const x = b[n], y = b[n + 1], d = base * b[n + 2];
        if (d <= 0.2) continue;
        if (S.shape === "dot") { ctx.moveTo(x + d / 2, y); ctx.arc(x, y, d / 2, 0, TAU); }
        else if (S.shape === "square") ctx.rect(x - d / 2, y - d / 2, d, d);
        else if (S.shape === "diamond") { ctx.moveTo(x, y - d / 2); ctx.lineTo(x + d / 2, y); ctx.lineTo(x, y + d / 2); ctx.lineTo(x - d / 2, y); ctx.closePath(); }
        else { const t = Math.max(1, d * 0.28); ctx.rect(x - d / 2, y - t / 2, d, t); ctx.rect(x - t / 2, y - d / 2, t, d); }
      }
      ctx.fill();
    });
    if (S.grain > 0) {
      const pat = ctx.createPattern(grainTile, "repeat");
      // GIF's 256-colour palette turns moving grain into background flicker, so GIFs hold it still.
      const k = staticGrain ? 0 : Math.floor(time * 12);
      pat.setTransform(new DOMMatrix().translateSelf(Math.floor(hash(k, 1, 3) * 160), Math.floor(hash(k, 2, 5) * 160)).scaleSelf(Math.max(1, s * 1.5)));
      ctx.globalAlpha = (S.grain / 100) * 0.35;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
    for (const t of textItems(W, H, s)) {
      ctx.font = t.font;
      ctx.textAlign = t.align;
      ctx.textBaseline = "alphabetic";
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${t.spacing}px`;
      ctx.globalAlpha = t.alpha;
      ctx.fillStyle = INK;
      ctx.fillText(t.text, t.x, t.y);
    }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.globalAlpha = 1;
  }

  return {
    GENS, GLYPHS, TEXT_FONTS, buildP, buildColours, layout, textItems, paint,
    // Rebuilt by buildColours(), so read them through getters.
    get BG() { return BG; },
    get INK() { return INK; },
  };
}
