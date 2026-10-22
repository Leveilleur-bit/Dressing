// Couleur dominante et motif d'un vêtement, calculés sur le téléphone à partir de la photo.
import { COLORS } from "./catalog.js";

function toLab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PALETTE = Object.entries(COLORS).map(([id, v]) => ({ id, lab: toLab(...hexRgb(v[1])) }));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Teinte de la palette la plus proche, avec quelques règles pour les cas ambigus. */
function nearest(lab) {
  const [L, a, b] = lab, chroma = Math.hypot(a, b);
  // les neutres d'abord : peu saturés
  if (chroma < 9) { if (L > 88) return "blanc"; if (L > 78) return "ecru"; if (L < 22) return "noir"; return "gris"; }
  // la teinte compte plus que la clarté (un marron foncé reste marron, pas noir)
  let best = null, bd = Infinity;
  for (const p of PALETTE) {
    const d = Math.hypot((lab[0] - p.lab[0]) * 0.5, lab[1] - p.lab[1], lab[2] - p.lab[2]);
    if (d < bd) { bd = d; best = p.id; }
  }
  if (best === "noir" && chroma >= 9) best = a > 3 && b > 3 ? "marron" : b < -4 ? "marine" : best;
  return best;
}

function loadBitmap(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  return new Promise((res, rej) => { const u = URL.createObjectURL(blob); const i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = rej; i.src = u; });
}

/**
 * @param blob photo détourée (PNG transparent) de préférence, sinon photo entière (on lit alors le centre)
 * @returns {Promise<{color: string, pattern: "uni"|"motif", share: number}>}
 */
export async function detectColor(blob, { cut = true } = {}) {
  const bmp = await loadBitmap(blob);
  const S = 120, r = Math.min(1, S / Math.max(bmp.width, bmp.height));
  const W = Math.max(1, Math.round(bmp.width * r)), H = Math.max(1, Math.round(bmp.height * r));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const pts = [], pos = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (cut ? px[i + 3] < 200 : (x < W * 0.25 || x > W * 0.75 || y < H * 0.25 || y > H * 0.75)) continue;
    pts.push(toLab(px[i], px[i + 1], px[i + 2])); pos.push(y * W + x);
  }
  if (pts.length < 30) return null;
  // k-moyennes à 4 groupes
  const K = 4; let cents = [];
  for (let k = 0; k < K; k++) cents.push(pts[Math.floor((k + 0.5) * pts.length / K)].slice());
  const lab = new Uint8Array(pts.length);
  for (let it = 0; it < 10; it++) {
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let bk = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const d = dist(pts[i], cents[k]); if (d < bd) { bd = d; bk = k; } }
      lab[i] = bk; const s = sum[bk]; s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++;
    }
    cents = sum.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cents[k]));
  }
  const counts = cents.map((_, k) => lab.filter((x) => x === k).length);
  // on regroupe les groupes de même couleur de palette (ombres et reflets d'une même teinte)
  const byColor = {};
  cents.forEach((c, k) => { const id = nearest(c); byColor[id] = (byColor[id] || 0) + counts[k]; });
  const ranked = Object.entries(byColor).sort((a, b) => b[1] - a[1]);
  const total = pts.length;
  const [main, mainN] = ranked[0];
  // motif : deux teintes bien différentes, chacune bien présente, qui alternent souvent
  let pattern = "uni";
  if (ranked[1] && ranked[1][1] / total > 0.2) {
    const idOf = new Map(); cents.forEach((c, k) => idOf.set(k, nearest(c)));
    const grid = new Map(); pos.forEach((p, i) => grid.set(p, idOf.get(lab[i])));
    let changes = 0, steps = 0;
    for (const [p, id] of grid) {
      const right = grid.get(p + 1), down = grid.get(p + W);
      if (right !== undefined) { steps++; if (right !== id) changes++; }
      if (down !== undefined) { steps++; if (down !== id) changes++; }
    }
    const la = PALETTE.find((x) => x.id === ranked[0][0]).lab, lb = PALETTE.find((x) => x.id === ranked[1][0]).lab;
    if (steps && changes / steps > 0.07 && dist(la, lb) > 25) pattern = "motif";
  }
  return { color: main, pattern, share: mainN / total };
}
