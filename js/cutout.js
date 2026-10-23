// Détourage : enlève un fond à peu près uni (drap, sol, mur) autour d'un vêtement posé à plat.
// Principe : on part des bords de la photo et on « grignote » tout ce qui ressemble au fond,
// puis on lisse le contour et on recadre au plus près du vêtement. Tout se passe sur le téléphone.

function loadBitmap(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load")); };
    img.src = url;
  });
}

/**
 * @returns {Promise<{blob: Blob|null, ok: boolean, coverage: number}>}
 *  ok = false quand le résultat n'est pas crédible (fond trop chargé, vêtement coupé…)
 */
export async function removeBackgroundBasic(blob, { max = 760, strength = 1, maskOnly = false } = {}) {
  const bmp = await loadBitmap(blob);
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * r), H = Math.round(bmp.height * r);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const px = img.data;
  const N = W * H;

  // couleur du fond = médiane des bords
  const border = [];
  const pushPx = (x, y) => { const i = (y * W + x) * 4; border.push([px[i], px[i + 1], px[i + 2]]); };
  for (let x = 0; x < W; x += 2) for (let k = 0; k < 4; k++) { pushPx(x, k); pushPx(x, H - 1 - k); }
  for (let y = 0; y < H; y += 2) for (let k = 0; k < 4; k++) { pushPx(k, y); pushPx(W - 1 - k, y); }
  const med = (c) => { const a = border.map((p) => p[c]).sort((x, y) => x - y); return a[a.length >> 1]; };
  const bg = [med(0), med(1), med(2)];

  // écart de couleur : la teinte compte plus que la luminosité, et une ombre (plus sombre) compte peu
  const diff = (r1, g1, b1, r2, g2, b2) => {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    const dl = 0.3 * dr + 0.59 * dg + 0.11 * db;
    const ch = Math.sqrt((dr - dl) ** 2 + (dg - dl) ** 2 + (db - dl) ** 2);
    return ch * 1.7 + Math.abs(dl) * (dl < 0 ? 0.45 : 0.9);
  };
  const G = 62 * strength, L = 16 * strength;
  const dGlobal = new Float32Array(N);
  for (let i = 0; i < N; i++) { const j = i * 4; dGlobal[i] = diff(px[j], px[j + 1], px[j + 2], bg[0], bg[1], bg[2]); }

  // 1. remplissage depuis les bords
  const isBg = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const seed = (i) => { if (!isBg[i] && dGlobal[i] <= G) { isBg[i] = 1; queue[qt++] = i; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % W, y = (i / W) | 0, j = i * 4;
    const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const n of nb) {
      if (n < 0 || isBg[n] || dGlobal[n] > G) continue;
      const k = n * 4;
      if (diff(px[k], px[k + 1], px[k + 2], px[j], px[j + 1], px[j + 2]) > L) continue;
      isBg[n] = 1; queue[qt++] = n;
    }
  }

  // 2. trous fermés couleur du fond (entre un bras et le corps, anse de sac…)
  const seen = new Uint8Array(N);
  const minHole = N * 0.002;
  for (let s = 0; s < N; s++) {
    if (isBg[s] || seen[s] || dGlobal[s] > G * 0.55) continue;
    qh = 0; qt = 0; queue[qt++] = s; seen[s] = 1;
    while (qh < qt) {
      const i = queue[qh++]; const x = i % W, y = (i / W) | 0;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (n < 0 || seen[n] || isBg[n] || dGlobal[n] > G * 0.55) continue;
        seen[n] = 1; queue[qt++] = n;
      }
    }
    if (qt >= minHole) for (let k = 0; k < qt; k++) isBg[queue[k]] = 1;
  }

  // 3. on garde les grands morceaux, on jette les poussières
  const label = new Int32Array(N);
  const sizes = [0];
  for (let s = 0; s < N; s++) {
    if (isBg[s] || label[s]) continue;
    const id = sizes.length; qh = 0; qt = 0; queue[qt++] = s; label[s] = id;
    while (qh < qt) {
      const i = queue[qh++]; const x = i % W, y = (i / W) | 0;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (n < 0 || isBg[n] || label[n]) continue;
        label[n] = id; queue[qt++] = n;
      }
    }
    sizes.push(qt);
  }
  const biggest = Math.max(0, ...sizes);
  const keep = sizes.map((sz) => sz >= biggest * 0.05 && sz > N * 0.002);
  let fg = 0, minX = W, minY = H, maxX = -1, maxY = -1;
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!isBg[i] && keep[label[i]]) {
      alpha[i] = 255; fg++;
      const x = i % W, y = (i / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const coverage = fg / N;
  // vêtement collé à 3 bords ou plus : la photo est trop serrée, on ne peut pas détourer proprement
  const touches = (minX <= 1) + (minY <= 1) + (maxX >= W - 2) + (maxY >= H - 2);
  const ok = coverage > 0.04 && coverage < 0.9 && touches < 3;
  if (!ok) return { blob: null, ok: false, coverage };
  if (maskOnly) return { ok: true, mask: alpha, W, H, coverage };

  // 4. contour adouci (flou 3×3 du masque)
  const soft = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      s += alpha[yy * W + xx]; c++;
    }
    soft[y * W + x] = s / c;
  }
  for (let i = 0; i < N; i++) px[i * 4 + 3] = soft[i];
  ctx.putImageData(img, 0, 0);

  // 5. recadrage serré avec une petite marge
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
  const cx = Math.max(0, minX - pad), cy = Math.max(0, minY - pad);
  const cw = Math.min(W, maxX + pad + 1) - cx, chh = Math.min(H, maxY + pad + 1) - cy;
  const out = document.createElement("canvas");
  out.width = cw; out.height = chh;
  out.getContext("2d").drawImage(cv, cx, cy, cw, chh, 0, 0, cw, chh);
  const png = await new Promise((res) => out.toBlob(res, "image/png"));
  return { blob: png, ok: !!png, coverage };
}

