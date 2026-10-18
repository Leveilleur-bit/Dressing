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
export async function removeBackground(blob, { max = 760, strength = 1 } = {}) {
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