// ---------------- détourage précis : petit modèle d'IA qui tourne sur le téléphone ----------------
// Bibliothèque @imgly/background-removal 1.4.5 (licence AGPL, code source public) et modèle ISNet
// quantifié, hébergés avec l'appli (dossier bg/). ~55 Mo téléchargés une seule fois, puis gardés en cache.
let aiLib = null, aiBroken = false, progressFn = null, aiReady = false;
export function onCutProgress(fn) { progressFn = fn; }
export const cutModelReady = () => aiReady;

async function removeBackgroundAI(blob, { max = 760 } = {}) {
  if (!aiLib) aiLib = import("./vendor/bgremoval.js");
  const lib = await aiLib;
  const publicPath = new URL("../bg/", import.meta.url).href;
  // on réduit d'abord la photo : plus rapide, et largement assez pour le modèle (1024 px)
  const small = await shrink(blob, 1280);
  const out = await lib.removeBackground(small, {
    publicPath, model: "small", output: { format: "image/png" },
    progress: (key, cur, total) => { if (progressFn && /model|wasm/.test(key) && total) progressFn(Math.round((cur / total) * 100)); }
  });
  aiReady = true;
  // recadrage au plus près du vêtement + taille finale
  const bmp = await loadBitmap(out);
  const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
  const imgData = ctx.getImageData(0, 0, cv.width, cv.height);
  const { data } = imgData;
  // couleurs reprises de la photo d'origine : le modèle ne sert qu'à fournir le masque
  {
    const ob = await loadBitmap(small);
    if (ob.width === cv.width && ob.height === cv.height) {
      const oc = document.createElement("canvas"); oc.width = cv.width; oc.height = cv.height;
      const ox = oc.getContext("2d", { willReadFrequently: true }); ox.drawImage(ob, 0, 0);
      const od = ox.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < data.length; i += 4) { data[i] = od[i]; data[i + 1] = od[i + 1]; data[i + 2] = od[i + 2]; }
    }
  }
  const Wd = cv.width, Hd = cv.height, N = Wd * Hd;
  // 1. poussières : on ne garde que les grands morceaux opaques (et leur contour adouci)
  {
    const lab = new Int32Array(N), q = new Int32Array(N), sizes = [0];
    for (let s0 = 0; s0 < N; s0++) {
      if (lab[s0] || data[s0 * 4 + 3] < 128) continue;
      const id = sizes.length; let h = 0, t = 0; q[t++] = s0; lab[s0] = id;
      while (h < t) { const i = q[h++], x = i % Wd;
        for (const n of [x > 0 ? i - 1 : -1, x < Wd - 1 ? i + 1 : -1, i >= Wd ? i - Wd : -1, i < N - Wd ? i + Wd : -1])
          if (n >= 0 && !lab[n] && data[n * 4 + 3] >= 128) { lab[n] = id; q[t++] = n; } }
      sizes.push(t);
    }
    const big = Math.max(0, ...sizes);
    const keep = sizes.map((z) => z >= big * 0.04);
    // un pixel semi-transparent est gardé s'il touche un morceau gardé (rayon 2)
    for (let i = 0; i < N; i++) {
      const a = data[i * 4 + 3]; if (!a) continue;
      if (lab[i]) { if (!keep[lab[i]]) data[i * 4 + 3] = 0; continue; }
      const x = i % Wd, y = (i / Wd) | 0; let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= Wd || yy >= Hd) continue;
        const l = lab[yy * Wd + xx]; if (l && keep[l]) near = true;
      }
      if (!near) data[i * 4 + 3] = 0;
    }
  }
  // 2. sur un fond uni, la méthode simple voit bien les zones claires (rayures blanches) que le modèle rate :
  //    si les deux sont d'accord sur la silhouette, on les additionne
  try {
    const b = await removeBackgroundBasic(small, { max: Math.max(Wd, Hd), maskOnly: true });
    if (b.ok && b.W === Wd && b.H === Hd) {
      // accord = presque tout le vêtement vu par le modèle est aussi vu par la méthode simple,
      // et la méthode simple ne déborde pas du cadre du vêtement vu par le modèle
      let inter = 0, ai = 0, mk = 0, out = 0, bx0 = Wd, by0 = Hd, bx1 = -1, by1 = -1;
      for (let i = 0; i < N; i++) if (data[i * 4 + 3] >= 128) { ai++; const x = i % Wd, y = (i / Wd) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      const m = Math.round(Math.max(bx1 - bx0, by1 - by0) * 0.03);
      for (let i = 0; i < N; i++) {
        if (!b.mask[i]) continue; mk++;
        if (data[i * 4 + 3] >= 128) inter++;
        const x = i % Wd, y = (i / Wd) | 0;
        if (x < bx0 - m || x > bx1 + m || y < by0 - m || y > by1 + m) out++;
      }
      if (ai && inter / ai > 0.9 && out < mk * 0.03) for (let i = 0; i < N; i++) if (b.mask[i]) data[i * 4 + 3] = Math.max(data[i * 4 + 3], b.mask[i]);
    }
  } catch (e) {}
  ctx.putImageData(imgData, 0, 0);
  let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1, fg = 0;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    if (data[(y * cv.width + x) * 4 + 3] > 128) { fg++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const coverage = fg / (cv.width * cv.height);
  if (x1 < 0 || coverage < 0.02 || coverage > 0.97) return { blob: null, ok: false, coverage };
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(cv.width - 1, x1 + pad); y1 = Math.min(cv.height - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, r = Math.min(1, max / Math.max(w, h));
  const o = document.createElement("canvas"); o.width = Math.round(w * r); o.height = Math.round(h * r);
  o.getContext("2d").drawImage(cv, x0, y0, w, h, 0, 0, o.width, o.height);
  const png = await new Promise((res) => o.toBlob(res, "image/png"));
  return { blob: png, ok: !!png, coverage, precise: true };
}
async function shrink(blob, max) {
  const bmp = await loadBitmap(blob);
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (r === 1 && blob.type === "image/jpeg") return blob;
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
}

/** Détourage : le modèle précis si possible, sinon la méthode simple (fond uni). */
export async function removeBackground(blob, opts = {}) {
  const precise = opts.precise ?? (localStorage.getItem("dressing:cut") !== "simple");
  if (precise && !aiBroken) {
    try { return await removeBackgroundAI(blob, opts); }
    catch (e) { console.warn("détourage précis indisponible", e); aiBroken = true; }
  }
  return removeBackgroundBasic(blob, opts);
}
