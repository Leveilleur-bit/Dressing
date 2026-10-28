import { CATS, COLORS, WARM, PATTERNS, RAIN, SEASONS, OCCS, MOODS, MANUAL_TEMPS, GLYPH, ACC_TYPES, demoItems } from "./js/catalog.js";
import { guess, seasonsFor } from "./js/guess.js";
import { suggest, suggestMany, seasonOf, missingNote, comboKey, daysBetween, planTrip } from "./js/engine.js";
import { suggestGaps, MILESTONES, countOutfits } from "./js/gaps.js";
import { Sync, LS, uid, getProfiles, saveProfiles, getActiveId, setActiveId } from "./js/store.js";
import { Repo, parseRepo } from "./js/github.js";
import { fetchTwoDays, fetchRange, searchCity, locate } from "./js/weather.js";
import { initCamera, takePhoto, takePhotos, cameraSupported, resizeFile } from "./js/camera.js";
import { STYLES, STYLE_TAGS, MATERIALS } from "./js/styles.js";
import { askStylist, testKey, AiError, recognizeItem, readLabel, materialFromComposition, detectMany, describeLook, auditWardrobe, readShopScreenshot } from "./js/ai.js";
import { detectColor } from "./js/colorid.js";
import { removeBackground, onCutProgress } from "./js/cutout.js";

const VERSION = "1.14.0";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------- état ----------------
let sync = null;               // synchronisation du profil actif (null = exemple)
let doc = null;                // données du dressing affiché
let demoDoc = { items: demoItems(), history: [], feedback: {}, agenda: {}, prefs: { styles: [], note: "", t: 0 }, trips: {}, week: null, outfits: {}, looks: {} };
let tripDraft = null, openTripId = null;
let aiBusy = false;
let dayOffset = new Date().getHours() >= 19 ? 1 : 0;
let weather = { 0: null, 1: null };
let weatherError = null;
let settings = LS.get("dressing:settings", { loc: null, restDays: 3, manual: { temp: null, rain: false } });
let mood = "";
let occOverride = {};          // occasion choisie à la main pour un jour donné
let current = null, seen = [], lastCtxKey = "", wornKey = null;
let catFilter = "tous";
let editing = null, draft = null;
let editingProfile = null;
let editingDay = null, dayDraft = null;

const saveSettings = () => LS.set("dressing:settings", settings);
const isDemo = () => !sync;
const data = () => (sync ? doc : demoDoc);
const prefs = () => data().prefs || { styles: [], note: "", t: 0 };
const aiKey = () => LS.get("dressing:aikey", "");
const weekdayOcc = () => prefs().weekdayOcc || "travail";
const weekendOcc = () => prefs().weekendOcc || "quotidien";
let search = "";
const normTxt = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const SORT_DAYS = 180;
const DIRTY_DAYS = 7;
function toSort(i) {
  const ref = i.lastWorn ? i.lastWorn : i.createdAt ? new Date(i.createdAt).toISOString() : null;
  if (!ref) return false;
  return daysBetween(ref, dayStr(0)) >= SORT_DAYS;
}

function dayStr(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const fmtDay = (day, opts = { weekday: "long", day: "numeric", month: "long" }) => new Date(day + "T12:00:00").toLocaleDateString("fr-FR", opts);

/** Objets enrichis : dernière fois porté et nombre de fois, d'après l'historique */
/** « 49,90 € » → 49.9 */
function parsePrice(v) { const m = String(v || "").replace(/\s/g, "").replace(",", ".").match(/\d+(\.\d+)?/); return m ? Math.round(parseFloat(m[0]) * 100) / 100 : null; }
const fmtPrice = (n) => n == null ? "" : (Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
const wishItems = () => (data().items || []).filter((i) => !i.deleted && i.wish).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
function liveItems() {
  const d = data();
  const hist = (d.history || []).filter((h) => !h.deleted);
  const last = new Map(), count = new Map();
  for (const h of hist) for (const id of h.items) {
    count.set(id, (count.get(id) || 0) + 1);
    if (!last.has(id) || last.get(id) < h.day) last.set(id, h.day);
  }
  return (d.items || []).filter((i) => !i.deleted && !i.wish).map((i) => ({
    ...i,
    lastWorn: last.has(i.id) ? last.get(i.id) + "T12:00:00" : i.lastWorn || null,
    wornCount: (count.get(i.id) || 0) + (i.demo && i.lastWorn ? 3 : 0),
    // le linge sale redevient propre tout seul au bout d'une semaine
    dirty: !!i.dirty && Date.now() - (i.dirtyAt || i.updatedAt || 0) < DIRTY_DAYS * 864e5,
    cleanIn: i.dirty ? Math.max(1, Math.ceil((DIRTY_DAYS * 864e5 - (Date.now() - (i.dirtyAt || i.updatedAt || 0))) / 864e5)) : null
  }));
}

function wornText(it, ref) {
  const d = daysBetween(it.lastWorn, ref || dayStr(0));
  if (d === null) return "Jamais porté";
  if (d === -1) return "Prévu demain";
  if (d < -1) return "Prévu";
  if (d <= 0) return "Porté aujourd'hui";
  if (d === 1) return "Porté hier";
  return "Porté il y a " + d + " j";
}

// ---------------- vignettes ----------------
function catLabel(p) {
  if (p.cat === "accessoire") return ((ACC_TYPES.find((a) => a.id === p.acc) || {}).label || "Accessoire").split(" /")[0];
  return (CATS.find((x) => x.id === p.cat) || {}).label || "";
}
function glyph(cat, color, acc, name) {
  const hex = (COLORS[color] || COLORS.gris)[1];
  const n = String(name || "").toLowerCase();
  const variant = cat === "bas" && /jupe/.test(n) ? GLYPH.bas_jupe : cat === "bas" && /short|bermuda/.test(n) ? GLYPH.bas_short : null;
  const path = (cat === "accessoire" && GLYPH["acc_" + acc]) || variant || GLYPH[cat] || GLYPH.haut;
  return '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill-rule="evenodd" d="' + path + '" fill="' + hex + '" stroke="currentColor" stroke-opacity=".55" stroke-width="1.5" stroke-linejoin="round"/></svg>';
}
function thumb(it, tag, tagRight, extraAttr = "") {
  const path = it.cut || it.photo;
  const isCut = !!(it.previewUrl ? it.previewIsCut : it.cut);
  const photoAttr = path && sync && !it.previewUrl ? ' data-photo="' + esc(path) + '" data-alt="' + esc(it.name) + '"' : "";
  const preview = it.previewUrl ? '<img src="' + esc(it.previewUrl) + '" alt="">' : glyph(it.cat, it.color, it.acc, it.name);
  return '<div class="thumb' + (isCut ? " is-cut" : "") + '"' + photoAttr + extraAttr + ">" + preview +
    (tag ? '<span class="tag">' + esc(tag) + "</span>" : "") +
    (tagRight ? '<span class="tag right plain">' + esc(tagRight) + "</span>" : "") + "</div>";
}
function hydratePhotos(root) {
  if (!sync) return;
  const s = sync;
  root.querySelectorAll("[data-photo]").forEach((el) => {
    const path = el.dataset.photo;
    delete el.dataset.photo;
    s.photoUrl(path).then((url) => {
      if (s !== sync || !el.isConnected) return;
      const svg = el.querySelector("svg"); if (svg) svg.remove();
      const img = document.createElement("img"); img.src = url; img.alt = el.dataset.alt || "";
      el.prepend(img);
    }).catch(() => {});
  });
}

// ---------------- flat lay ----------------
// Composition façon « flat lay » : le haut, la veste qui le chevauche, le bas dessous,
// les chaussures en bas, le sac sur le côté, les accessoires autour. Positions en % du cadre.
/**
 * Flat lay sans chevauchement : colonne de gauche (haut puis bas, ou la robe), colonne de droite
 * (veste, deuxième haut, chaussures), puis les accessoires dans les espaces libres ; s'il n'y en a pas,
 * une rangée est ajoutée en bas. Unités : largeur 100, hauteur H (110 de base).
 */
function layoutFlat(pieces) {
  const W = 100; let H = 110;
  const by = (c) => pieces.filter((p) => p.cat === c);
  const tops = by("haut"), dress = by("robe")[0], bottom = by("bas")[0], jackets = pieces.filter((p) => p.cat === "manteau").concat(by("veste")), shoes = by("chaussures").slice(0, 2);
  const accs = pieces.filter((p) => p.cat === "accessoire");
  const placed = new Map(); // id -> rect {x, y, w, h}
  const L = { x: 3, w: 46 }, R = { x: 51, w: 46 };
  // gauche
  const left = [];
  if (dress) left.push([dress, 72]);
  else {
    if (tops[0]) left.push([tops[0], bottom ? 44 : 60]);
    if (bottom) left.push([bottom, tops[0] ? 58 : 62]);
  }
  let y = 3;
  for (const [p, h] of left) { placed.set(p.id, { x: L.x, y, w: L.w, h }); y += h + 3; }
  const leftBottom = y;
  // chaussures : sous la robe s'il reste de la place à gauche, sinon en bas à droite
  let rightLimit = H - 3;
  if (shoes.length) {
    const roomLeft = H - 3 - leftBottom;
    if (roomLeft >= 22) {
      const h = Math.min(26, roomLeft);
      shoes.forEach((p, i) => placed.set(p.id, shoes.length === 1 ? { x: L.x + 4, y: leftBottom, w: L.w - 8, h } : { x: L.x + i * (L.w / 2), y: leftBottom, w: L.w / 2 - 1, h }));
    } else {
      const h = 20; rightLimit = H - 3 - h - 2;
      shoes.forEach((p, i) => placed.set(p.id, shoes.length === 1 ? { x: R.x + 4, y: H - 3 - h, w: R.w - 8, h } : { x: R.x + i * (R.w / 2), y: H - 3 - h, w: R.w / 2 - 1, h }));
    }
  }
  // droite : vestes puis hauts en plus (superposés)
  const right = [...jackets, ...(dress ? tops : tops.slice(1))];
  if (right.length) {
    const avail = rightLimit - 3;
    const h = Math.min(48, (avail - 3 * (right.length - 1)) / right.length);
    right.forEach((p, i) => placed.set(p.id, { x: R.x, y: 3 + i * (h + 3), w: R.w, h }));
  }
  // le reste (pièces sans place prévue) et les accessoires : premier espace libre
  const rest = pieces.filter((p) => !placed.has(p.id));
  const free = (r) => r.x >= 1 && r.y >= 1 && r.x + r.w <= W - 1 && r.y + r.h <= H - 1 &&
    [...placed.values()].every((q) => r.x + r.w <= q.x - 1 || q.x + q.w <= r.x - 1 || r.y + r.h <= q.y - 1 || q.y + q.h <= r.y - 1);
  const findSpot = (sizes) => {
    for (const [w, h] of sizes) for (let yy = 2; yy + h <= H - 1; yy += 2) for (let xx = 2; xx + w <= W - 1; xx += 2) { const r = { x: xx, y: yy, w, h }; if (free(r)) return r; }
    return null;
  };
  const overflow = [];
  for (const p of rest) {
    const big = p.cat !== "accessoire";
    const r = findSpot(big ? [[40, 36], [30, 28], [24, 22]] : [[22, 20], [18, 16], [14, 13]]);
    if (r) placed.set(p.id, r); else overflow.push(p);
  }
  if (overflow.length) {
    const perRow = 4, cw = (W - 4) / perRow, rows = Math.ceil(overflow.length / perRow);
    const y0 = H; H += rows * 22 + 2;
    overflow.forEach((p, i) => placed.set(p.id, { x: 2 + (i % perRow) * cw + 1, y: y0 + Math.floor(i / perRow) * 22, w: cw - 2, h: 20 }));
  }
  return { H, placed };
}
function flatlay(pieces, small = false, interactive = false) {
  const { H, placed } = layoutFlat(pieces);
  const z = { bas: 1, robe: 1, haut: 2, veste: 3, manteau: 3, chaussures: 4, accessoire: 5 };
  const html = pieces.map((p, i) => {
    const r = placed.get(p.id); if (!r) return "";
    const path = p.cut || p.photo;
    const kind = p.cut ? "fl-cut" : p.photo ? "fl-photo" : "fl-glyph";
    const data = path && sync ? ' data-photo="' + esc(path) + '" data-alt="' + esc(p.name) + '"' : "";
    const tag = interactive ? "button" : "div";
    return "<" + tag + (interactive ? ' type="button" data-pid="' + esc(p.id) + '" aria-label="' + esc(p.name) + '"' : "") + ' class="fl-item ' + kind + '" style="left:' + r.x + "%;top:" + (r.y / H * 100).toFixed(2) + "%;width:" + r.w + "%;height:" + (r.h / H * 100).toFixed(2) + "%;z-index:" + (z[p.cat] || 2) + ";animation-delay:" + i * 0.05 + 's"' + data + ' title="' + esc(p.name) + '">' + glyph(p.cat, p.color, p.acc, p.name) + "</" + tag + ">";
  }).join("");
  return '<div class="flatlay' + (small ? " small" : "") + '" style="aspect-ratio:100 / ' + Math.round(H) + '">' + html + "</div>";
}

// ---------------- STATISTIQUES ----------------
let statsPeriod = 90;
const PERIODS = [[30, "1 mois"], [90, "3 mois"], [183, "6 mois"], [365, "1 an"], [0, "Tout"]];
function openStats() { renderStats(); $("stats-overlay").hidden = false; $("stats-sheet").scrollTop = 0; }
function renderStats() {
  const items = liveItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const since = statsPeriod ? addDays(dayStr(0), -statsPeriod) : "0000";
  const hist = (data().history || []).filter((h) => !h.deleted && h.day >= since && h.day <= dayStr(0));
  const wears = new Map();
  for (const h of hist) for (const id of h.items) wears.set(id, (wears.get(id) || 0) + 1);
  const main = items.filter((i) => i.cat !== "accessoire");
  const worn = items.filter((i) => wears.has(i.id));
  const pct = items.length ? Math.round((worn.length / items.length) * 100) : 0;
  const bar = (label, n, max, extra = "", swatch = "") => '<div class="st-row">' + (swatch ? '<span class="st-swatch" style="background:' + swatch + '"></span>' : "") + '<span class="st-label">' + label + "</span>" + extra +
    '<span class="st-bar"><span style="width:' + Math.max(4, Math.round((n / (max || 1)) * 100)) + '%"></span></span><span class="st-val">' + n + "</span></div>";
  const sum = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  // couleurs et marques, pondérées par les ports (vêtements seulement)
  const colors = new Map(), brands = new Map(), cats = new Map();
  for (const [id, n] of wears) {
    const it = byId.get(id); if (!it) continue;
    if (it.cat !== "accessoire") colors.set(it.color, (colors.get(it.color) || 0) + n);
    if (it.brand) brands.set(it.brand, (brands.get(it.brand) || 0) + n);
  }
  for (const c of CATS) { const all = items.filter((i) => i.cat === c.id); if (all.length) cats.set(c.id, { all: all.length, worn: all.filter((i) => wears.has(i.id)).length, label: c.label }); }
  const top = sum(wears).filter(([id]) => byId.has(id)).slice(0, 8);
  const never = items.filter((i) => !wears.has(i.id) && !i.stored && (!statsPeriod || (i.createdAt || 0) < Date.now() - statsPeriod * 864e5));
  const periodTxt = statsPeriod ? "sur " + PERIODS.find((p) => p[0] === statsPeriod)[1] : "depuis le début";
  let html = '<div class="sheet-head"><div><span class="label">Ton dressing</span><h2>Statistiques</h2></div><button class="x" type="button" data-stx="close" aria-label="Fermer">✕</button></div>' +
    '<div class="chips">' + PERIODS.map(([d, l]) => '<button type="button" class="chip" data-stp="' + d + '" aria-pressed="' + (statsPeriod === d) + '">' + l + "</button>").join("") + "</div>";
  if (!hist.length) {
    html += '<p class="empty">Aucune tenue notée ' + esc(periodTxt) + '. Touche « Je la porte » chaque matin : les statistiques se remplissent toutes seules.</p>';
  } else {
    html += '<div class="st-tiles"><div class="st-tile"><strong>' + hist.length + '</strong><span>tenue' + (hist.length > 1 ? "s" : "") + " portée" + (hist.length > 1 ? "s" : "") + "</span></div>" +
      '<div class="st-tile"><strong>' + pct + ' %</strong><span>du dressing porté (' + worn.length + " sur " + items.length + ")</span></div>" +
      '<div class="st-tile"><strong>' + never.length + '</strong><span>pièce' + (never.length > 1 ? "s" : "") + " jamais portée" + (never.length > 1 ? "s" : "") + "</span></div></div>" +
      '<p class="hint">' + esc(periodTxt[0].toUpperCase() + periodTxt.slice(1)) + ".</p>";
    html += '<section class="st-sec"><h3>Les plus portées</h3>' + top.map(([id, n]) => { const it = byId.get(id); return '<button type="button" class="st-piece" data-sid="' + esc(id) + '">' + thumb(it) + bar(esc(it.name), n, top[0][1]) + "</button>"; }).join("") + "</section>";
    const cs = sum(colors);
    if (cs.length) html += '<section class="st-sec"><h3>Couleurs portées</h3><p class="hint">Nombre de fois où chaque couleur était dans ta tenue.</p>' + cs.slice(0, 8).map(([c, n]) => bar(esc((COLORS[c] || [c])[0]), n, cs[0][1], "", (COLORS[c] || [])[1] || "#999")).join("") + "</section>";
    const bs = sum(brands);
    if (bs.length) html += '<section class="st-sec"><h3>Marques portées</h3>' + bs.slice(0, 6).map(([b, n]) => bar(esc(b), n, bs[0][1])).join("") + "</section>";
    html += '<section class="st-sec"><h3>Pièces portées par catégorie</h3><p class="hint">Combien de pièces de chaque catégorie ont servi au moins une fois.</p>' +
      [...cats.values()].map((c) => bar(esc(c.label), c.worn, c.all, '<span class="st-of">sur ' + c.all + "</span>")).join("") + "</section>";
    if (never.length) html += '<section class="st-sec"><h3>Jamais portées ' + esc(periodTxt) + '</h3><p class="hint">Pièces rangées et ajoutées récemment mises à part. Touche une pièce pour l\'ouvrir.</p><div class="season-grid">' +
      never.slice(0, 16).map((it) => '<button type="button" class="season-item" data-sid="' + esc(it.id) + '">' + thumb(it) + '<span class="alt-name">' + esc(it.name) + "</span></button>").join("") + "</div>" +
      (never.length > 16 ? '<p class="hint">Et ' + (never.length - 16) + " autres.</p>" : "") + "</section>";
  }
  $("stats-sheet").innerHTML = html;
  hydratePhotos($("stats-sheet"));
}

// ---------------- RANGEMENT DE SAISON ----------------
// une pièce « hors saison » ne porte aucune des saisons en cours ni de celle du mois prochain
function seasonPlan(all) {
  const today = dayStr(0);
  // ranger : rien d'utile d'ici 2 mois ; ressortir : utile maintenant ou d'ici un mois
  const cur = seasonOf(today), next = seasonOf(addDays(today, 30)), later = seasonOf(addDays(today, 60));
  const any = (i, list) => !(i.seasons || []).length || list.some((x) => i.seasons.includes(x));
  return {
    cur, next,
    toStore: all.filter((i) => !i.stored && !i.demo && !any(i, [cur, next, later])),
    toTakeOut: all.filter((i) => i.stored && any(i, [cur, next]))
  };
}
const SEASON_NAME = { printemps: "le printemps", ete: "l'été", automne: "l'automne", hiver: "l'hiver" };
function renderSeasonCard(all) {
  const box = $("season-card");
  if (isDemo()) { box.hidden = true; return; }
  const plan = seasonPlan(all);
  const key = "dressing:season-later:" + plan.cur + "-" + plan.next + ":" + plan.toStore.length + "-" + plan.toTakeOut.length;
  if ((plan.toStore.length < 3 && !plan.toTakeOut.length) || LS.get(key, false)) { box.hidden = true; return; }
  const parts = [];
  if (plan.toStore.length) parts.push(plan.toStore.length + " pièce" + (plan.toStore.length > 1 ? "s" : "") + " hors saison à ranger");
  if (plan.toTakeOut.length) parts.push(plan.toTakeOut.length + " pièce" + (plan.toTakeOut.length > 1 ? "s" : "") + " rangée" + (plan.toTakeOut.length > 1 ? "s" : "") + " à ressortir");
  const label = plan.cur === plan.next ? SEASON_NAME[plan.cur] : SEASON_NAME[plan.next];
  box.innerHTML = '<div class="season-text"><strong>Changement de saison</strong><span>' + (plan.cur === plan.next ? "C'est " : "Bientôt ") + esc(label) + " : " + esc(parts.join(" et ")) + '.</span></div>' +
    '<div class="actions"><button type="button" class="btn" data-season="later">Plus tard</button><button type="button" class="btn primary" data-season="open">Voir</button></div>';
  box.dataset.key = key;
  box.hidden = false;
}
let seasonSel = null;
function openSeason() {
  const plan = seasonPlan(liveItems());
  seasonSel = { store: new Set(plan.toStore.map((i) => i.id)), out: new Set(plan.toTakeOut.map((i) => i.id)), plan };
  renderSeasonSheet();
  $("season-overlay").hidden = false; $("season-sheet").scrollTop = 0;
}
function renderSeasonSheet() {
  const { plan, store, out } = seasonSel;
  const grid = (list, set, kind) => '<div class="season-grid">' + list.map((it) => '<button type="button" class="season-item" data-sp="' + kind + ":" + esc(it.id) + '" aria-pressed="' + set.has(it.id) + '">' + thumb(it) + '<span class="alt-name">' + esc(it.name) + "</span></button>").join("") + "</div>";
  $("season-sheet").innerHTML = '<div class="sheet-head"><div><span class="label">Rangement</span><h2>Changement de saison</h2></div><button class="x" type="button" data-season="close" aria-label="Fermer">✕</button></div>' +
    '<p class="hint">Une pièce rangée n\'est plus proposée dans les tenues ni par la styliste, mais reste dans ton dressing (filtre « Rangées ») et peut partir en voyage. Touche une pièce pour la décocher.</p>' +
    (plan.toStore.length ? '<section class="season-sec"><h3>À ranger</h3><p class="hint">Pas faites pour ' + esc(SEASON_NAME[plan.cur]) + (plan.next !== plan.cur ? " ni pour " + esc(SEASON_NAME[plan.next]) : "") + ".</p>" + grid(plan.toStore, store, "s") +
      '<button type="button" class="btn primary block" data-season="store"' + (store.size ? "" : " disabled") + ">Ranger " + store.size + " pièce" + (store.size > 1 ? "s" : "") + "</button></section>" : "") +
    (plan.toTakeOut.length ? '<section class="season-sec"><h3>À ressortir</h3><p class="hint">Rangées, mais de saison maintenant.</p>' + grid(plan.toTakeOut, out, "o") +
      '<button type="button" class="btn primary block" data-season="takeout"' + (out.size ? "" : " disabled") + ">Ressortir " + out.size + " pièce" + (out.size > 1 ? "s" : "") + "</button></section>" : "") +
    (!plan.toStore.length && !plan.toTakeOut.length ? '<p class="empty">Ton dressing est à jour pour la saison.</p>' : "");
  hydratePhotos($("season-sheet"));
}
function setStored(ids, value) {
  mutate((d) => { for (const it of d.items) if (ids.has(it.id)) { it.stored = value; it.updatedAt = Date.now(); } });
}
function seasonAction(act) {
  if (act === "close") { $("season-overlay").hidden = true; return; }
  if (act === "later") { const k = $("season-card").dataset.key; if (k) LS.set(k, true); $("season-card").hidden = true; return; }
  if (act === "open") { openSeason(); return; }
  if (act === "store") { const n = seasonSel.store.size; setStored(seasonSel.store, true); toast(n + " pièce" + (n > 1 ? "s rangées" : " rangée") + "."); }
  if (act === "takeout") { const n = seasonSel.out.size; setStored(seasonSel.out, false); toast(n + " pièce" + (n > 1 ? "s ressorties" : " ressortie") + "."); }
  setTimeout(() => { const plan = seasonPlan(liveItems()); seasonSel = { store: new Set(plan.toStore.map((i) => i.id)), out: new Set(plan.toTakeOut.map((i) => i.id)), plan }; renderSeasonSheet(); }, 80);
}

// ---------------- LA TENUE PRÉPARÉE LA VEILLE ----------------
function toggleReady() {
  if (!current) return;
  const c = context();
  const r = readyPick(c);
  savePick(c);
  mutate((d) => {
    const p = (d.picks || {})[c.day]; if (!p) return;
    if (r) { delete p.ready; delete p.readyAt; delete p.readyW; }
    else { p.ready = true; p.readyAt = Date.now(); p.readyW = wsig(c); }
    p.t = Date.now();
  });
  toast(r ? "Ce n'est plus la tenue prévue pour demain." : "✓ Prête pour demain. Elle t'attendra au réveil.");
  if (!r && navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
  setTimeout(renderOutfit, 50);
}
/** Ce qui a changé dans la météo entre la préparation et maintenant. */
function weatherChange(before, now) {
  const [r0, t0] = String(before || "").split("/"), [r1, t1] = now.split("/");
  const out = [];
  if (r0 !== r1) out.push(r1 === "pluie" ? "de la pluie est annoncée" : "la pluie n'est plus annoncée");
  const rank = { froid: 0, doux: 1, chaud: 2 };
  if (t0 && t0 !== t1) out.push(rank[t1] < rank[t0] ? "il fera plus froid que prévu" : "il fera plus doux que prévu");
  return out;
}
function renderReady(worn, c) {
  const box = $("ready-box");
  const p = dayOffset === 0 && !worn ? readyPick(c) : null;
  if (dayOffset === 1 && !worn && !readyPick(c)) {
    box.innerHTML = '<p class="hint small">Prépare-la ce soir : demain matin, elle t\'attendra, avec un mot si la météo change d\'ici là.</p>';
    box.hidden = false; return;
  }
  if (!p) { box.hidden = true; box.innerHTML = ""; return; }
  const ch = c.live && p.readyW ? weatherChange(p.readyW, wsig(c)) : [];
  box.innerHTML = '<div class="ready-head"><span>✓ Préparée hier soir</span><button type="button" class="link" data-ready="undo">Ne plus la garder</button></div>' +
    (ch.length ? '<p class="ready-warn">La météo a changé depuis hier soir : ' + esc(ch.join(" et ")) + ".</p>" +
      '<div class="actions"><button type="button" class="btn" data-ready="keep">Je la garde</button><button type="button" class="btn primary" data-ready="adapt">Adapter la tenue</button></div>' : "");
  box.hidden = false;
}
function keepReady() {
  const c = context();
  mutate((d) => { const p = (d.picks || {})[c.day]; if (p) { p.readyW = wsig(c); p.t = Date.now(); } });
  setTimeout(renderOutfit, 50);
}
/** Refait la tenue pour la nouvelle météo en gardant le plus possible de pièces préparées. */
function adaptReady() {
  if (!current) return;
  const c = context();
  const keepIds = new Set(current.pieces.map((p) => p.id));
  const r = suggest({ items: liveItems(), feedback: data().feedback }, c, [], { keep: keepIds });
  if (!r) return;
  const changed = r.pieces.filter((p) => !keepIds.has(p.id)).map((p) => p.name);
  current = { ...r, ai: false, title: "" };
  seen.push(current.key);
  savePick(c);
  mutate((d) => { const p = (d.picks || {})[c.day]; if (p) { p.readyW = wsig(c); p.t = Date.now(); } });
  setTimeout(renderOutfit, 50);
  toast(changed.length ? "Adaptée : " + changed.join(", ") : "La tenue préparée convient toujours.");
}

// ---------------- LES 3 PROPOSITIONS DE LA STYLISTE ----------------
let proposals = null; // {day, list: [{angle, title, why, tip, pieces}]}
function openProposals() {
  if (!proposals || !proposals.list.length) return;
  $("props-sheet").innerHTML = '<div class="sheet-head"><div><span class="label">La styliste propose</span><h2>' + proposals.list.length + ' idées pour ' + (proposals.day === dayStr(0) ? "aujourd'hui" : "demain") + '</h2></div><button class="x" type="button" data-pr="close" aria-label="Fermer">✕</button></div>' +
    '<p class="hint">Choisis celle qui te plaît : ton choix lui apprend ton goût.</p>' +
    proposals.list.map((o, i) => '<article class="prop">' +
      '<div class="prop-head"><span class="tag">' + esc(o.angle) + '</span><strong>' + esc(o.title) + "</strong></div>" +
      flatlay(o.pieces.slice().sort((a, b) => ({ manteau: 0, veste: 0, haut: 1, robe: 1, bas: 2, chaussures: 3 }[a.cat] ?? 4) - ({ manteau: 0, veste: 0, haut: 1, robe: 1, bas: 2, chaussures: 3 }[b.cat] ?? 4)), true) +
      '<p class="prop-pieces">' + esc(o.pieces.map((p) => p.name).join(" · ")) + "</p>" +
      '<ul class="why">' + o.why.map((w) => "<li>" + esc(w) + "</li>").join("") + (o.tip ? "<li>Astuce : " + esc(o.tip) + "</li>" : "") + "</ul>" +
      '<button class="btn primary block" type="button" data-pr="' + i + '">Je prends celle-ci</button></article>').join("");
  hydratePhotos($("props-sheet"));
  $("props-overlay").hidden = false; $("props-sheet").scrollTop = 0;
  $("btn-props").hidden = false;
}
function chooseProposal(i) {
  const o = proposals && proposals.list[+i]; if (!o) return;
  const c = context();
  current = { key: comboKey(o.pieces), pieces: o.pieces, reasons: o.why, tip: o.tip, title: o.title, ai: true };
  seen.push(current.key);
  savePick(c);
  wornKey = null;
  const over = proposals.list.filter((x) => x !== o).map((x) => x.angle);
  mutate((d) => { d.aiChoices = (d.aiChoices || []).concat({ key: current.key, angle: o.angle, over, t: Date.now() }).slice(-30); });
  $("props-overlay").hidden = true;
  renderOutfit();
  toast("« " + o.angle + " » retenue.");
}

// ---------------- BILAN DU DRESSING ----------------
let auditBusy = false;
function openAudit() {
  renderAudit();
  $("audit-overlay").hidden = false; $("audit-sheet").scrollTop = 0;
}
function renderAudit(status) {
  const a = data().audit;
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const chip = (id) => { const it = byId.get(id); if (!it) return ""; const path = it.cut || it.photo;
    return '<button type="button" class="audit-piece" data-aid="' + esc(id) + '"><span class="alt-img ' + (it.cut ? "fl-cut" : it.photo ? "fl-photo" : "fl-glyph") + '"' + (path && sync ? ' data-photo="' + esc(path) + '" data-alt="' + esc(it.name) + '"' : "") + ">" + glyph(it.cat, it.color, it.acc, it.name) + '</span><span class="alt-name">' + esc(it.name) + "</span></button>"; };
  const refList = (title, hint, arr) => { const ok = (arr || []).filter((r) => byId.has(r.id)); return ok.length ? '<section class="audit-sec"><h3>' + title + '</h3><p class="hint">' + hint + "</p>" +
    ok.map((r) => '<div class="audit-row">' + chip(r.id) + '<div><p>' + esc(r.why) + "</p>" + (r.idea ? '<p class="audit-idea">→ ' + esc(r.idea) + "</p>" : "") + "</div></div>").join("") + "</section>" : ""; };
  const key = aiKey();
  let html = '<div class="sheet-head"><div><span class="label">La styliste</span><h2>Bilan du dressing</h2></div><button class="x" type="button" data-au="close" aria-label="Fermer">✕</button></div>';
  if (status) html += '<p class="note">' + esc(status) + "</p>";
  if (a && a.summary) {
    html += '<p class="hint">Fait le ' + new Date(a.t).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " sur " + a.count + " pièces.</p>" +
      '<section class="audit-sec"><p class="audit-summary">' + esc(a.summary) + "</p>" + (a.palette ? '<p class="hint">Palette : ' + esc(a.palette) + "</p>" : "") + "</section>" +
      refList("À ressortir", "De bonnes pièces que tu portes peu, avec une idée pour les remettre en jeu.", a.toWear) +
      refList("Orphelines", "Elles vont avec trop peu de choses dans ton dressing.", a.orphans) +
      ((a.dupes || []).length ? '<section class="audit-sec"><h3>Doublons</h3><p class="hint">Elles jouent presque le même rôle.</p>' + a.dupes.map((d) => '<div class="audit-dupe"><div class="audit-dupe-row">' + d.ids.map(chip).join("") + "</div><p>" + esc(d.why) + "</p></div>").join("") + "</section>" : "") +
      refList("À questionner", "Peu ou jamais portées, et loin de ton style : à donner, vendre ou retoucher.", a.toQuestion) +
      ((a.buys || []).length ? '<section class="audit-sec"><h3>Achats utiles</h3><p class="hint">Les plus utiles d\'abord.</p><ol class="audit-buys">' + a.buys.map((b) => "<li><strong>" + esc(b.what) + "</strong><br>" + esc(b.why) + "</li>").join("") + "</ol></section>" : "");
  } else html += '<p class="hint">La styliste regarde toutes tes pièces (photos comprises), ce que tu portes vraiment, tes styles et tes looks favoris, puis te dit ce qui marche, ce qui dort, ce qui fait doublon et ce qui manque. Environ 3 centimes.</p>';
  html += '<button class="btn primary block" type="button" data-au="run"' + (auditBusy ? " disabled" : "") + ">" + (auditBusy ? "La styliste regarde ton dressing…" : !key ? "Ajouter la clé de la styliste" : a ? "Refaire le bilan" : "Faire le bilan") + "</button>";
  $("audit-sheet").innerHTML = html;
  hydratePhotos($("audit-sheet"));
}
async function runAudit() {
  const key = aiKey();
  if (!key) { $("audit-overlay").hidden = true; showTab("settings"); setTimeout(() => $("ai-key").focus(), 50); return; }
  if (isDemo()) { toast("Ajoute d'abord ton profil."); return; }
  const items = liveItems();
  if (items.length < 5) { renderAudit("Ajoute au moins 5 pièces pour un bilan utile."); return; }
  auditBusy = true; renderAudit();
  const since = Date.now() - 183 * 864e5; const wears = new Map();
  for (const h of data().history || []) { if (h.deleted || (h.t && h.t < since)) continue; for (const id of h.items) wears.set(id, (wears.get(id) || 0) + 1); }
  const withWears = items.map((i) => ({ ...i, wears: wears.get(i.id) || 0 }));
  try {
    const r = await auditWardrobe(key, { items: withWears, prefs: prefs(), looks: liveLooks(), day: dayStr(0),
      loadImage: (it) => { const path = it.cut || it.photo; if (!path || !sync) return Promise.resolve(null); return sync.photoUrl(path).then((u) => fetch(u)).then((x) => x.blob()); } });
    mutate((d) => { d.audit = { ...r, count: items.length, t: Date.now() }; });
    auditBusy = false; setTimeout(() => renderAudit(), 60);
  } catch (e) { auditBusy = false; renderAudit(aiErrText(e)); }
}

// ---------------- CHANGER UNE PIÈCE ----------------
let pieceFor = null; // {id, alts}
function openPiece(id) {
  if (!current) return;
  const p = current.pieces.find((x) => x.id === id); if (!p) return;
  const c = context();
  const home = c.occ === "maison";
  const homeOnly = (i) => (i.occ || []).length > 0 && i.occ.every((o) => o === "maison");
  const inOutfit = new Set(current.pieces.map((x) => x.id));
  let cands = liveItems().filter((i) => !i.dirty && !i.stored && !i.repair && !inOutfit.has(i.id) && i.cat === p.cat && (home || !homeOnly(i)));
  let alts = [];
  if (p.cat === "accessoire") {
    const same = cands.filter((i) => (i.acc || "sac") === (p.acc || "sac"));
    cands = same.length ? same : cands;
    const cols = new Set(current.pieces.filter((x) => x.cat !== "accessoire").map((x) => x.color));
    const sc = (i) => (cols.has(i.color) ? 2 : 0) + (COLORS[i.color] && COLORS[i.color][2] ? 1 : 0) + Math.min(daysBetween(i.lastWorn, c.day) ?? 30, 30) / 30;
    alts = cands.sort((a, b) => sc(b) - sc(a)).slice(0, 8).map((i) => ({ item: i, reasons: null }));
  } else if (cands.length) {
    const main = current.pieces.filter((x) => x.cat !== "accessoire");
    const evaluate = cands.map((i) => main.map((x) => (x.id === p.id ? i : x)));
    const ranked = suggest({ items: liveItems(), feedback: data().feedback }, c, [], { evaluate }) || [];
    alts = ranked.slice(0, 8).map((r) => ({ item: r.pieces.find((x) => !inOutfit.has(x.id)), reasons: r.reasons })).filter((a) => a.item);
  }
  pieceFor = { id, alts };
  const mainCount = current.pieces.filter((x) => x.cat === p.cat).length;
  const removable = p.cat === "accessoire" || p.cat === "veste" || p.cat === "manteau" || (p.cat === "haut" && mainCount > 1);
  $("piece-sheet").innerHTML = '<div class="sheet-head"><div><span class="label">' + esc(catLabel(p)) + "</span><h2>" + esc(p.name) + '</h2></div><button class="x" type="button" data-pa="close" aria-label="Fermer">✕</button></div>' +
    '<div class="actions"><button class="btn" type="button" data-pa="fiche">Voir la fiche</button><button class="btn" type="button" data-pa="repair">À réparer</button>' + (removable ? '<button class="btn" type="button" data-pa="remove">Enlever de la tenue</button>' : "") + "</div>" +
    '<span class="label">' + (alts.length ? "Changer pour… (les mieux assorties d'abord)" : "Rien d'autre de propre dans cette catégorie pour le moment.") + "</span>" +
    (alts.length ? '<div class="alt-grid">' + alts.map((a, i) => {
      const it = a.item; const path = it.cut || it.photo;
      return '<button type="button" class="alt" data-alti="' + i + '"><span class="alt-img ' + (it.cut ? "fl-cut" : it.photo ? "fl-photo" : "fl-glyph") + '"' + (path && sync ? ' data-photo="' + esc(path) + '" data-alt="' + esc(it.name) + '"' : "") + ">" + glyph(it.cat, it.color, it.acc, it.name) + '</span><span class="alt-name">' + esc(it.name) + "</span></button>";
    }).join("") + "</div>" : "");
  hydratePhotos($("piece-sheet"));
  $("piece-overlay").hidden = false; $("piece-sheet").scrollTop = 0;
}
function replacePieces(pieces, reasons) {
  const c = context();
  const worn = wornEntry(c);
  current = { ...current, key: comboKey(pieces), pieces, reasons: reasons || current.reasons, ai: false, title: "" };
  seen.push(current.key);
  if (worn && sync) sync.change((d) => { const h = d.history.find((x) => x.id === worn.id); if (h) { h.items = pieces.map((x) => x.id); h.t = Date.now(); } });
  savePick(c);
  renderOutfit();
}
function pieceAction(act, b) {
  if (act === "close") { $("piece-overlay").hidden = true; return; }
  const p = current && current.pieces.find((x) => x.id === pieceFor.id); if (!p) return;
  if (act === "fiche") { $("piece-overlay").hidden = true; openItem(p); return; }
  if (act === "repair") { $("piece-overlay").hidden = true; setRepair(p.id, true); toast(p.name + " : à réparer. Elle n'est plus proposée d'ici là ; change-la si besoin."); setTimeout(() => openPiece(p.id), 400); return; }
  if (act === "remove") {
    $("piece-overlay").hidden = true;
    replacePieces(current.pieces.filter((x) => x.id !== p.id), current.reasons.filter((r) => !r.includes(p.name)));
    toast(p.name + " enlevée de la tenue.");
  }
}
function pickAlt(i) {
  const a = pieceFor && pieceFor.alts[+i]; if (!a || !current) return;
  const old = current.pieces.find((x) => x.id === pieceFor.id);
  const pieces = current.pieces.map((x) => (x.id === pieceFor.id ? a.item : x));
  $("piece-overlay").hidden = true;
  replacePieces(pieces, a.reasons || current.reasons.filter((r) => !old || !r.includes(old.name)));
  toast((old ? old.name : "La pièce") + " → " + a.item.name);
}

// ---------------- toast ----------------
let toastTimer = null;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

// ---------------- contexte du jour ----------------
function context() {
  const day = dayStr(dayOffset);
  const ag = (data().agenda || {})[day];
  const agenda = ag && !ag.deleted ? ag : null;
  const occ = occOverride[day] || (agenda && agenda.occ) || (new Date(day + "T12:00:00").getDay() % 6 === 0 ? weekendOcc() : weekdayOcc());
  const wx = weather[dayOffset];
  let w;
  if (wx) w = { morning: wx.morning.feels, afternoon: wx.afternoon.feels, rain: wx.rain, wind: wx.wind, snow: wx.snow };
  else {
    const def = MANUAL_TEMPS.find((t) => t.id === (settings.manual.temp || defaultManual())) || MANUAL_TEMPS[1];
    w = { morning: def.m, afternoon: def.a, rain: !!settings.manual.rain, wind: 0, snow: false };
  }
  return { day, season: seasonOf(day), occ, mood, important: !!(agenda && agenda.important), agenda, restDays: settings.restDays, w, live: !!wx, styles: prefs().styles || [] };
}
function defaultManual() {
  const m = new Date().getMonth();
  return [11, 0, 1].includes(m) ? "froid" : [5, 6, 7].includes(m) ? "chaud" : [4, 8].includes(m) ? "doux" : "frais";
}
const ctxKey = (c) => [c.day, c.occ, c.mood, c.important, Math.round(c.w.morning), Math.round(c.w.afternoon), c.w.rain, c.restDays, c.styles.join("+")].join("/");

// ---------------- AUJOURD'HUI ----------------
function renderWeather() {
  const el = $("weather");
  const wx = weather[dayOffset];
  $("manual-temp-group").hidden = !!wx;
  if (!settings.loc) {
    el.innerHTML = '<p class="note">Indique ton lieu pour que la météo soit prise en compte automatiquement.</p>' +
      '<div class="actions"><button class="btn" type="button" id="w-geo">Utiliser ma position</button><button class="btn" type="button" id="w-city">Choisir une ville</button></div>';
    $("w-geo").onclick = useGeo;
    $("w-city").onclick = () => { showTab("settings"); setTimeout(() => $("city-input").focus(), 50); };
    return;
  }
  if (!wx) {
    el.innerHTML = '<div class="w-place"><span class="label">' + esc(settings.loc.name) + "</span></div>" +
      '<p class="note">' + (weatherError ? "Météo indisponible pour l'instant. Règle la température à la main ci-dessous." : "Chargement de la météo…") + "</p>";
    return;
  }
  const tags = [];
  if (wx.snow) tags.push("Neige");
  else if (wx.rain) tags.push("Pluie " + wx.rainProb + " %");
  else if (wx.rainProb >= 25) tags.push("Risque de pluie " + wx.rainProb + " %");
  if (wx.wind >= 35) tags.push("Vent " + wx.wind + " km/h");
  if (wx.afternoon.feels - wx.morning.feels >= 7) tags.push("Gros écart dans la journée");
  el.innerHTML =
    '<div class="w-place"><span class="label">' + esc(settings.loc.name) + " · " + esc(wx.sky) + '</span><button type="button" class="link" id="w-refresh">Actualiser</button></div>' +
    '<div class="w-row">' +
      '<div class="w-slot"><span class="label">Matin · 8 h</span><span class="w-temp">' + Math.round(wx.morning.temp) + "°</span><span class=\"w-sub\">ressenti " + Math.round(wx.morning.feels) + "°</span></div>" +
      '<div class="w-sep"></div>' +
      '<div class="w-slot"><span class="label">Après-midi · 15 h</span><span class="w-temp">' + Math.round(wx.afternoon.temp) + "°</span><span class=\"w-sub\">ressenti " + Math.round(wx.afternoon.feels) + "°</span></div>" +
    "</div>" +
    (tags.length ? '<div class="w-tags">' + tags.map((t) => '<span class="tag">' + esc(t) + "</span>").join("") + "</div>" : "");
  $("w-refresh").onclick = () => loadWeather(true);
}

function renderControls() {
  const c = context();
  $("temp-chips").innerHTML = MANUAL_TEMPS.map((t) => {
    const on = t.toggle ? !!settings.manual.rain : (settings.manual.temp || defaultManual()) === t.id;
    return '<button type="button" class="chip" id="temp-' + t.id + '" data-t="' + t.id + '" aria-pressed="' + on + '">' + t.label + "<small>" + t.range + "</small></button>";
  }).join("");
  $("occ-label").textContent = c.agenda && !occOverride[c.day] ? "Occasion · d'après ton agenda" + (c.agenda.note ? " : " + c.agenda.note : "") : "Occasion";
  $("occ-chips").innerHTML = OCCS.map((o) => '<button type="button" class="chip" id="occ-' + o.id + '" data-o="' + o.id + '" aria-pressed="' + (c.occ === o.id) + '">' + o.label + "</button>").join("");
  $("mood-chips").innerHTML = MOODS.map((m) => '<button type="button" class="chip" id="mood-' + (m.id || "aucune") + '" data-m="' + m.id + '" aria-pressed="' + (mood === m.id) + '">' + m.label + "</button>").join("");
  const season = SEASONS.find((s) => s.id === c.season).label;
  $("ctx-label").textContent = season + (c.important ? " · important" : "");
  $("day-today").setAttribute("aria-pressed", dayOffset === 0);
  $("day-tomorrow").setAttribute("aria-pressed", dayOffset === 1);
}

function renderOutfit() {
  const lay = $("lay"), why = $("why");
  const c = context();
  $("outfit-title").textContent = current && current.ai ? current.title : (dayOffset === 0 ? "Tenue du jour" : "Tenue de demain") + (current && current.week ? " · prévue" : "");
  $("btn-ai").disabled = aiBusy || !current;
  if (!current) {
    lay.innerHTML = "";
    const note = missingNote(liveItems(), c);
    why.innerHTML = "<li>" + esc(note || "Pas assez de vêtements pour composer une tenue.") + "</li>";
    ["btn-wear", "btn-other", "btn-like", "btn-dislike"].forEach((id) => ($(id).disabled = true));
    return;
  }
  ["btn-wear", "btn-other", "btn-like", "btn-dislike"].forEach((id) => ($(id).disabled = false));
  const order = { manteau: 0, veste: 0, haut: 1, robe: 1, bas: 2, chaussures: 3, accessoire: 4 };
  const pieces = current.pieces.slice().sort((a, b) => (order[a.cat] ?? 5) - (order[b.cat] ?? 5));
  lay.innerHTML = flatlay(pieces, false, true) +
    '<ul class="fl-list">' + pieces.map((p) => '<li><button type="button" class="piece-row" data-pid="' + esc(p.id) + '"><span class="tag">' + esc(catLabel(p)) + '</span><span class="piece-name">' + esc(p.name) + '</span><span class="piece-meta">' + wornText(p) + '</span><span class="chev" aria-hidden="true">›</span></button></li>').join("") + "</ul>" +
    '<p class="hint small tap-hint">Touche une pièce pour voir sa fiche ou la changer.</p>';
  hydratePhotos(lay);
  const worn = wornEntry(c);
  // une fois portée, les remarques « pas encore porté » n'ont plus de sens
  let lines = current.reasons.slice();
  if (worn) lines = lines.filter((l) => !/pas encore porté|pas porté depuis|n'a encore jamais/.test(l));
  if (current.tip) lines.push("Astuce : " + current.tip);
  const note = current.ai || worn ? "" : missingNote(liveItems(), c);
  if (note) lines.push(note);
  why.innerHTML = lines.map((l) => "<li>" + esc(l) + "</li>").join("");
  why.hidden = !lines.length;
  const fb = (data().feedback || {})[current.key];
  $("btn-like").setAttribute("aria-pressed", !!(fb && fb.v === 1));
  renderWorn(worn, c);
}

/** L'entrée d'historique correspondant à la tenue affichée, pour le jour affiché. */
function wornEntry(c) {
  if (!current) return null;
  const k = comboKey(current.pieces);
  return (data().history || []).find((h) => !h.deleted && h.day === c.day && comboKey(h.items.map((id) => ({ id }))) === k) || null;
}

function readyPick(c) {
  const p = (data().picks || {})[c.day];
  return p && !p.deleted && p.ready && current && comboKey(p.ids.map((id) => ({ id }))) === comboKey(current.pieces) ? p : null;
}
function renderWorn(worn, c) {
  const btn = $("btn-wear"), box = $("worn-box");
  const when = dayOffset === 0 ? "aujourd'hui" : "demain";
  renderReady(worn, c);
  if (dayOffset === 1 && !worn) {
    const r = readyPick(c);
    btn.classList.toggle("done", !!r); btn.setAttribute("aria-pressed", !!r);
    btn.textContent = r ? "✓ Prête pour demain" : "Je la prépare pour demain";
    $("outfit-card").classList.toggle("is-worn", !!r);
    $("worn-stamp").hidden = !r; $("worn-stamp").textContent = "✓ Prête";
    box.hidden = true;
    return;
  }
  btn.classList.toggle("done", !!worn);
  btn.setAttribute("aria-pressed", !!worn);
  btn.textContent = worn ? "✓ Tenue portée " + when : "Je la porte";
  $("outfit-card").classList.toggle("is-worn", !!worn);
  $("worn-stamp").hidden = !worn;
  $("worn-stamp").textContent = "✓ Portée " + when;
  if (!worn) { box.hidden = true; return; }
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const pieces = current.pieces.map((p) => byId.get(p.id) || p);
  box.innerHTML = '<div class="worn-head"><span>Enregistrée dans ton historique.</span><button type="button" class="link" id="btn-unwear">Annuler</button></div>' +
    '<span class="label">Ce soir, tu mets au sale ?</span>' +
    '<div class="chips">' + pieces.map((p) => '<button type="button" class="chip" data-dirty="' + esc(p.id) + '" aria-pressed="' + !!p.dirty + '">' + (p.dirty ? "✓ " : "") + esc(p.name) + (p.dirty ? " · au sale" : "") + "</button>").join("") + "</div>";
  box.hidden = false;
}

function newSuggestion(reset) {
  let c = context();
  const k = ctxKey(c);
  if (reset || k !== lastCtxKey) seen = [];
  lastCtxKey = k;
  wornKey = null; $("outfit-msg").hidden = true;
  if (!seen.length) {
    // à la première ouverture du jour sur cet appareil, on reprend aussi l'occasion et l'envie choisies
    const p = (data().picks || {})[c.day];
    const hk = (sync ? sync.profile.id : "demo") + "/" + c.day;
    const first = !honored.has(hk);
    honored.add(hk); // une seule fois par jour : ensuite, c'est ton choix d'occasion ou d'envie qui compte
    if (p && !p.deleted && first) {
      if (p.occ && p.occ !== c.occ) occOverride[c.day] = p.occ;
      mood = p.mood || "";
      c = context(); lastCtxKey = ctxKey(c); renderControls();
    }
    const kept = restoreFor(c);
    if (kept) { current = kept; seen.push(kept.key); renderOutfit(); return; }
    const wk = weekOutfitFor(c);
    if (wk) { current = wk; seen.push(wk.key); renderOutfit(); savePick(c); return; }
  }
  const items = liveItems();
  current = suggest({ items, feedback: data().feedback }, c, seen);
  if (current) { seen.push(current.key); if (seen.length > 10) seen.shift(); savePick(c); }
  renderOutfit();
}

// ---------------- tenue retenue pour le jour ----------------
// La tenue proposée est enregistrée : elle reste la même quand on ferme et rouvre l'appli,
// et sur tous les appareils, jusqu'à ce qu'on demande « Autre idée » ou qu'on change d'occasion.
const honored = new Set();
// la tenue retenue tient tant que la météo reste du même genre (pluie ou non, froid / doux / chaud)
const wsig = (c) => (c.w.rain || c.w.snow ? "pluie" : "sec") + "/" + (c.w.morning < 9 ? "froid" : c.w.morning < 19 ? "doux" : "chaud");
/** Tenue incomplète alors que le dressing permettrait mieux (ex. choisie quand il n'y avait qu'un pull). */
function incomplete(pieces, c) {
  const homeOnly = (i) => (i.occ || []).length > 0 && i.occ.every((o) => o === "maison");
  const avail = liveItems().filter((i) => !i.dirty && (c.occ === "maison" || !homeOnly(i)));
  const can = (cat) => avail.some((i) => i.cat === cat);
  const has = (cat) => pieces.some((p) => p.cat === cat);
  const baseOk = has("robe") || (has("haut") && has("bas")) || (!can("robe") && !(can("haut") && can("bas")));
  const shoesOk = has("chaussures") || !can("chaussures");
  return !(baseOk && shoesOk);
}
function restoreFor(c) {
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const p = (data().picks || {})[c.day];
  const usable = (ids, allowDirty) => { const ps = ids.map((id) => byId.get(id)); return ps.every((x) => x && (allowDirty || !x.dirty)) ? ps : null; };
  // 1. une tenue déjà notée « portée » ce jour-là
  const h = (data().history || []).filter((x) => !x.deleted && x.day === c.day).sort((a, b) => (b.t || 0) - (a.t || 0))[0];
  if (h) {
    const ps = usable(h.items, true);
    if (ps) {
      const same = p && !p.deleted && comboKey(p.ids.map((id) => ({ id }))) === comboKey(h.items.map((id) => ({ id })));
      return { key: comboKey(ps.filter((x) => x.cat !== "accessoire")), pieces: ps, reasons: same ? p.reasons || [] : [], tip: same ? p.tip : "", title: same ? p.title : "", ai: same && p.ai, week: same && p.week };
    }
  }
  // 2. la tenue préparée la veille : on la garde telle quelle (un message signale si la météo a changé)
  if (p && !p.deleted && p.ready) {
    const ps = usable(p.ids, false);
    if (ps) return { key: comboKey(ps.filter((x) => x.cat !== "accessoire")), pieces: ps, reasons: p.reasons || [], tip: p.tip || "", title: p.title || "", ai: !!p.ai, week: !!p.week };
  }
  // 3. la tenue proposée plus tôt pour ce jour, si l'occasion et l'envie n'ont pas changé
  if (p && !p.deleted && p.occ === c.occ && (p.mood || "") === (c.mood || "") && (!p.wsig || p.wsig === wsig(c))) {
    const ps = usable(p.ids, false);
    if (ps && !incomplete(ps, c)) return { key: comboKey(ps.filter((x) => x.cat !== "accessoire")), pieces: ps, reasons: p.reasons || [], tip: p.tip || "", title: p.title || "", ai: !!p.ai, week: !!p.week };
  }
  return null;
}
function savePick(c) {
  if (!current) return;
  if (sync && !sync.loaded) return; // on attend d'avoir les données à jour avant d'écrire
  const old = (data().picks || {})[c.day];
  const pick = { ids: current.pieces.map((p) => p.id), occ: c.occ, mood: c.mood || "", wsig: wsig(c), reasons: current.reasons || [], tip: current.tip || "", title: current.title || "", ai: !!current.ai, week: !!current.week, t: Date.now() };
  // une tenue préparée la veille le reste, même si on change une pièce
  if (old && !old.deleted && old.ready) { pick.ready = true; pick.readyAt = old.readyAt; pick.readyW = old.readyW; }
  const limit = addDays(dayStr(0), -7);
  mutate((d) => {
    d.picks = d.picks || {};
    d.picks[c.day] = pick;
    for (const k of Object.keys(d.picks)) if (k < limit) delete d.picks[k];
  });
}

/** Garde la tenue affichée si ses pièces existent toujours, sinon en propose une autre. */
function refreshOutfit() {
  if (!current || ctxKey(context()) !== lastCtxKey) return newSuggestion(true);
  if (!wornEntry(context()) && incomplete(current.pieces, context())) return newSuggestion(true);
  const map = new Map(liveItems().map((i) => [i.id, i]));
  if (current.pieces.every((p) => map.has(p.id) && (!map.get(p.id).dirty || current.key === wornKey || wornEntry(context())))) {
    current = { ...current, pieces: current.pieces.map((p) => map.get(p.id)) };
    renderOutfit();
  } else newSuggestion(false);
}

function wearCurrent() {
  if (!current) return;
  const msg = $("outfit-msg");
  if (isDemo()) { msg.textContent = "C'est le dressing d'exemple : connecte ton dépôt pour suivre ce que tu portes."; msg.hidden = false; return; }
  const c = context();
  const ids = current.pieces.map((p) => p.id);
  if (wornEntry(c)) return; // déjà enregistrée : le bouton affiche « ✓ Tenue portée »
  wornKey = current.key;
  sync.change((d) => { d.history.unshift({ id: uid(), day: c.day, items: ids, t: Date.now() }); });
  toast("✓ Tenue enregistrée pour " + (dayOffset === 0 ? "aujourd'hui" : "demain"));
  if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
}
function unwearCurrent() {
  const e = wornEntry(context()); if (!e) return;
  sync.change((d) => { const h = d.history.find((x) => x.id === e.id); if (h) { h.deleted = true; h.t = Date.now(); } });
  toast("Annulé : la tenue n'est plus notée.");
}


async function askAi() {
  if (!current) return;
  const key = aiKey();
  const msg = $("outfit-msg");
  if (!key) { showTab("settings"); setTimeout(() => $("ai-key").focus(), 50); toast("Ajoute d'abord ta clé API Anthropic."); return; }
  aiBusy = true; const btn = $("btn-ai"); btn.disabled = true; btn.textContent = "La styliste réfléchit…";
  const c = context();
  const allItems = liveItems();
  const items = allItems.filter((i) => !i.stored && !i.repair);
  const byId = new Map(allItems.map((i) => [i.id, i]));
  const fb = data().feedback || {};
  const names = (k) => k.split("|").map((id) => byId.get(id)).filter(Boolean).map((i) => i.name).join(" + ");
  const recent = (v) => Object.keys(fb).filter((k) => fb[k].v === v).sort((a, b) => (fb[b].t || 0) - (fb[a].t || 0));
  const liked = recent(1).map(names).filter(Boolean);
  const disliked = recent(-1).map((k) => {
    const n = names(k); if (!n) return "";
    const f = fb[k]; const why = f.why === "piece" ? (byId.get(f.piece) ? "à cause de : " + byId.get(f.piece).name : "") : WHY[f.why] || "";
    return why ? n + " (" + why.toLowerCase() + ")" : n;
  }).filter(Boolean);
  // ce qui revient dans les refus
  const counts = {}; for (const k of recent(-1)) { const w = fb[k].why; if (w && w !== "piece") counts[w] = (counts[w] || 0) + 1; }
  const lessons = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([w, n]) => WHY[w] + " (" + n + " fois)");
  const noPieces = [...new Set(recent(-1).map((k) => fb[k].piece).filter((id) => byId.has(id)))].map((id) => byId.get(id).name);
  // les tenues vraiment portées, les plus fréquentes d'abord (6 derniers mois)
  const since = Date.now() - 183 * 864e5; const wornCount = new Map();
  for (const h of data().history || []) {
    if (h.deleted || (h.t && h.t < since)) continue;
    const k = h.items.slice().sort().join("|"); wornCount.set(k, (wornCount.get(k) || 0) + 1);
  }
  const worn = [...wornCount].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => { const t = names(k); return t ? t + (n > 1 ? " (" + n + " fois)" : "") : ""; }).filter(Boolean);
  const choices = (data().aiChoices || []).slice(-8).reverse().map((x) => { const n = names(x.key); return n ? n + " (" + x.angle.toLowerCase() + (x.over && x.over.length ? ", préférée à : " + x.over.join(" / ").toLowerCase() : "") + ")" : ""; }).filter(Boolean);
  const composed = liveOutfits().filter((o) => o.source === "moi").slice(0, 8).map((o) => o.ids.map((id) => byId.get(id)).filter(Boolean).map((i) => i.name).join(" + ")).filter(Boolean);
  try {
    const loadImage = (it) => {
      const path = it.cut || it.photo;
      if (!path || !sync) return Promise.resolve(null);
      return sync.photoUrl(path).then((u) => fetch(u)).then((r) => r.blob());
    };
    const r = await askStylist(key, { items, ctx: c, weather: weather[dayOffset], prefs: prefs(), choices, looks: liveLooks(), loadLook: (l) => sync ? sync.photoUrl(l.photo).then((u) => fetch(u)).then((r) => r.blob()) : Promise.resolve(null), liked, disliked, lessons, noPieces, worn, composed, current: current.pieces.map((p) => p.name).join(" + "), loadImage });
    msg.hidden = true;
    proposals = { day: c.day, list: r.options.map((o) => ({ ...o, pieces: o.ids.map((id) => byId.get(id)).filter(Boolean) })).filter((o) => o.pieces.length) };
    openProposals();
  } catch (e) {
    const k = e instanceof AiError ? e.kind : "other";
    msg.textContent = {
      auth: "Anthropic refuse la clé API. Vérifie-la dans Réglages.",
      credit: "Le compte Anthropic n'a plus de crédit. Recharge-le dans la console Anthropic.",
      rate: "Trop de demandes d'un coup. Réessaie dans une minute.",
      busy: "La styliste est surchargée pour l'instant. Réessaie dans quelques minutes.",
      network: "Pas de connexion : la styliste a besoin d'internet.",
      format: "La réponse de la styliste n'était pas exploitable (" + e.message + "). Réessaie."
    }[k] || "La demande n'a pas abouti (" + e.message + ").";
    msg.hidden = false;
  }
  aiBusy = false; btn.textContent = "Demander à la styliste"; btn.disabled = !current;
}

function setPrefs(patch) {
  const apply = (d) => { d.prefs = { ...(d.prefs || { styles: [], note: "" }), ...patch, t: Date.now() }; };
  if (isDemo()) { apply(demoDoc); renderSettings(); newSuggestion(true); }
  else sync.change(apply);
}

// ---------------- DRESSING ----------------
function renderWardrobe() {
  const all = liveItems();
  $("count").textContent = isDemo() ? "exemple" : all.length + " pièce" + (all.length > 1 ? "s" : "");
  renderProgress(all);
  const isHome = (i) => (i.occ || []).length > 0 && i.occ.every((o) => o === "maison");
  const inFilter = (i, f) => f === "rangees" ? !!i.stored : i.stored ? false : f === "tous" ? true : f === "maison" ? (i.occ || []).includes("maison") : f === "trier" ? toSort(i) : i.cat === f;
  $("cat-filter").innerHTML = [{ id: "tous", label: "Tout" }].concat(CATS, [{ id: "maison", label: "Maison" }, { id: "trier", label: "À trier" }], all.some((i) => i.stored) ? [{ id: "rangees", label: "Rangées" }] : []).map((c) => {
    const n = all.filter((i) => inFilter(i, c.id)).length;
    return '<button type="button" class="chip" id="filter-' + c.id + '" data-f="' + c.id + '" aria-pressed="' + (catFilter === c.id) + '">' + c.label + "<small>" + n + "</small></button>";
  }).join("");
  const dirty = all.filter((i) => i.dirty);
  $("laundry").hidden = !dirty.length;
  $("laundry-row").innerHTML = dirty.map((it) => '<button type="button" class="laundry-item" data-clean="' + esc(it.id) + '">' + thumb(it) +
    '<span class="piece-name">' + esc(it.name) + '</span><span class="piece-meta">Lavé</span><span class="note small">Propre seul dans ' + it.cleanIn + " j</span></button>").join("");
  const q = normTxt(search.trim());
  const brands = brandsList();
  $("brand-chips").hidden = brands.length < 2;
  $("brand-chips").innerHTML = brands.slice(0, 12).map(([b, n]) => '<button type="button" class="chip" data-brand="' + esc(b) + '" aria-pressed="' + (q && normTxt(b) === q) + '">' + esc(b) + "<small>" + n + "</small></button>").join("");
  $("trier-hint").hidden = catFilter !== "trier";
  const list = all.filter((i) => inFilter(i, catFilter) && (!q || normTxt(i.name).includes(q) || normTxt((COLORS[i.color] || [""])[0]).includes(q) || normTxt(i.brand).includes(q)))
    .sort((a, b) => CATS.findIndex((c) => c.id === a.cat) - CATS.findIndex((c) => c.id === b.cat) || a.name.localeCompare(b.name, "fr"));
  $("grid").innerHTML = list.length ? list.map((it) =>
    '<button type="button" class="card' + (it.dirty ? " is-dirty" : "") + '" data-id="' + esc(it.id) + '"' + (it.demo ? " disabled" : "") + ">" +
    thumb(it, it.demo ? "Exemple" : it.stored ? "Rangée" : it.repair ? "À réparer" : it.dirty ? "Au sale" : it.cat === "accessoire" ? catLabel(it) : "", isHome(it) ? "Maison" : "") +
    '<span class="piece-name">' + esc(it.name) + '</span><span class="piece-meta">' + (it.brand ? esc(it.brand) + " · " : "") + wornText(it) + (it.wornCount ? " · " + it.wornCount + " fois" : "") + "</span></button>"
  ).join("") : '<p class="empty">' + (q ? "Aucune pièce ne correspond à « " + esc(search.trim()) + " »." : catFilter === "trier" && all.length ? "Rien à trier : tout a été porté ces 6 derniers mois." : all.length ? "Rien dans cette catégorie pour l'instant." : "Ton dressing est vide. Ajoute ton premier vêtement : une photo, un nom, et c'est parti.") + "</p>";
  if (!$("wd-wishes").hidden) renderWishes();
  renderSeasonCard(all);
  const rep = all.filter((i) => i.repair);
  $("repair").hidden = !rep.length;
  $("repair-row").innerHTML = rep.map((it) => '<button type="button" class="laundry-item" data-fixed="' + esc(it.id) + '">' + thumb(it) +
    '<span class="piece-name">' + esc(it.name) + '</span><span class="piece-meta">Réparé</span>' + (it.repairNote ? '<span class="note small">' + esc(it.repairNote) + "</span>" : "") + "</button>").join("");
  hydratePhotos($("view-wardrobe"));
}

function setRepair(id, value) {
  mutate((d) => { const it = d.items.find((i) => i.id === id); if (it) { it.repair = value; if (!value) it.repairNote = null; it.updatedAt = Date.now(); } });
}
function setDirty(id, value) {
  if (isDemo()) return;
  sync.change((d) => {
    const it = d.items.find((i) => i.id === id);
    if (it) { it.dirty = value; it.dirtyAt = value ? Date.now() : null; it.updatedAt = Date.now(); }
  });
}

// ---------------- AGENDA ----------------
function renderAgenda() {
  const ag = data().agenda || {};
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const day = dayStr(i);
    const e = ag[day] && !ag[day].deleted ? ag[day] : null;
    const label = i === 0 ? "Auj." : i === 1 ? "Demain" : fmtDay(day, { weekday: "short", day: "numeric" });
    const what = e ? OCCS.find((o) => o.id === e.occ).label + (e.note ? " · " + e.note : "") : "Rien de prévu";
    rows.push('<button type="button" class="day' + (i === 0 ? " is-today" : "") + '" data-day="' + day + '"><span class="day-date">' + esc(label) +
      '</span><span class="day-what' + (e ? "" : " none") + '">' + esc(what) + "</span>" + (e && e.important ? '<span class="tag">Important</span>' : "<span></span>") + "</button>");
  }
  $("days").innerHTML = rows.join("");
  renderTrips();
  renderWeek();
  if (openTripId && !$("tripview-overlay").hidden) renderTripView();

  renderCalendar();
}

// ---------------- CALENDRIER DU MOIS ----------------
let calMonth = null; // "AAAA-MM"
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function dayOutfits() {
  // la dernière tenue notée pour chaque jour
  const m = new Map();
  for (const h of data().history || []) { if (h.deleted) continue; const o = m.get(h.day); if (!o || (h.t || 0) > (o.t || 0)) m.set(h.day, h); }
  return m;
}
function renderCalendar() {
  const today = dayStr(0);
  if (!calMonth) calMonth = today.slice(0, 7);
  const [y, mo] = calMonth.split("-").map(Number);
  const first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // lundi en premier
  const byDay = dayOutfits();
  const byId = new Map((data().items || []).map((i) => [i.id, i]));
  const picks = data().picks || {};
  const main = (ids) => { const ps = ids.map((id) => byId.get(id)).filter((i) => i && !i.deleted); return ps.find((p) => p.cat === "haut" || p.cat === "robe") || ps.find((p) => p.cat !== "accessoire") || ps[0]; };
  let worn = 0, cells = "";
  for (let i = 0; i < lead; i++) cells += '<span class="cal-cell is-empty"></span>';
  for (let d = 1; d <= days; d++) {
    const ds = calMonth + "-" + String(d).padStart(2, "0");
    const h = byDay.get(ds); const p = picks[ds];
    const planned = !h && ds > today && p && !p.deleted && p.ready;
    const it = h ? main(h.items) : planned ? main(p.ids) : null;
    if (h) worn++;
    cells += '<button type="button" class="cal-cell' + (ds === today ? " is-today" : "") + (h ? " has-outfit" : "") + (planned ? " is-planned" : "") + '" data-cal="' + ds + '"' + (h || planned ? "" : " disabled") + ' aria-label="' + esc(fmtDay(ds, { weekday: "long", day: "numeric", month: "long" })) + (h ? ", tenue portée" : planned ? ", tenue prévue" : "") + '">' +
      '<span class="cal-num">' + d + "</span>" + (it ? '<span class="cal-img"' + ((it.cut || it.photo) && sync ? ' data-photo="' + esc(it.cut || it.photo) + '" data-alt=""' : "") + ">" + glyph(it.cat, it.color, it.acc, it.name) + "</span>" : "") + "</button>";
  }
  const canNext = calMonth < today.slice(0, 7);
  $("calendar").innerHTML = '<div class="cal-head"><button type="button" class="x" data-calnav="-1" aria-label="Mois précédent">‹</button><strong>' + MONTHS[mo - 1] + " " + y + '</strong><button type="button" class="x" data-calnav="1" aria-label="Mois suivant"' + (canNext ? "" : " disabled") + ">›</button></div>" +
    '<div class="cal-grid">' + ["L", "M", "M", "J", "V", "S", "D"].map((l) => '<span class="cal-dow">' + l + "</span>").join("") + cells + "</div>" +
    '<p class="hint">' + (worn ? worn + " tenue" + (worn > 1 ? "s" : "") + " notée" + (worn > 1 ? "s" : "") + " ce mois-ci. Touche un jour pour revoir la tenue." : "Les tenues notées avec « Je la porte » apparaissent ici, jour par jour.") + "</p>";
  hydratePhotos($("calendar"));
}
function openCalDay(ds) {
  const h = dayOutfits().get(ds);
  const p = (data().picks || {})[ds];
  const ids = h ? h.items : p && p.ready ? p.ids : null; if (!ids) return;
  const byId = new Map((data().items || []).map((i) => [i.id, i]));
  const pieces = ids.map((id) => byId.get(id)).filter((i) => i && !i.deleted);
  const order = { manteau: 0, veste: 0, haut: 1, robe: 1, bas: 2, chaussures: 3, accessoire: 4 };
  pieces.sort((a, b) => (order[a.cat] ?? 5) - (order[b.cat] ?? 5));
  $("cal-sheet").innerHTML = '<div class="sheet-head"><div><span class="label">' + (h ? "Portée le" : "Prévue pour le") + "</span><h2>" + esc(fmtDay(ds, { weekday: "long", day: "numeric", month: "long" })) + '</h2></div><button class="x" type="button" data-cd="close" aria-label="Fermer">✕</button></div>' +
    flatlay(pieces, true) +
    '<ul class="fl-list">' + pieces.map((x) => '<li><span class="tag">' + esc(catLabel(x)) + '</span><span class="piece-name">' + esc(x.name) + "</span></li>").join("") + "</ul>" +
    '<div class="actions"><button type="button" class="btn" data-cd="again">La remettre aujourd\'hui</button>' + (h ? '<button type="button" class="btn" data-cd="remove">Retirer du calendrier</button>' : "") + "</div>";
  $("cal-sheet").dataset.day = ds;
  hydratePhotos($("cal-sheet"));
  $("cal-overlay").hidden = false;
}
function calAction(act) {
  const ds = $("cal-sheet").dataset.day;
  if (act === "close") { $("cal-overlay").hidden = true; return; }
  const h = dayOutfits().get(ds);
  const p = (data().picks || {})[ds];
  const ids = h ? h.items : p ? p.ids : [];
  if (act === "again") {
    const byId = new Map(liveItems().map((i) => [i.id, i]));
    const pieces = ids.map((id) => byId.get(id)).filter(Boolean);
    $("cal-overlay").hidden = true;
    if (!pieces.length) { toast("Ces pièces ne sont plus dans le dressing."); return; }
    dayOffset = 0; renderWeather(); renderControls();
    const dirty = pieces.filter((x) => x.dirty || x.stored || x.repair).map((x) => x.name);
    wearPieces(pieces, "Reprise du " + fmtDay(ds, { day: "numeric", month: "long" }) + ".");
    if (dirty.length) setTimeout(() => toast("Attention : " + dirty.join(", ") + " " + (dirty.length > 1 ? "sont" : "est") + " au sale, rangé ou à réparer."), 1500);
  }
  if (act === "remove" && h) {
    mutate((d) => { const x = d.history.find((e) => e.id === h.id); if (x) { x.deleted = true; x.t = Date.now(); } });
    $("cal-overlay").hidden = true; toast("Retirée du calendrier.");
  }
}

function openDay(day) {
  if (isDemo()) { toast("Connecte ton dressing pour utiliser l'agenda."); return; }
  editingDay = day;
  const e = (data().agenda || {})[day];
  dayDraft = e && !e.deleted ? { ...e } : { occ: "travail", important: false, note: "" };
  $("day-title").textContent = fmtDay(day);
  $("d-note").value = dayDraft.note || "";
  renderDaySheet();
  $("day-overlay").hidden = false;
  $("day-form").scrollTop = 0;
}
function renderDaySheet() {
  $("d-occ").innerHTML = OCCS.map((o) => '<button type="button" class="chip" data-o="' + o.id + '" aria-pressed="' + (dayDraft.occ === o.id) + '">' + o.label + "</button>").join("");
  $("d-imp").innerHTML = [[false, "Normal"], [true, "Important"]].map(([v, l]) => '<button type="button" class="chip" data-i="' + v + '" aria-pressed="' + (dayDraft.important === v) + '">' + l + "</button>").join("");
}



// ---------------- GARDE-ROBE DE LA SEMAINE ----------------
async function computeWeek() {
  const start = dayStr(0);
  let forecast = {};
  if (settings.loc) { try { forecast = await fetchRange(settings.loc.lat, settings.loc.lon); } catch (e) { forecast = {}; } }
  const climate = MANUAL_TEMPS.find((t) => t.id === (settings.manual.temp || defaultManual())) || MANUAL_TEMPS[1];
  const ag = data().agenda || {};
  const days = [], wx = {};
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const a = ag[day] && !ag[day].deleted ? ag[day] : null;
    const occ = (a && a.occ) || (new Date(day + "T12:00:00").getDay() % 6 === 0 ? weekendOcc() : weekdayOcc());
    const f = forecast[day];
    const w = f ? { morning: f.morning.feels, afternoon: f.afternoon.feels, rain: f.rain, wind: f.wind, snow: f.snow }
      : { morning: climate.m, afternoon: climate.a, rain: false, wind: 0, snow: false };
    if (f) wx[day] = { m: Math.round(f.morning.feels), a: Math.round(f.afternoon.feels), rain: f.rain, snow: f.snow };
    days.push({ day, season: seasonOf(day), occ, w, important: !!(a && a.important), label: fmtDay(day, { weekday: "long", day: "numeric" }) });
  }
  const items = liveItems().map((i) => ({ ...i, dirty: false }));
  const res = planTrip({ items, feedback: data().feedback }, days, { mood: "", styles: prefs().styles || [] });
  return {
    start,
    outfits: res.outfits.map((o, i) => ({ day: o.day, label: days[i].label, occ: days[i].occ, ids: o.pieces.map((p) => p.id) })),
    packed: res.packed.map((p) => p.id),
    wx, t: Date.now()
  };
}
const liveWeek = () => { const w = data().week; return w && !w.deleted && w.outfits && addDays(w.start, 6) >= dayStr(0) ? w : null; };

/** La tenue prévue pour ce jour dans la semaine, si elle tient toujours (pièces présentes et propres, même occasion). */
function weekOutfitFor(c) {
  const w = liveWeek(); if (!w) return null;
  const o = w.outfits.find((x) => x.day === c.day); if (!o || o.occ !== c.occ || !o.ids.length) return null;
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const pieces = o.ids.map((id) => byId.get(id));
  if (pieces.some((p) => !p || p.dirty)) return null;
  const main = pieces.filter((p) => p.cat !== "accessoire");
  const wd = (w.wx || {})[c.day];
  return { key: comboKey(main), pieces, week: true,
    reasons: ["Tenue prévue dans ta garde-robe de la semaine." + (wd ? " Météo prévue : " + wd.m + "° le matin, " + wd.a + "° l'après-midi." : ""), "« Autre idée » propose autre chose sans toucher à la semaine."] };
}

function boardTile(p) {
  const path = p.cut || p.photo;
  const kind = p.cut ? "fl-cut" : p.photo ? "fl-photo" : "fl-glyph";
  const data = path && sync ? ' data-photo="' + esc(path) + '" data-alt="' + esc(p.name) + '"' : "";
  return '<div class="board-item ' + kind + '"' + data + ' title="' + esc(p.name) + '">' + glyph(p.cat, p.color, p.acc, p.name) + "</div>";
}

function renderWeek() {
  const el = $("week");
  const w = liveWeek();
  if (!w) {
    el.innerHTML = '<p class="hint">Les pièces de ta semaine sur une seule planche, et une tenue prévue pour chaque jour selon la météo et ton agenda. Ces pièces se combinent entre elles : tu sors tout le dimanche soir et la semaine est réglée.</p>' +
      '<button class="btn primary block" type="button" data-wk-act="make">Préparer ma semaine</button>';
    return;
  }
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const order = CATS.map((c) => c.id);
  const packed = w.packed.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
  const today = dayStr(0);
  el.innerHTML =
    '<div class="board"><div class="board-title"><span class="board-big">Wardrobe</span><span class="board-sub">de la semaine</span></div>' +
    '<div class="board-grid">' + packed.map(boardTile).join("") + "</div></div>" +
    '<p class="note">' + packed.length + " pièces pour 7 tenues · du " + esc(fmtDay(w.start, { weekday: "long", day: "numeric" })) + " au " + esc(fmtDay(addDays(w.start, 6), { weekday: "long", day: "numeric", month: "long" })) + "</p>" +
    '<div class="week-days">' + w.outfits.filter((o) => o.day >= today).map((o) => {
      const pieces = o.ids.map((id) => byId.get(id)).filter(Boolean);
      const wd = (w.wx || {})[o.day];
      return '<div class="week-day"><span class="label">' + esc(o.day === today ? "Aujourd'hui" : o.label) + "</span>" + flatlay(pieces, true) +
        '<span class="piece-meta">' + esc((OCCS.find((x) => x.id === o.occ) || {}).label || "") + (wd ? " · " + wd.m + "° → " + wd.a + "°" + (wd.snow ? " · neige" : wd.rain ? " · pluie" : "") : "") + "</span></div>";
    }).join("") + "</div>" +
    '<div class="actions"><button class="btn" type="button" data-wk-act="clear">Effacer</button><button class="btn" type="button" data-wk-act="make">Recalculer</button></div>';
  hydratePhotos(el);
}

async function weekAction(act, b) {
  if (act === "clear") { mutate((d) => { d.week = { deleted: true, t: Date.now() }; }); return; }
  if (act === "make") {
    if (!liveItems().length) { toast("Ajoute d'abord des vêtements à ton dressing."); return; }
    b.disabled = true; b.textContent = "Préparation…";
    const plan = await computeWeek();
    mutate((d) => {
      d.week = plan;
      // les tenues prévues remplacent celles déjà retenues pour ces jours
      d.picks = d.picks || {};
      for (const o of plan.outfits) if (d.picks[o.day]) d.picks[o.day] = { deleted: true, t: Date.now() };
    });
    current = null; seen = [];
    toast("Ta semaine est prête.");
  }
}

// ---------------- VALISES ----------------
function mutate(fn) {
  if (isDemo()) { fn(demoDoc); renderAfterData(); }
  else sync.change(fn);
}
const addDays = (day, n) => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const liveTrips = () => Object.entries(data().trips || {}).filter(([, t]) => t && !t.deleted).map(([id, t]) => ({ id, ...t }))
  .sort((a, b) => (a.start < b.start ? -1 : 1));

function renderTrips() {
  const today = dayStr(0);
  const trips = liveTrips().filter((t) => addDays(t.start, t.len - 1) >= addDays(today, -7));
  $("trips").innerHTML = trips.map((t) => {
    const total = (t.plan && t.plan.packed || []).length, done = (t.checked || []).filter((id) => (t.plan.packed || []).includes(id)).length;
    return '<button type="button" class="trip-card" data-trip="' + esc(t.id) + '"><div class="grow"><strong>' + esc(t.dest.name) + '</strong><span class="sub">' +
      esc(fmtDay(t.start, { day: "numeric", month: "short" })) + " → " + esc(fmtDay(addDays(t.start, t.len - 1), { day: "numeric", month: "short" })) + " · " + t.len + " jour" + (t.len > 1 ? "s" : "") +
      '</span></div><span class="progress">' + done + "/" + total + "</span></button>";
  }).join("");
}

function openTripForm() {
  const start = addDays(dayStr(0), 7);
  tripDraft = { dest: null, results: [], occ: weekdayOcc() === "maison" ? "quotidien" : "quotidien", extra: [], climate: null };
  $("t-city").value = ""; $("t-city-results").innerHTML = ""; $("t-dest").textContent = "";
  $("t-start").value = start; $("t-len").value = 4; $("t-err").hidden = true;
  renderTripForm();
  $("trip-overlay").hidden = false; $("trip-form").scrollTop = 0;
}
function renderTripForm() {
  const occs = OCCS.filter((o) => o.id !== "maison");
  $("t-occ").innerHTML = occs.map((o) => '<button type="button" class="chip" data-o="' + o.id + '" aria-pressed="' + (tripDraft.occ === o.id) + '">' + o.label + "</button>").join("");
  $("t-extra").innerHTML = occs.filter((o) => o.id !== tripDraft.occ).map((o) => '<button type="button" class="chip" data-x="' + o.id + '" aria-pressed="' + tripDraft.extra.includes(o.id) + '">' + o.label + "</button>").join("");
  const season = seasonOf($("t-start").value || dayStr(0));
  const defClimate = season === "hiver" ? "froid" : season === "ete" ? "chaud" : season === "printemps" ? "doux" : "frais";
  const cl = tripDraft.climate || defClimate;
  $("t-climate").innerHTML = MANUAL_TEMPS.filter((t) => !t.toggle).map((t) => '<button type="button" class="chip" data-cl="' + t.id + '" aria-pressed="' + (cl === t.id) + '">' + t.label + "<small>" + t.range + "</small></button>").join("");
}

async function computePlan(trip) {
  let forecast = {};
  try { forecast = await fetchRange(trip.dest.lat, trip.dest.lon); } catch (e) { forecast = {}; }
  const climate = MANUAL_TEMPS.find((t) => t.id === trip.climate) || MANUAL_TEMPS[1];
  const days = [];
  const wx = {};
  for (let i = 0; i < trip.len; i++) {
    const day = addDays(trip.start, i);
    const f = forecast[day];
    const w = f ? { morning: f.morning.feels, afternoon: f.afternoon.feels, rain: f.rain, wind: f.wind, snow: f.snow }
      : { morning: climate.m, afternoon: climate.a, rain: false, wind: 0, snow: false };
    if (f) wx[day] = { m: Math.round(f.morning.feels), a: Math.round(f.afternoon.feels), rain: f.rain, snow: f.snow, sky: f.sky };
    days.push({ day, season: seasonOf(day), occ: trip.occ, w, label: "Jour " + (i + 1) });
  }
  const mid = days[Math.floor((days.length - 1) / 2)];
  for (const x of trip.extra) days.push({ ...mid, occ: x, label: "En plus" });
  const items = liveItems().map((i) => ({ ...i, dirty: false }));
  const res = planTrip({ items, feedback: data().feedback }, days, { mood: "", important: false, styles: prefs().styles || [] });
  return {
    outfits: res.outfits.map((o, i) => ({ day: o.day, label: days[i].label, occ: days[i].occ, ids: o.pieces.map((p) => p.id) })),
    packed: res.packed.map((p) => p.id),
    wx, at: Date.now()
  };
}

async function saveTrip(e) {
  e.preventDefault();
  const err = $("t-err");
  const start = $("t-start").value, len = Math.max(1, Math.min(21, parseInt($("t-len").value, 10) || 0));
  if (!tripDraft.dest) return showErr(err, "Cherche puis choisis la destination.");
  if (!start) return showErr(err, "Indique la date de départ.");
  err.hidden = true;
  const btn = $("btn-trip-save"); btn.disabled = true; btn.textContent = "Préparation…";
  const season = seasonOf(start);
  const trip = { dest: tripDraft.dest, start, len, occ: tripDraft.occ, extra: tripDraft.extra,
    climate: tripDraft.climate || (season === "hiver" ? "froid" : season === "ete" ? "chaud" : season === "printemps" ? "doux" : "frais"), checked: [] };
  trip.plan = await computePlan(trip);
  trip.t = Date.now();
  const id = uid();
  mutate((d) => { d.trips = d.trips || {}; d.trips[id] = trip; });
  btn.disabled = false; btn.textContent = "Préparer la valise";
  $("trip-overlay").hidden = true;
  openTrip(id);
}

function openTrip(id) {
  openTripId = id;
  renderTripView();
  $("tripview-overlay").hidden = false; $("tripview").scrollTop = 0;
}
function renderTripView() {
  if (!openTripId) return;
  const t = (data().trips || {})[openTripId];
  if (!t || t.deleted) { $("tripview-overlay").hidden = true; openTripId = null; return; }
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const packed = (t.plan.packed || []).map((id) => byId.get(id)).filter(Boolean);
  const order = CATS.map((c) => c.id);
  packed.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.name.localeCompare(b.name, "fr"));
  const checked = new Set(t.checked || []);
  const done = packed.filter((p) => checked.has(p.id)).length;
  const forecastDays = Object.keys(t.plan.wx || {}).length;
  $("tripview").innerHTML =
    '<div class="sheet-head"><div><span class="label">' + esc(fmtDay(t.start, { day: "numeric", month: "short" })) + " → " + esc(fmtDay(addDays(t.start, t.len - 1), { day: "numeric", month: "short" })) + " · " + t.len + " jour" + (t.len > 1 ? "s" : "") +
    '</span><h2>' + esc(t.dest.name) + '</h2></div><button class="x" type="button" data-tv="close" aria-label="Fermer">✕</button></div>' +
    '<p class="note">' + (forecastDays === t.len ? "Tenues calculées avec la météo prévue sur place." : forecastDays ? "Météo connue pour " + forecastDays + " jour" + (forecastDays > 1 ? "s" : "") + " ; climat « " + esc((MANUAL_TEMPS.find((x) => x.id === t.climate) || {}).label || "") + " » pour les autres. Recalcule à l'approche du départ." : "Météo pas encore connue : tenues prévues pour un climat « " + esc((MANUAL_TEMPS.find((x) => x.id === t.climate) || {}).label || "") + " ». Recalcule dans les 15 jours avant le départ.") + "</p>" +
    '<div class="outfit-head"><h2>Dans la valise</h2><span class="progress">' + done + " / " + packed.length + " prêtes</span></div>" +
    (packed.length ? '<div class="checklist">' + packed.map((p) => '<button type="button" class="check" data-check="' + esc(p.id) + '" aria-pressed="' + checked.has(p.id) + '">' + thumb(p) +
      '<span class="group" style="gap:0"><span class="piece-name">' + esc(p.name) + '</span><span class="piece-meta">' + esc(catLabel(p)) + '</span></span><span class="box">✓</span></button>').join("") + "</div>"
      : '<p class="empty">Pas assez de vêtements pour composer des tenues. Ajoute des pièces puis recalcule.</p>') +
    '<div class="outfit-head"><h2>Jour par jour</h2></div>' +
    t.plan.outfits.map((o) => {
      const w = (t.plan.wx || {})[o.day];
      const wtxt = w ? " · " + w.m + "° → " + w.a + "°" + (w.snow ? " · neige" : w.rain ? " · pluie" : "") : "";
      return '<div class="trip-day"><span class="label">' + esc(o.label) + " · " + esc(fmtDay(o.day, { weekday: "short", day: "numeric", month: "short" })) + esc(wtxt) + " · " + esc((OCCS.find((x) => x.id === o.occ) || {}).label || "") +
        '</span><div class="h-thumbs">' + o.ids.map((id) => byId.get(id)).filter(Boolean).map((i) => thumb(i, "", "", ' title="' + esc(i.name) + '"')).join("") + "</div></div>";
    }).join("") +
    '<div class="actions" style="margin-top:6px"><button class="btn danger" type="button" data-tv="delete">Supprimer la valise</button><button class="btn" type="button" data-tv="recalc">Recalculer</button></div>';
  hydratePhotos($("tripview"));
}
async function tripAction(act, b) {
  const id = openTripId; const t = (data().trips || {})[id]; if (!t) return;
  if (act === "close") { $("tripview-overlay").hidden = true; openTripId = null; return; }
  if (act === "delete") {
    if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Confirmer la suppression"; return; }
    mutate((d) => { d.trips[id] = { deleted: true, t: Date.now() }; });
    $("tripview-overlay").hidden = true; openTripId = null; toast("Valise supprimée."); return;
  }
  if (act === "recalc") {
    b.disabled = true; b.textContent = "Calcul…";
    const plan = await computePlan(t);
    mutate((d) => { d.trips[id] = { ...d.trips[id], plan, checked: (d.trips[id].checked || []).filter((x) => plan.packed.includes(x)), t: Date.now() }; });
    toast("Valise recalculée."); return;
  }
}
function toggleCheck(itemId) {
  const id = openTripId;
  mutate((d) => {
    const t = d.trips[id]; const c = new Set(t.checked || []);
    c.has(itemId) ? c.delete(itemId) : c.add(itemId);
    d.trips[id] = { ...t, checked: [...c], t: Date.now() };
  });
}


// ---------------- MARQUES ----------------
function brandsList() {
  const m = new Map();
  for (const i of liveItems()) if (i.brand) { const k = i.brand.trim(); const key = normTxt(k); const e = m.get(key) || [k, 0]; e[1]++; m.set(key, e); }
  return [...m.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"));
}
// ---------------- PROGRESSION ET PIÈCES QUI MANQUENT ----------------
function renderProgress(all) {
  const pr = $("progress"), gp = $("gaps");
  if (isDemo()) { pr.hidden = true; gp.hidden = true; return; }
  const n = all.filter((i) => i.cat !== "accessoire").length;
  const next = MILESTONES.find((m) => m.n > n);
  const prev = [...MILESTONES].reverse().find((m) => m.n <= n);
  const missingCats = [["haut", "un haut"], ["bas", "un bas"], ["chaussures", "des chaussures"], ["veste", "une veste ou un manteau"]].filter(([c]) => !all.some((i) => i.cat === c || (c === "veste" && i.cat === "manteau"))).map(([, l]) => l);
  if (next) {
    const from = prev ? prev.n : 0;
    const pct = Math.round(((n - from) / (next.n - from)) * 100);
    pr.innerHTML = '<div class="outfit-head"><span class="label">Ton dressing</span><span class="progress">' + n + " / " + next.n + " pièces</span></div>" +
      '<div class="bar"><span style="width:' + Math.max(4, pct) + '%"></span></div>' +
      '<p class="note">' + (prev ? "Palier " + prev.n + " atteint : " + esc(prev.msg) + ". " : "") + "Encore " + (next.n - n) + " pièce" + (next.n - n > 1 ? "s" : "") + " avant " + next.n + " : " + esc(next.msg) + "." +
      (missingCats.length ? " Il manque encore " + missingCats.join(", ") + "." : "") + "</p>";
  } else {
    pr.innerHTML = '<div class="outfit-head"><span class="label">Ton dressing</span><span class="progress">' + n + " pièces</span></div><div class=\"bar\"><span style=\"width:100%\"></span></div><p class=\"note\">Dressing complet. Pense au filtre « À trier » de temps en temps.</p>";
  }
  pr.hidden = false;
  if (n < 4) { gp.hidden = true; return; }
  const { total, gaps } = suggestGaps(all, 3, [seasonOf(dayStr(0)), seasonOf(addDays(dayStr(0), 45))]);
  gp.innerHTML = '<div class="outfit-head"><span class="label">Pour plus de tenues</span><span class="progress">' + (total >= 2000 ? "2000+" : total) + " tenue" + (total > 1 ? "s" : "") + " possibles</span></div>" +
    (gaps.length ? '<ul class="gap-list">' + gaps.map((g) => '<li><span>Ajoute <strong>' + esc(g.label) + "</strong></span><span class=\"gain\">+" + g.gain + (g.cat === "veste" || g.cat === "manteau" ? " tenues couvertes" : " tenues") + "</span></li>").join("") + "</ul>" +
      '<p class="note small">D\'après ce que tu as déjà : couleurs, saisons et occasions qui vont ensemble. Utile avant les soldes.</p>'
      : '<p class="note">Ton dressing est bien équilibré : aucune pièce de base n\'ajouterait beaucoup de tenues.</p>');
  gp.hidden = false;
}

// ---------------- MIGRATION : la catégorie « Manteau » ----------------
// une seule fois par dressing : les vestes dont le nom dit manteau, trench, parka, doudoune… passent en Manteau
function migrateCoats() {
  if (!sync || !sync.loaded) return;
  const flag = "dressing:migr-manteau:" + sync.profile.id;
  if ((doc && doc.migr && doc.migr.manteau) || LS.get(flag, false)) return;
  LS.set(flag, true);
  const ids = (sync.doc.items || []).filter((i) => !i.deleted && i.cat === "veste" && guess(i.name).cat === "manteau").map((i) => i.id);
  sync.change((d) => {
    d.migr = { ...(d.migr || {}), manteau: 1 };
    for (const it of d.items) if (ids.includes(it.id)) { it.cat = "manteau"; it.updatedAt = Date.now(); }
  });
  if (ids.length) toast(ids.length + (ids.length > 1 ? " pièces rangées" : " pièce rangée") + " dans la nouvelle catégorie Manteau.");
}

// ---------------- DÉTOURAGE ----------------
const cutMode = () => { try { return localStorage.getItem("dressing:cut") === "simple" ? "simple" : "precis"; } catch (e) { return "precis"; } };
let cutStatusEl = null; // où afficher la progression du premier téléchargement du modèle
onCutProgress((pct) => { if (cutStatusEl && pct < 100) cutStatusEl.textContent = "Téléchargement du modèle de détourage, une seule fois (" + Math.round(pct * 0.44) + "\u00a0Mo sur 44) : " + pct + "\u00a0%"; });
function renderCutChips() {
  const m = cutMode();
  $("cut-chips").innerHTML = [["precis", "Précis (IA sur le téléphone)"], ["simple", "Simple (fond uni)"]].map(([k, l]) => '<button type="button" class="chip" data-cut="' + k + '" aria-pressed="' + (m === k) + '">' + l + "</button>").join("");
}
let recutting = false;
// suivi persistant : si le navigateur recharge la page en plein détourage (manque de mémoire),
// on le voit au lancement suivant et on reprend là où on en était
const RECUT = "dressing:recut", CUTRUN = "dressing:cut-running";
const recutState = () => LS.get(RECUT, null);
function noteCutStart() { const r = LS.get(CUTRUN, { n: 0 }); LS.set(CUTRUN, { n: r.n, on: true, at: Date.now() }); }
function noteCutEnd() { LS.set(CUTRUN, { n: 0, on: false }); }
/** Au lancement : un détourage était en cours → la page a planté. Deux fois de suite → mode simple. */
function checkCutCrash() {
  const r = LS.get(CUTRUN, null);
  if (!r || !r.on) return;
  const n = (r.n || 0) + 1;
  LS.set(CUTRUN, { n, on: false });
  if (n >= 2 && cutMode() === "precis") {
    try { localStorage.setItem("dressing:cut", "simple"); } catch (e) {}
    cutCrashNote = "Le téléphone a manqué de mémoire deux fois pendant le détourage précis : l'appli repasse en détourage simple. Tu peux réessayer « Précis » après avoir fermé des onglets ou d'autres applis.";
  } else cutCrashNote = "Le détourage s'est interrompu : le téléphone a sûrement manqué de mémoire. Ferme d'autres onglets ou applis, puis relance : ça reprend là où ça s'était arrêté.";
}
let cutCrashNote = "";
async function recutAll() {
  if (isDemo()) { toast("Ajoute d'abord ton profil."); return; }
  if (recutting) return;
  const prev = recutState();
  const doneIds = new Set(prev && prev.profile === sync.profile.id ? prev.done : []);
  const all = liveItems().filter((i) => i.photo);
  const list = all.filter((i) => !doneIds.has(i.id));
  if (!list.length) { LS.set(RECUT, null); toast("Toutes les photos sont déjà détourées."); renderRecut(); return; }
  recutting = true; cutCrashNote = ""; const st = $("recut-status"); st.hidden = false; $("btn-recut").disabled = true;
  LS.set(RECUT, { profile: sync.profile.id, done: [...doneIds], total: all.length });
  // garde l'écran allumé pendant le travail
  let lock = null; try { lock = await navigator.wakeLock.request("screen"); } catch (e) {}
  cutStatusEl = st; let better = 0;
  for (const it of list) {
    if (!recutting) break;
    st.textContent = "Détourage " + (doneIds.size + 1) + " sur " + all.length + " : " + it.name + "… Laisse l'appli ouverte.";
    try {
      const blob = await sync.photoUrl(it.photo).then((u) => fetch(u)).then((r) => r.blob());
      noteCutStart();
      const r = await removeBackground(blob);
      noteCutEnd();
      if (r.ok && r.blob) {
        const cut = await sync.uploadPhoto(r.blob, it.id, "-cut");
        const old = it.cut;
        sync.change((d) => { const x = d.items.find((i) => i.id === it.id); if (x) { x.cut = cut; x.updatedAt = Date.now(); } });
        if (old && old !== cut) sync.deletePhoto(old);
        better++;
      }
    } catch (e) { noteCutEnd(); }
    doneIds.add(it.id);
    LS.set(RECUT, { profile: sync.profile.id, done: [...doneIds], total: all.length });
  }
  try { if (lock) lock.release(); } catch (e) {}
  LS.set(RECUT, null);
  cutStatusEl = null; recutting = false; $("btn-recut").disabled = false; renderRecut();
  st.hidden = false;
  st.textContent = better + " photo" + (better > 1 ? "s" : "") + " détourée" + (better > 1 ? "s" : "") + " sur " + list.length + ". Si une pièce te plaît moins détourée, ouvre sa fiche et choisis « Photo entière ».";
}
async function cutTracked(blob) { noteCutStart(); try { return await removeBackground(blob); } finally { noteCutEnd(); } }
function renderRecut() {
  if (recutting) return;
  const r = recutState();
  const left = r && sync && r.profile === sync.profile.id ? r.total - r.done.length : 0;
  $("btn-recut").textContent = left > 0 ? "Reprendre le détourage (" + left + " restante" + (left > 1 ? "s" : "") + ")" : "Refaire le détourage de toutes les photos";
  const st = $("recut-status");
  if (cutCrashNote) { st.hidden = false; st.textContent = cutCrashNote; }
}

// ---------------- LOOKS QUE J'AIME ----------------
const liveLooks = () => Object.entries(data().looks || {}).filter(([, l]) => l && !l.deleted && l.photo).map(([id, l]) => ({ id, ...l })).sort((a, b) => (b.t || 0) - (a.t || 0));
function renderLooks() {
  const list = liveLooks();
  $("looks-count").textContent = list.length ? String(list.length) : "";
  $("looks").innerHTML = list.map((l) =>
    '<div class="look"><div class="look-img" data-photo="' + esc(l.photo) + '"></div><div class="look-body">' +
    (l.desc ? '<span class="look-desc">' + esc(l.desc) + "</span>" : aiKey() ? '<span class="look-desc">Description en attente…</span>' : "") +
    '<input type="text" maxlength="120" placeholder="Ce qui te plaît" data-look-note="' + esc(l.id) + '" value="' + esc(l.note || "") + '">' +
    '<button type="button" class="link" data-look-del="' + esc(l.id) + '">Retirer</button></div></div>').join("");
  hydratePhotos($("looks"));
}
async function addLooks(files) {
  if (isDemo()) { toast("Ajoute d'abord ton profil : les looks sont rangés dans ton dépôt privé."); return; }
  const st = $("look-status"); const key = aiKey();
  let n = 0;
  for (const f of files) {
    n++; st.hidden = false; st.textContent = "Ajout du look " + n + " sur " + files.length + "…";
    try {
      const blob = await resizeFile(f, 1100);
      const id = uid();
      const photo = await sync.uploadPhoto(blob, id, "", "photos/looks/");
      sync.change((d) => { d.looks = d.looks || {}; d.looks[id] = { photo, desc: "", note: "", t: Date.now() }; });
      if (key) describeLook(key, blob).then((desc) => { if (desc) sync.change((d) => { if (d.looks && d.looks[id]) { d.looks[id].desc = desc; d.looks[id].t = Date.now(); } }); }).catch(() => {});
    } catch (e) { toast("Un look n'a pas pu être ajouté. Vérifie la connexion."); }
  }
  st.textContent = files.length > 1 ? files.length + " looks ajoutés." : "Look ajouté.";
  setTimeout(() => (st.hidden = true), 2500);
}

// ---------------- POURQUOI CE REFUS ----------------
const WHY = { couleurs: "Trop de couleurs", accord: "Couleurs qui ne vont pas ensemble", meteo: "Pas adaptée à la météo", occasion: "Pas pour l'occasion", style: "Pas mon style", confort: "Pas confortable", piece: "Une pièce me déplaît" };
let whyFor = null;
function askWhy(key, pieces) {
  whyFor = { key, pieces };
  $("why-q").textContent = "Noté. Qu'est-ce qui n'allait pas ? (la styliste s'en souviendra)";
  $("why-chips").innerHTML = Object.entries(WHY).map(([k, l]) => '<button type="button" class="chip" data-why="' + k + '">' + esc(l) + "</button>").join("") +
    '<button type="button" class="chip skip" data-why="skip">Passer</button>';
  $("why-box").hidden = false;
}
function whyPieces() {
  $("why-q").textContent = "Laquelle ?";
  $("why-chips").innerHTML = whyFor.pieces.map((p) => '<button type="button" class="chip" data-piece="' + esc(p.id) + '">' + esc(p.name) + "</button>").join("") +
    '<button type="button" class="chip skip" data-why="skip">Passer</button>';
}
function setWhy(key, extra) {
  const apply = (d) => { d.feedback = d.feedback || {}; d.feedback[key] = { ...(d.feedback[key] || { v: -1 }), ...extra, t: Date.now() }; };
  if (isDemo()) apply(demoDoc); else sync.change(apply);
  $("why-box").hidden = true;
  toast(extra.piece ? "Compris : cette pièce passera après les autres." : "Compris, c'est retenu.");
}

// ---------------- MES TENUES ----------------
const liveOutfits = () => Object.entries(data().outfits || {}).filter(([, o]) => o && !o.deleted && o.ids && o.ids.length).map(([id, o]) => ({ id, ...o })).sort((a, b) => (b.t || 0) - (a.t || 0));
const SOURCE = { moi: "Composée", aime: "Aimée", avec: "Que porter avec", styliste: "Styliste" };

function keepOutfit(pieces, source, name) {
  const ids = pieces.map((p) => p.id);
  const k = comboKey(pieces);
  const exists = liveOutfits().find((o) => comboKey(o.ids.map((id) => ({ id }))) === k);
  if (exists) return exists.id;
  const id = uid();
  let auto = name || (pieces.find((p) => p.cat === "haut" || p.cat === "robe") || pieces[0]).name + " & " + ((pieces.find((p) => p.cat === "bas") || pieces[pieces.length - 1]).name);
  if (liveOutfits().some((o) => o.name === auto)) { const sh = pieces.find((p) => p.cat === "chaussures"); auto += sh ? " · " + sh.name : " (" + (liveOutfits().length + 1) + ")"; }
  mutate((d) => { d.outfits = d.outfits || {}; d.outfits[id] = { name: auto, ids, source, t: Date.now() }; });
  return id;
}

function renderOutfits() {
  const grid = $("outfits-grid");
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const list = liveOutfits();
  grid.innerHTML = list.length ? list.map((o) => {
    const pieces = o.ids.map((id) => byId.get(id)).filter(Boolean);
    return '<button type="button" class="outfit-card" data-saved="' + esc(o.id) + '">' + flatlay(pieces, true) +
      '<span class="piece-name">' + esc(o.name) + '</span><span class="piece-meta">' + esc(SOURCE[o.source] || "") + (pieces.length < o.ids.length ? " · pièce supprimée" : "") + "</span></button>";
  }).join("") : '<p class="empty">Aucune tenue gardée pour l\'instant. Compose-en une, appuie sur « J\'aime » sous la tenue du jour, ou garde une idée depuis « Que porter avec… ? ».</p>';
  hydratePhotos(grid);
}

function wearPieces(pieces, reason) {
  showTab("today");
  const c = context();
  current = { key: comboKey(pieces.filter((p) => p.cat !== "accessoire")), pieces, reasons: [reason] };
  seen = [current.key]; lastCtxKey = ctxKey(c); wornKey = null;
  renderOutfit(); savePick(c);
  toast(dayOffset === 0 ? "C'est ta tenue du jour." : "C'est ta tenue de demain.");
}

function openSaved(id) {
  const o = (data().outfits || {})[id]; if (!o) return;
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const pieces = o.ids.map((x) => byId.get(x)).filter(Boolean);
  const dirty = pieces.filter((p) => p.dirty);
  $("saved-sheet").innerHTML = '<div class="sheet-head"><h2>' + esc(o.name) + '</h2><button class="x" type="button" data-sv="close" aria-label="Fermer">✕</button></div>' +
    flatlay(pieces) +
    '<ul class="fl-list">' + pieces.map((p) => '<li><span class="tag">' + esc(catLabel(p)) + '</span><span class="piece-name">' + esc(p.name) + '</span><span class="piece-meta">' + (p.dirty ? "au sale" : wornText(p)) + "</span></li>").join("") + "</ul>" +
    (dirty.length ? '<p class="note">' + esc(dirty.map((p) => p.name).join(", ")) + (dirty.length > 1 ? " sont" : " est") + " au sale.</p>" : "") +
    '<button class="btn primary block" type="button" data-sv="wear">La porter ' + (dayOffset === 0 ? "aujourd'hui" : "demain") + "</button>" +
    '<div class="actions"><button class="btn danger" type="button" data-sv="delete">Supprimer</button><button class="btn" type="button" data-sv="edit">Modifier</button></div>';
  $("saved-sheet").dataset.id = id;
  hydratePhotos($("saved-sheet"));
  $("saved-overlay").hidden = false; $("saved-sheet").scrollTop = 0;
}
function savedAction(act, b) {
  const id = $("saved-sheet").dataset.id; const o = (data().outfits || {})[id];
  if (act === "close" || !o) { $("saved-overlay").hidden = true; return; }
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const pieces = o.ids.map((x) => byId.get(x)).filter(Boolean);
  if (act === "wear") { $("saved-overlay").hidden = true; wearPieces(pieces, "Une de tes tenues : « " + o.name + " »."); return; }
  if (act === "edit") { $("saved-overlay").hidden = true; openCompose(id); return; }
  if (act === "delete") {
    if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Confirmer"; return; }
    mutate((d) => { d.outfits[id] = { deleted: true, t: Date.now() }; });
    $("saved-overlay").hidden = true; toast("Tenue supprimée.");
  }
}

// composer
let compose = null;
const SINGLE = { bas: 1, robe: 1, veste: 1, manteau: 1, chaussures: 1, haut: 2, accessoire: 4 };
function openCompose(id) {
  if (isDemo()) { openProfile(null); return; }
  const o = id ? (data().outfits || {})[id] : null;
  const valid = new Set(liveItems().map((i) => i.id));
  compose = { id: id || null, ids: o ? o.ids.filter((x) => valid.has(x)) : [], cat: "haut" };
  $("compose-title").textContent = id ? "Modifier la tenue" : "Nouvelle tenue";
  $("c-name").value = o ? o.name : "";
  $("btn-c-del").hidden = !id; $("btn-c-del").dataset.confirm = ""; $("btn-c-del").textContent = "Supprimer";
  $("c-err").hidden = true;
  renderCompose();
  $("compose-overlay").hidden = false; $("compose-form").scrollTop = 0;
}
function renderCompose() {
  const items = liveItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const sel = compose.ids.map((x) => byId.get(x)).filter(Boolean);
  $("c-preview").innerHTML = sel.length ? flatlay(sel) : '<div class="flatlay empty-lay"><span>Touche des pièces ci-dessous</span></div>';
  const groups = CATS.map((c) => {
    const its = items.filter((i) => i.cat === c.id);
    if (!its.length) return "";
    return '<div class="group"><span class="label">' + c.label + '</span><div class="pick-row">' + its.map((i) =>
      '<button type="button" class="pick' + (compose.ids.includes(i.id) ? " on" : "") + '" data-pk="' + esc(i.id) + '" aria-pressed="' + compose.ids.includes(i.id) + '">' + thumb(i) + '<span class="piece-meta">' + esc(i.name) + "</span></button>").join("") + "</div></div>";
  }).join("");
  $("c-picker").innerHTML = groups || '<p class="empty">Ajoute d\'abord des vêtements à ton dressing.</p>';
  hydratePhotos($("compose-overlay"));
}
function togglePick(id) {
  const it = liveItems().find((i) => i.id === id); if (!it) return;
  if (compose.ids.includes(id)) compose.ids = compose.ids.filter((x) => x !== id);
  else {
    const byId = new Map(liveItems().map((i) => [i.id, i]));
    const sameCat = compose.ids.filter((x) => (byId.get(x) || {}).cat === it.cat);
    if (sameCat.length >= (SINGLE[it.cat] || 1)) compose.ids = compose.ids.filter((x) => x !== sameCat[0]);
    // une robe remplace haut + bas, et inversement
    if (it.cat === "robe") compose.ids = compose.ids.filter((x) => !["haut", "bas"].includes((byId.get(x) || {}).cat));
    if (it.cat === "bas") compose.ids = compose.ids.filter((x) => (byId.get(x) || {}).cat !== "robe");
    compose.ids.push(id);
  }
  renderCompose();
}
function saveCompose(e) {
  e.preventDefault();
  const err = $("c-err");
  const byId = new Map(liveItems().map((i) => [i.id, i]));
  const sel = compose.ids.map((x) => byId.get(x)).filter(Boolean);
  if (sel.length < 2) return showErr(err, "Choisis au moins deux pièces.");
  const name = $("c-name").value.trim() || (sel.find((p) => p.cat === "haut" || p.cat === "robe") || sel[0]).name + " & " + (sel.find((p) => p.cat === "bas") || sel[sel.length - 1]).name;
  const id = compose.id || uid();
  mutate((d) => { d.outfits = d.outfits || {}; d.outfits[id] = { ...(d.outfits[id] || {}), name, ids: compose.ids.slice(), source: (d.outfits[id] && d.outfits[id].source) || "moi", t: Date.now() }; });
  $("compose-overlay").hidden = true;
  showWardrobeTab("outfits");
  toast("Tenue « " + name + " » enregistrée.");
}

function showWardrobeTab(which) {
  for (const k of ["pieces", "outfits", "wishes"]) { $("wd-" + k).hidden = which !== k; $("wd-tab-" + k).setAttribute("aria-pressed", which === k); }
  if (which === "wishes") renderWishes();
}

// ---------------- LISTE D'ENVIES ----------------
function renderWishes() {
  const list = wishItems();
  const own = liveItems().filter((i) => !i.stored && !i.repair);
  const base = countOutfits(own);
  $("wishes").innerHTML = list.length ? list.map((w) => {
    const gain = w.cat === "accessoire" ? null : countOutfits(own.concat(w)) - base;
    const twins = own.filter((i) => i.cat === w.cat && i.color === w.color && (i.pattern || "uni") === (w.pattern || "uni") && (i.cat !== "accessoire" || (i.acc || "sac") === (w.acc || "sac")));
    const verdict = w.cat === "veste" || w.cat === "manteau" ? "Une couche extérieure : elle ne crée pas de tenue, elle les couvre."
      : gain === null ? "Un accessoire : regarde les tenues pour juger."
      : gain > 0 ? "+" + gain + " tenue" + (gain > 1 ? "s" : "") + " possible" + (gain > 1 ? "s" : "") + " avec ton dressing."
      : "Elle n'ajoute aucune tenue : rien dans ton dressing ne va vraiment avec.";
    return '<article class="wish">' + thumb(w) + '<div class="wish-body"><strong>' + esc(w.name) + "</strong>" +
      '<span class="piece-meta">' + esc([w.brand, w.shop && normTxt(w.shop) !== normTxt(w.brand) ? w.shop : null, w.price != null ? fmtPrice(w.price) : null].filter(Boolean).join(" · ")) + "</span>" +
      '<p class="wish-verdict' + (gain === 0 ? " is-bad" : "") + '">' + esc(verdict) + "</p>" +
      (twins.length ? '<p class="wish-twin">Doublon possible : ' + esc(twins.slice(0, 2).map((t) => t.name).join(", ")) + ".</p>" : "") +
      '<div class="actions"><button type="button" class="btn small-btn" data-wa2="looks" data-id="' + esc(w.id) + '">Voir des tenues</button><button type="button" class="btn small-btn" data-wa2="edit" data-id="' + esc(w.id) + '">Modifier</button><button type="button" class="btn primary small-btn" data-wa2="bought" data-id="' + esc(w.id) + '">Je l\'ai acheté</button></div></div></article>';
  }).join("") : '<p class="empty">Ajoute ici les vêtements que tu hésites à acheter : l\'appli te dit combien de tenues ils créent avec ce que tu as déjà, et s\'ils font doublon.</p>';
  hydratePhotos($("wishes"));
}

// ---------------- AJOUT DEPUIS UNE CAPTURE DE BOUTIQUE ----------------
let shopAsWish = false;
async function importShop(file) {
  if (isDemo()) { openProfile(null); return; }
  const key = aiKey();
  if (!key) { showTab("settings"); setTimeout(() => $("ai-key").focus(), 50); toast("Il faut la clé de la styliste pour lire une capture."); return; }
  const asWish = shopAsWish;
  toast("La styliste lit la capture…");
  let blob, rec;
  try { blob = await resizeFile(file, 1600); rec = await readShopScreenshot(key, blob); }
  catch (e) { toast(aiErrText(e)); return; }
  let photo = blob;
  if (rec.box) { try { const bmp = await createImageBitmap(blob); photo = await cropBox(bmp, rec.box); } catch (e) {} }
  const name = rec.name || "Vêtement";
  const fields = itemFromRec(rec, name);
  openItem(null);
  Object.assign(draft, fields, { wish: asWish, price: rec.price, shop: rec.shop });
  for (const k of ["cat", "acc", "warmth", "material", "pattern", "rain", "styles", "occ", "seasons", "color"]) draft.touched.add(k);
  $("item-title").textContent = asWish ? "Nouvelle envie" : "Nouveau vêtement";
  renderItemSheet();
  $("f-name").value = name; $("f-brand").value = rec.brand || "";
  $("f-price").value = rec.price != null ? (rec.price % 1 ? rec.price.toFixed(2) : String(rec.price)).replace(".", ",") : ""; $("f-shop").value = rec.shop || "";
  setDraftPhoto(photo);
  $("photo-status").textContent = "Lu depuis la capture" + (rec.shop ? " (" + rec.shop + ")" : "") + ". Vérifie, puis enregistre.";
}

// ---------------- QUE PORTER AVEC ----------------
let withResults = [];
function openWith(item) {
  let c = context();
  const occNote = (item.occ || []).includes(c.occ) ? "" : (item.occ || [])[0];
  if (occNote) c = { ...c, occ: occNote };
  withResults = suggestMany({ items: item.wish ? liveItems().concat(item) : liveItems(), feedback: data().feedback }, c, 4, { must: item });
  const occLabel = (OCCS.find((o) => o.id === c.occ) || {}).label || "";
  $("with-sheet").innerHTML = '<div class="sheet-head"><div><span class="label">Que porter avec</span><h2>' + esc(item.name) + '</h2></div><button class="x" type="button" data-wa="close" aria-label="Fermer">✕</button></div>' +
    '<p class="note">' + (weather[dayOffset] ? "Pour la météo " + (dayOffset === 0 ? "d'aujourd'hui" : "de demain") : "Pour la saison") + " · " + esc(occLabel) + (item.dirty ? " · attention, cette pièce est au sale" : "") + "</p>" +
    (withResults.length ? '<div class="with-grid">' + withResults.map((r, i) =>
      '<div class="with-item">' + flatlay(r.pieces, true) + '<span class="piece-meta">' + esc(r.pieces.filter((p) => p.id !== item.id && p.cat !== "accessoire").map((p) => p.name).join(" · ")) + "</span>" +
      (item.wish ? "" : '<div class="actions"><button class="btn small-btn" type="button" data-wa="keep" data-i="' + i + '">Garder</button><button class="btn primary small-btn" type="button" data-wa="wear" data-i="' + i + '">La porter</button></div>') + "</div>").join("") + "</div>"
      : '<p class="empty">Pas assez de pièces qui vont avec pour l\'instant. Ajoute des hauts, des bas ou des chaussures.</p>');
  hydratePhotos($("with-sheet"));
  $("with-overlay").hidden = false; $("with-sheet").scrollTop = 0;
}
function withAction(act, b) {
  if (act === "close") { $("with-overlay").hidden = true; return; }
  const r = withResults[+b.dataset.i]; if (!r) return;
  if (act === "wear") { $("with-overlay").hidden = true; wearPieces(r.pieces, "Choisie depuis « Que porter avec… ? »."); return; }
  if (act === "keep") { keepOutfit(r.pieces, "avec"); b.textContent = "✓ Gardée"; b.disabled = true; }
}


// ---------------- AJOUT DE PLUSIEURS VÊTEMENTS ----------------
let batch = null; // {mode, entries: [], busy, saving}
const bEsc = esc;

function openBatch() {
  if (isDemo()) { openProfile(null); return; }
  batch = { entries: [], status: "", saving: false, queue: [], running: 0 };
  renderBatch();
  $("batch-overlay").hidden = false; $("batch-sheet").scrollTop = 0;
}
function closeBatch() {
  if (batch) for (const e of batch.entries) { if (e.url) URL.revokeObjectURL(e.url); }
  batch = null; $("batch-overlay").hidden = true;
  renderWardrobe();
}

function renderBatch() {
  const el = $("batch-sheet"); if (!batch) return;
  // on ne perd pas la saisie en cours quand la liste se met à jour
  const ae = document.activeElement;
  const focusIdx = ae && ae.classList && ae.classList.contains("batch-name") ? ae.dataset.bn : null;
  const selStart = focusIdx !== null ? ae.selectionStart : 0;
  const scroll = el.scrollTop;
  renderBatchInner(el);
  el.scrollTop = scroll;
  if (focusIdx !== null) { const inp = el.querySelector('[data-bn="' + focusIdx + '"]'); if (inp) { inp.focus(); try { inp.setSelectionRange(selStart, selStart); } catch (e) {} } }
}
function renderBatchInner(el) {
  const head = '<div class="sheet-head"><h2>Ajouter plusieurs vêtements</h2><button class="x" type="button" data-bt="close" aria-label="Fermer">✕</button></div>';
  if (!aiKey()) {
    el.innerHTML = head + '<p class="note">Cette fonction utilise la styliste pour reconnaître les vêtements. Ajoute ta clé API dans Réglages → Styliste IA, puis reviens ici.</p><button class="btn primary block" type="button" data-bt="settings">Aller aux réglages</button>';
    return;
  }
  if (batch.chooser || (!batch.entries.length && !batch.status)) {
    el.innerHTML = head +
      '<section class="batch-mode"><h3>Une photo, plusieurs vêtements</h3><p class="note">Une penderie, une pile ou des vêtements étalés sur le lit : la styliste liste tout ce qu\'elle voit et découpe chaque pièce. Le plus rapide ; les photos sont moins belles qu\'une par une. Environ 2 centimes la photo.</p>' +
      '<div class="actions"><button class="btn primary" type="button" data-bt="group-cam"' + (cameraSupported() ? "" : " hidden") + '>Prendre la photo</button><button class="btn" type="button" data-bt="group-file">Choisir dans l\'album</button></div></section>' +
      '<section class="batch-mode"><h3>Une photo par vêtement, à la suite</h3><p class="note">Photographie les pièces l\'une après l\'autre sans rien remplir, ou choisis-en plusieurs dans l\'album : l\'appli détoure et reconnaît chaque pièce pendant ce temps. De belles photos ; environ 1 centime la pièce.</p>' +
      '<div class="actions"><button class="btn primary" type="button" data-bt="burst"' + (cameraSupported() ? "" : " hidden") + '>Photographier en rafale</button><button class="btn" type="button" data-bt="many-file">Choisir plusieurs photos</button></div></section>' +
      (batch.entries.length ? '<button class="btn block" type="button" data-bt="back">Revenir à la liste (' + batch.entries.length + ")</button>" : "");
    return;
  }
  const ok = batch.entries.filter((e) => e.status === "ok");
  const kept = ok.filter((e) => e.keep);
  const pending = batch.entries.filter((e) => e.status === "wait" || e.status === "busy").length;
  const lab = (list, id) => (list.find((x) => x.id === id) || {}).label || "";
  el.innerHTML = head +
    (batch.status ? '<p class="note batch-status">' + bEsc(batch.status) + "</p>" : "") +
    (pending ? '<p class="note batch-status">Analyse en cours : ' + (batch.entries.length - pending) + " / " + batch.entries.length + "…</p>" : "") +
    '<div class="batch-list">' + batch.entries.map((e, i) => {
      const r = e.rec || {};
      const meta = e.status === "ok" ? [e.cutBlob ? "détouré" : "", lab(CATS, r.cat), r.color ? (COLORS[r.color] || [""])[0].toLowerCase() : "", r.material ? lab(MATERIALS, r.material).toLowerCase() : "", r.brand || ""].filter(Boolean).join(" · ")
        : e.status === "err" ? e.err : "en attente…";
      return '<div class="batch-row' + (e.status === "ok" && !e.keep ? " off" : "") + '">' +
        '<div class="thumb' + (e.cutBlob ? " is-cut" : "") + '">' + (e.url ? '<img src="' + e.url + '" alt="">' : "") + "</div>" +
        '<div class="group" style="gap:4px;min-width:0">' +
        (e.status === "ok" ? '<input type="text" class="batch-name" data-bn="' + i + '" value="' + bEsc(e.name || "") + '" maxlength="60" aria-label="Nom">' : '<span class="piece-name">' + (e.status === "busy" ? "Reconnaissance…" : e.status === "err" ? "Non reconnu" : "En attente") + "</span>") +
        '<span class="piece-meta">' + bEsc(meta) + "</span></div>" +
        (e.status === "ok" ? '<button type="button" class="check-btn" data-bk="' + i + '" aria-pressed="' + e.keep + '" aria-label="Garder">' + (e.keep ? "✓" : "") + "</button>" : "<span></span>") +
        "</div>";
    }).join("") + "</div>" +
    (ok.length ? '<p class="note small">Décoche ce que tu ne veux pas, corrige les noms si besoin. Tout le reste se modifie ensuite dans la fiche de chaque pièce.</p>' : "") +
    '<div class="actions"><button class="btn" type="button" data-bt="more">Ajouter d\'autres photos</button>' +
    '<button class="btn primary" type="button" data-bt="save"' + (kept.length && !batch.saving ? "" : " disabled") + ">" + (batch.saving ? bEsc(batch.saving) : "Ajouter " + kept.length + " pièce" + (kept.length > 1 ? "s" : "")) + "</button></div>";
}

/** Découpe une zone (en fractions 0–1) d'une image. */
async function cropBox(bmp, box) {
  const W = bmp.width, H = bmp.height;
  const pw = (box[2] - box[0]) * 0.04, ph = (box[3] - box[1]) * 0.04;
  const x = Math.max(0, (box[0] - pw) * W), y = Math.max(0, (box[1] - ph) * H);
  const w = Math.min(W, (box[2] + pw) * W) - x, h = Math.min(H, (box[3] + ph) * H) - y;
  const r = Math.min(1, 800 / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(h * r));
  c.getContext("2d").drawImage(bmp, x, y, w, h, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.86));
}

async function runGroup(blob) {
  batch.chooser = false;
  batch.status = "La styliste cherche les vêtements sur la photo…"; renderBatch();
  try {
    const found = await detectMany(aiKey(), blob);
    if (!batch) return;
    if (!found.length) { batch.status = "Aucun vêtement reconnu sur cette photo. Essaie avec plus de lumière, ou des pièces moins serrées."; renderBatch(); return; }
    const bmp = window.createImageBitmap ? await createImageBitmap(blob) : null;
    for (const f of found) {
      const e = { status: "ok", keep: true, rec: f, name: f.name, blob: null, cutBlob: null, url: null };
      if (bmp && f.box) {
        e.blob = await cropBox(bmp, f.box);
        // détourage si la pièce est posée sur un fond uni (lit, sol) ; sinon on garde le cadrage
        try { const cr = await cutTracked(e.blob); if (cr.ok) e.cutBlob = cr.blob; } catch (x) {}
        e.url = URL.createObjectURL(e.cutBlob || e.blob);
      }
      batch.entries.push(e);
    }
    batch.status = found.length + " pièce" + (found.length > 1 ? "s" : "") + " trouvée" + (found.length > 1 ? "s" : "") + " sur la photo.";
  } catch (err) { if (batch) batch.status = aiErrText(err); }
  renderBatch();
}

function queueSingle(blob) {
  batch.chooser = false;
  const e = { status: "wait", keep: true, blob, cutBlob: null, url: URL.createObjectURL(blob), rec: null, name: "" };
  batch.entries.push(e); batch.queue.push(e);
  renderBatch(); pumpQueue();
}
function pumpQueue() {
  while (batch && batch.running < 2 && batch.queue.length) {
    const e = batch.queue.shift(); batch.running++;
    processSingle(e).finally(() => { if (!batch) return; batch.running--; renderBatch(); pumpQueue(); });
  }
}
async function processSingle(e) {
  const b = batch;
  e.status = "busy"; renderBatch();
  try { const cr = await cutTracked(e.blob); if (cr.ok) { e.cutBlob = cr.blob; URL.revokeObjectURL(e.url); e.url = URL.createObjectURL(cr.blob); } } catch (x) {}
  try {
    const rec = await recognizeItem(aiKey(), e.cutBlob || e.blob);
    if (!rec.color) { try { const col = await detectColor(e.cutBlob || e.blob, { cut: !!e.cutBlob }); if (col) rec.color = col.color; } catch (x) {} }
    e.rec = rec; e.name = rec.name || "Vêtement"; e.status = "ok";
  } catch (err) { e.status = "err"; e.err = aiErrText(err); }
  if (batch !== b) return;
}

/** Fiche complète à partir de la reconnaissance, avec les mêmes devinettes que la fiche d'ajout. */
function itemFromRec(rec, name) {
  const g = guess(name, { weekdayOcc: weekdayOcc() });
  const cat = rec.cat || g.cat || "haut";
  const acc = cat === "accessoire" ? rec.acc || g.acc || "sac" : null;
  const warmth = rec.warmth || g.warmth || 2;
  const material = rec.material || g.material || null;
  return {
    name, cat, acc, color: rec.color || "noir", pattern: rec.pattern || g.pattern || "uni", warmth, material,
    seasons: rec.seasons && rec.seasons.length ? rec.seasons : seasonsFor({ cat, acc, warmth, material }),
    occ: rec.occ && rec.occ.length ? rec.occ : g.occ, styles: rec.styles && rec.styles.length ? rec.styles : g.styles || [],
    rain: rec.rain || g.rain || "normal", brand: rec.brand || null, dirty: false
  };
}

async function saveBatch() {
  const list = batch.entries.filter((e) => e.status === "ok" && e.keep);
  if (!list.length) return;
  const items = [];
  try {
    for (let i = 0; i < list.length; i++) {
      batch.saving = "Ajout " + (i + 1) + " / " + list.length + "…"; renderBatch();
      const e = list[i], id = uid();
      const name = (e.name || "").trim() || e.rec.name || "Vêtement";
      let photo = null, cut = null;
      if (e.blob) photo = await sync.uploadPhoto(e.blob, id);
      if (e.cutBlob) cut = await sync.uploadPhoto(e.cutBlob, id, "-cut");
      items.push({ id, ...itemFromRec(e.rec, name), photo, cut, createdAt: Date.now(), updatedAt: Date.now() });
      e.added = true;
    }
  } catch (err) {
    batch.saving = false;
    batch.status = (err.status === 0 ? "Pas de connexion" : "L'envoi a été interrompu") + " : " + items.length + " pièce(s) ajoutée(s) sur " + list.length + ". Touche « Ajouter » pour réessayer les autres.";
    // celles qui sont parties sont enregistrées ci-dessous et retirées de la liste
    batch.entries = batch.entries.filter((e) => !e.added);
  }
  if (items.length) sync.change((d) => { d.items.push(...items); });
  if (batch.saving) { const n = items.length; closeBatch(); toast(n + " pièce" + (n > 1 ? "s" : "") + " ajoutée" + (n > 1 ? "s" : "") + " au dressing."); }
  else renderBatch();
}

async function batchAction(act) {
  if (["group-cam", "group-file", "many-file", "burst"].includes(act)) batch.chooser = false;
  if (act === "close") { if (batch && batch.saving) return; closeBatch(); return; }
  if (act === "settings") { closeBatch(); showTab("settings"); return; }
  if (act === "group-cam") {
    try { const b = await takePhoto({ full: true }); if (b) runGroup(b); } catch (e) { $("b-file-one").click(); }
    return;
  }
  if (act === "group-file") { $("b-file-one").click(); return; }
  if (act === "many-file") { $("b-file-many").click(); return; }
  if (act === "burst") {
    try { await takePhotos((b) => queueSingle(b)); } catch (e) { $("b-file-many").click(); }
    return;
  }
  if (act === "more") { batch.chooser = true; renderBatch(); return; }
  if (act === "back") { batch.chooser = false; renderBatch(); return; }
  if (act === "save") saveBatch();
}
// ---------------- RÉGLAGES ----------------
function renderSettings() {
  const profiles = getProfiles(), active = getActiveId();
  $("profiles").innerHTML = profiles.length ? profiles.map((p) =>
    '<div class="profile' + (p.id === active ? " active" : "") + '"><span class="avatar">' + esc((p.name || "?")[0].toUpperCase()) + '</span><div class="grow"><strong>' + esc(p.name) +
    '</strong><span class="repo">' + esc(p.owner + "/" + p.repo) + "</span></div>" +
    (p.id === active ? '<span class="tag">Actif</span>' : '<button type="button" class="btn" data-use="' + p.id + '">Ouvrir</button>') +
    '<button type="button" class="link" data-edit="' + p.id + '">Modifier</button></div>'
  ).join("") : '<p class="empty">Aucun profil sur cet appareil. Ajoute le tien avec le nom de ton dépôt privé et ton jeton.</p>';
  const chosen = prefs().styles || [];
  const styleChip = (st) => '<button type="button" class="chip" data-style="' + st.id + '" aria-pressed="' + chosen.includes(st.id) + '">' + esc(st.name) + "</button>";
  $("style-chips").innerHTML = STYLES.filter((x) => x.kind === "style").map(styleChip).join("");
  $("designer-chips").innerHTML = STYLES.filter((x) => x.kind === "createur").map(styleChip).join("");
  $("style-count").textContent = chosen.length + " / 3";
  $("style-desc").innerHTML = STYLES.filter((x) => chosen.includes(x.id)).map((x) => "<li><strong>" + esc(x.name) + "</strong> : " + esc(x.desc) + "</li>").join("");
  if (document.activeElement !== $("style-note")) $("style-note").value = prefs().note || "";
  renderCutChips(); renderRecut();
  if (!($("looks").contains(document.activeElement) && document.activeElement.tagName === "INPUT")) renderLooks();
  const k = aiKey();
  if (document.activeElement !== $("ai-key")) $("ai-key").value = k ? "••••••••" + k.slice(-4) : "";
  $("btn-ai-del").hidden = !k;
  $("btn-ai").textContent = aiBusy ? "La styliste réfléchit…" : "Demander à la styliste";
  $("loc-current").textContent = settings.loc ? "Lieu actuel : " + settings.loc.name : "Aucun lieu choisi.";
  $("wk-chips").innerHTML = OCCS.map((o) => '<button type="button" class="chip" data-wk="' + o.id + '" aria-pressed="' + (weekdayOcc() === o.id) + '">' + o.label + "</button>").join("");
  $("we-chips").innerHTML = OCCS.map((o) => '<button type="button" class="chip" data-we="' + o.id + '" aria-pressed="' + (weekendOcc() === o.id) + '">' + o.label + "</button>").join("");
  $("rest-chips").innerHTML = [1, 2, 3, 5, 7].map((n) => '<button type="button" class="chip" data-r="' + n + '" aria-pressed="' + (settings.restDays === n) + '">' + n + " jour" + (n > 1 ? "s" : "") + "</button>").join("");
  $("version").textContent = "Version " + VERSION;
}

function renderHeader() {
  const p = getProfiles().find((x) => x.id === getActiveId());
  $("profile-name").textContent = p ? p.name : "Exemple";
  $("profile-initial").textContent = p ? (p.name || "?")[0].toUpperCase() : "?";
  $("today-label").textContent = fmtDay(dayStr(0));
  $("demo-banner").hidden = !isDemo();
}

function renderAll() {
  renderHeader(); renderWeather(); renderControls(); refreshOutfit();
  renderWardrobe(); renderOutfits(); renderAgenda(); renderSettings();
}

// ---------------- synchro : affichage de l'état ----------------
function onStatus(state, msg) {
  const el = $("sync");
  el.classList.toggle("bad", state === "auth" || state === "notfound" || state === "error");
  const text = {
    ok: "", saving: "Enregistrement…",
    offline: "Hors connexion. Tes changements sont gardés sur ce téléphone et partiront dès que le réseau revient.",
    auth: "GitHub refuse le jeton. Il a peut-être expiré : crée-en un nouveau et mets-le dans Réglages.",
    notfound: "Dépôt introuvable avec ce jeton. Vérifie son nom dans Réglages et que le jeton y a accès.",
    error: "L'enregistrement sur GitHub n'a pas abouti" + (msg ? " (" + msg + ")" : "") + ". Nouvel essai à la prochaine modification."
  }[state];
  el.textContent = text || "";
  el.hidden = !text;
}

// ---------------- profils ----------------
function activate(id) {
  if (sync) sync.destroy();
  sync = null; doc = null;
  const p = getProfiles().find((x) => x.id === id);
  setActiveId(p ? p.id : null);
  current = null; seen = []; pickReady = !!(p && LS.get("dressing:data:" + p.id, null));
  if (p) {
    sync = new Sync(p, { onData: (d) => { doc = d; renderAfterData(); }, onStatus });
    doc = sync.doc;
    sync.sync();
  } else onStatus("ok");
  renderAll();
}
let dataTimer = null;
let pickReady = false;
function renderAfterData() {
  if (!pickReady && sync && sync.loaded) { pickReady = true; current = null; seen = []; }
  migrateCoats();
  clearTimeout(dataTimer);
  dataTimer = setTimeout(() => { refreshOutfit(); renderWardrobe(); renderOutfits(); renderAgenda(); renderControls(); renderSettings(); }, 30);
}

function openProfile(p) {
  editingProfile = p || null;
  $("profile-title").textContent = p ? "Modifier le profil" : "Nouveau profil";
  $("p-name").value = p ? p.name : "";
  $("p-repo").value = p ? p.owner + "/" + p.repo : "";
  $("p-token").value = p ? p.token : "";
  $("p-err").hidden = true; $("p-status").hidden = true;
  $("btn-p-del").hidden = !p; $("btn-p-del").dataset.confirm = ""; $("btn-p-del").textContent = "Retirer de cet appareil";
  $("profile-overlay").hidden = false;
  $("profile-form").scrollTop = 0;
}

async function saveProfile(e) {
  e.preventDefault();
  const err = $("p-err"), st = $("p-status");
  err.hidden = true;
  const name = $("p-name").value.trim();
  const parsed = parseRepo($("p-repo").value);
  const token = $("p-token").value.trim();
  if (!name) return showErr(err, "Indique un prénom pour reconnaître ce dressing.");
  if (!parsed) return showErr(err, "Le dépôt doit être de la forme propriétaire/nom, par exemple Leveilleur-bit/Dressing-donnees-R.");
  if (!token) return showErr(err, "Colle ton jeton d'accès GitHub.");
  const btn = $("btn-p-save"); btn.disabled = true;
  st.textContent = "Vérification auprès de GitHub…"; st.hidden = false;
  try {
    const info = await new Repo({ ...parsed, token }).check();
    if (!info.private) { st.hidden = true; btn.disabled = false; return showErr(err, "Ce dépôt est public : tes photos seraient visibles par tout le monde. Passe-le en privé dans ses réglages GitHub, puis réessaie."); }
    if (!info.canWrite) { st.hidden = true; btn.disabled = false; return showErr(err, "Ce jeton peut lire le dépôt mais pas y écrire. Donne-lui la permission « Contents : Read and write »."); }
  } catch (ex) {
    st.hidden = true; btn.disabled = false;
    if (ex.status === 401) return showErr(err, "GitHub ne reconnaît pas ce jeton. Vérifie qu'il est complet et qu'il n'a pas expiré.");
    if (ex.status === 404 || ex.status === 403) return showErr(err, "Dépôt introuvable avec ce jeton. Vérifie le nom du dépôt et que le jeton y a bien accès.");
    if (ex.status === 0) return showErr(err, "Pas de connexion. Réessaie quand tu as du réseau.");
    return showErr(err, "GitHub a répondu : " + ex.message);
  }
  const list = getProfiles();
  if (editingProfile && (editingProfile.owner !== parsed.owner || editingProfile.repo !== parsed.repo)) LS.del("dressing:data:" + editingProfile.id);
  const p = editingProfile ? { ...editingProfile, name, ...parsed, token } : { id: uid(), name, ...parsed, token };
  saveProfiles(editingProfile ? list.map((x) => (x.id === p.id ? p : x)) : list.concat(p));
  btn.disabled = false;
  $("profile-overlay").hidden = true;
  activate(p.id);
  toast("Dressing de " + name + " connecté.");
}
function showErr(el, msg) { el.textContent = msg; el.hidden = false; }

function removeProfile() {
  const b = $("btn-p-del");
  if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Confirmer : retirer d'ici"; return; }
  const p = editingProfile; if (!p) return;
  saveProfiles(getProfiles().filter((x) => x.id !== p.id));
  LS.del("dressing:data:" + p.id);
  $("profile-overlay").hidden = true;
  if (getActiveId() === p.id) { const rest = getProfiles(); activate(rest[0] ? rest[0].id : null); }
  else renderSettings();
  toast("Profil retiré de cet appareil. Ses données restent sur GitHub.");
}

// ---------------- météo ----------------
async function loadWeather(force) {
  if (!settings.loc) { renderWeather(); return; }
  const key = "dressing:wx:" + settings.loc.lat + "," + settings.loc.lon;
  const cached = LS.get(key, null);
  const fresh = cached && Date.now() - cached.at < 45 * 60e3 && cached.days[0] && cached.days[0].day === dayStr(0);
  if (fresh && !force) { weather = { 0: cached.days[0], 1: cached.days[1] }; weatherError = null; renderWeather(); renderControls(); refreshOutfit(); return; }
  if (!weather[0]) renderWeather();
  try {
    const [d0, d1] = await fetchTwoDays(settings.loc.lat, settings.loc.lon);
    weather = { 0: d0, 1: d1 }; weatherError = null;
    LS.set(key, { at: Date.now(), days: [d0, d1] });
  } catch (e) {
    weatherError = e;
    if (cached && cached.days[0] && cached.days[0].day === dayStr(0)) weather = { 0: cached.days[0], 1: cached.days[1] };
    else if (!weather[0] || weather[0].day !== dayStr(0)) weather = { 0: null, 1: null };
  }
  renderWeather(); renderControls(); refreshOutfit();
}

async function useGeo() {
  toast("Recherche de ta position…");
  try {
    const p = await locate();
    settings.loc = { ...p, name: "Ma position" };
    saveSettings(); renderSettings(); weather = { 0: null, 1: null }; loadWeather(true);
  } catch (e) {
    toast(e && e.code === 1 ? "Position refusée. Choisis une ville dans Réglages." : "Position introuvable. Choisis une ville dans Réglages.");
  }
}

// ---------------- fiche vêtement ----------------
function openItem(it) {
  if (isDemo()) { openProfile(null); return; }
  editing = it || null;
  draft = it ? { ...it, pattern: it.pattern || "uni", rain: it.rain || "normal", occ: (it.occ || []).slice(), seasons: (it.seasons || []).slice(), styles: (it.styles || []).slice(), material: it.material || null, acc: it.acc || (it.cat === "accessoire" ? "sac" : null) } :
    { name: "", cat: "haut", color: "noir", pattern: "uni", warmth: 2, seasons: [], rain: "normal", occ: [], dirty: false, styles: [], material: null, acc: null };
  draft.newBlob = null; draft.previewUrl = null; draft.cutBlob = null; draft.cutUrl = null; draft.cutBusy = false;
  draft.useCut = it && it.cut ? true : undefined;
  // en création, tout ce qui n'a pas été touché à la main est deviné ; en modification, rien ne bouge tout seul
  draft.touched = new Set(it ? ["cat", "acc", "warmth", "material", "pattern", "rain", "styles", "occ", "seasons", "color"] : []);
  // catégorie de départ : celle du filtre ; le nom peut la changer (« Jean… » → Bas)
  if (!it) draft.defaultCat = catFilter !== "tous" && catFilter !== "maison" && catFilter !== "trier" ? catFilter : "haut";
  if (!it) autoFill();
  $("f-more").open = false;
  $("item-title").textContent = it ? (it.wish ? "Modifier l'envie" : "Modifier") : "Nouveau vêtement";
  $("f-name").value = draft.name;
  $("f-brand").value = draft.brand || ""; $("f-size").value = draft.size || "";
  $("f-price").value = draft.price != null ? (draft.price % 1 ? draft.price.toFixed(2) : String(draft.price)).replace(".", ",") : ""; $("f-shop").value = draft.shop || "";
  $("f-repair-note").value = draft.repairNote || "";
  $("f-comp").value = draft.composition || ""; $("f-care").value = draft.care || "";
  $("brand-list").innerHTML = brandsList().map(([b]) => '<option value="' + esc(b) + '">').join("");
  $("btn-del").hidden = !it; $("btn-del").dataset.confirm = ""; $("btn-del").textContent = "Supprimer";
  $("f-err").hidden = true;
  $("photo-status").textContent = cameraSupported() ? "Photo prise ici : rien n'est gardé dans ton album." : "Choisis une photo, ou ajoute le vêtement sans photo.";
  $("btn-camera").hidden = !cameraSupported();
  renderItemSheet();
  $("btn-save-next").hidden = !!it;
  $("btn-with").hidden = !it;
  $("item-overlay").hidden = false;
  $("item-form").scrollTop = 0;
}
function closeItem() {
  $("item-overlay").hidden = true;
  if (draft && draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
  if (draft && draft.cutUrl) URL.revokeObjectURL(draft.cutUrl);
  editing = null; draft = null;
}
function autoFill() {
  if (!draft) return;
  const t = draft.touched;
  const g = guess(draft.name, { weekdayOcc: weekdayOcc() });
  const homeFilter = catFilter === "maison";
  if (!t.has("cat")) draft.cat = g.cat || draft.defaultCat || "haut";
  if (!t.has("acc")) draft.acc = draft.cat === "accessoire" ? g.acc || "sac" : null;
  if (!t.has("warmth")) draft.warmth = g.warmth || 2;
  if (!t.has("material")) draft.material = g.material || (draft.cat === "bas" && /jean/.test(draft.name.toLowerCase()) ? "jean" : null);
  if (!t.has("pattern")) draft.pattern = g.pattern || "uni";
  if (!t.has("rain")) draft.rain = g.rain || "normal";
  if (!t.has("styles")) draft.styles = g.styles || [];
  if (!t.has("occ")) draft.occ = homeFilter ? ["maison"] : g.occ;
  if (!t.has("seasons")) draft.seasons = homeFilter && draft.occ.every((o) => o === "maison") ? ["printemps", "ete", "automne", "hiver"] : seasonsFor(draft);
}
function detailSummary() {
  const lab = (list, id) => (list.find((x) => x.id === id) || {}).label;
  const parts = [
    draft.occ.map((o) => lab(OCCS, o)).join(", ") || "aucune occasion",
    draft.seasons.length === 4 ? "toute l'année" : draft.seasons.map((x) => lab(SEASONS, x).toLowerCase()).join(", ") || "aucune saison",
    draft.pattern === "motif" ? "à motif" : "uni",
    draft.material ? lab(MATERIALS, draft.material).toLowerCase() : null,
    draft.styles.length ? draft.styles.map((x) => lab(STYLE_TAGS, x).toLowerCase()).join(", ") : null,
    draft.rain === "impermeable" ? "imperméable" : draft.rain === "fragile" ? "craint la pluie" : null,
    draft.dirty ? "au sale" : null
  ].filter(Boolean);
  return parts.join(" · ");
}
function renderItemSheet() {
  const old = $("f-preview");
  const tmp = document.createElement("div");
  const showCut = draft.cutUrl && draft.useCut;
  tmp.innerHTML = thumb({ ...draft, previewUrl: showCut ? draft.cutUrl : draft.previewUrl, previewIsCut: showCut, cut: draft.useCut === false ? null : draft.cut }, "", "", ' id="f-preview"');
  $("f-cutmode").hidden = !(draft.cutUrl || draft.cut);
  $("f-cutmode").innerHTML = [[true, "Détouré"], [false, "Photo entière"]].map(([v, l]) => '<button type="button" class="chip" data-cm="' + v + '" aria-pressed="' + ((draft.useCut !== false) === v) + '">' + l + "</button>").join("");
  $("btn-cut").hidden = !(sync && draft.photo && !draft.cut && !draft.newBlob && !draft.cutUrl) || draft.cutBusy;
  old.replaceWith(tmp.firstChild);
  hydratePhotos($("item-form"));
  const chips = (list, key, multi, attr) => list.map((o) => {
    const on = multi ? draft[key].includes(o.id) : draft[key] === o.id;
    return '<button type="button" class="chip" data-' + attr + '="' + o.id + '" aria-pressed="' + on + '">' + o.label + "</button>";
  }).join("");
  $("f-cat").innerHTML = chips(CATS, "cat", false, "c");
  $("f-acc-group").hidden = draft.cat !== "accessoire";
  const hasKey = !!aiKey(), hasPhoto = !!(draft.newBlob || draft.photo || draft.cut);
  $("btn-recognize").hidden = !(hasKey && hasPhoto) || draft.cutBusy;
  $("btn-label").hidden = !hasKey;
  $("ai-hint").hidden = hasKey;
  $("f-acc").innerHTML = chips(ACC_TYPES, "acc", false, "acc");
  $("f-summary").textContent = detailSummary();
  $("f-color").innerHTML = Object.entries(COLORS).map(([k, v]) => '<button type="button" class="sw" data-k="' + k + '" style="background:' + v[1] + '" aria-pressed="' + (draft.color === k) + '" title="' + v[0] + '" aria-label="' + v[0] + '"></button>').join("");
  $("f-pattern").innerHTML = chips(PATTERNS, "pattern", false, "p");
  $("f-style").innerHTML = chips(STYLE_TAGS, "styles", true, "st");
  $("f-mat").innerHTML = chips(MATERIALS, "material", false, "mat");
  $("f-warm").innerHTML = chips(WARM, "warmth", false, "w");
  $("f-season").innerHTML = chips(SEASONS, "seasons", true, "s");
  $("f-rain").innerHTML = chips(RAIN, "rain", false, "r");
  $("f-occ").innerHTML = chips(OCCS, "occ", true, "o");
  $("f-repair").innerHTML = [[false, "En bon état"], [true, "À réparer"]].map(([v, l]) => '<button type="button" class="chip" data-rp="' + v + '" aria-pressed="' + (!!draft.repair === v) + '">' + l + "</button>").join("");
  $("f-repair-note-group").hidden = !draft.repair;
  $("f-wish-group").querySelector(".label").hidden = $("f-wish").hidden = !draft.wish;
  $("f-wish").innerHTML = [[false, "Je l'ai"], [true, "Envie (pas encore acheté)"]].map(([v, l]) => '<button type="button" class="chip" data-wi="' + v + '" aria-pressed="' + (!!draft.wish === v) + '">' + l + "</button>").join("");
  $("f-stored").innerHTML = [[false, "Dans le dressing"], [true, "Rangée (hors saison)"]].map(([v, l]) => '<button type="button" class="chip" data-st="' + v + '" aria-pressed="' + (!!draft.stored === v) + '">' + l + "</button>").join("");
  $("f-dirty").innerHTML = [[false, "Propre"], [true, "Au sale"]].map(([v, l]) => '<button type="button" class="chip" data-d="' + v + '" aria-pressed="' + (!!draft.dirty === v) + '">' + l + "</button>").join("");
}
function setDraftPhoto(blob) {
  draft.newBlob = blob;
  if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
  draft.previewUrl = URL.createObjectURL(blob);
  clearCut();
  renderItemSheet();
  runCutout(blob);
}
function clearCut() {
  if (draft.cutUrl) URL.revokeObjectURL(draft.cutUrl);
  draft.cutBlob = null; draft.cutUrl = null; draft.useCut = undefined;
}
async function runCutout(blob) {
  const d = draft;
  d.cutBusy = true;
  $("photo-status").textContent = "Détourage du vêtement…";
  cutStatusEl = $("photo-status");
  let r;
  noteCutStart();
  try { r = await removeBackground(blob); } catch (e) { r = { ok: false }; }
  noteCutEnd();
  if (cutStatusEl === $("photo-status")) cutStatusEl = null;
  d.cutBusy = false;
  if (draft !== d) return; // fiche fermée entre-temps
  if (r.ok) {
    d.cutBlob = r.blob; d.cutUrl = URL.createObjectURL(r.blob); d.useCut = true;
    $("photo-status").textContent = "Vêtement détouré. Si le résultat ne te plaît pas, choisis « Photo entière ».";
  } else {
    d.useCut = false;
    $("photo-status").textContent = "Le vêtement n'a pas pu être détouré : photo gardée entière. Astuce : prends tout le vêtement, sans qu'il touche les bords de la photo.";
  }
  // couleur et motif, calculés sur le téléphone
  try {
    const col = r.ok ? await detectColor(r.blob, { cut: true }) : await detectColor(blob, { cut: false });
    if (draft === d && col) {
      if (!d.touched.has("color")) d.color = col.color;
      if (!d.touched.has("pattern") && col.pattern === "motif") d.pattern = "motif";
    }
  } catch (e) {}
  if (draft !== d) return;
  renderItemSheet();
  // reconnaissance complète si la styliste est configurée et que la fiche est encore vide
  if (aiKey() && !editing && !$("f-name").value.trim()) runRecognize();
}

function photoForAi() {
  if (draft.cutBlob && draft.useCut !== false) return Promise.resolve(draft.cutBlob);
  if (draft.newBlob) return Promise.resolve(draft.newBlob);
  if (draft.photo || draft.cut) return sync.photoUrl(draft.cut || draft.photo).then((u) => fetch(u)).then((r) => r.blob());
  return Promise.resolve(null);
}
const aiErrText = (e) => ({
  auth: "Anthropic refuse la clé API. Vérifie-la dans Réglages.",
  credit: "Le compte Anthropic n'a plus de crédit.",
  rate: "Trop de demandes d'un coup. Réessaie dans une minute.",
  busy: "La styliste est surchargée. Réessaie dans quelques minutes.",
  network: "Pas de connexion.",
  notcloth: "La styliste ne voit pas de vêtement sur cette photo.",
  unreadable: "Étiquette illisible : rapproche-toi, avec plus de lumière, bien à plat.",
  format: "Réponse inexploitable. Réessaie."
}[e && e.kind] || "La demande n'a pas abouti" + (e && e.message ? " (" + e.message + ")" : "") + ".");

async function runRecognize() {
  const d = draft; if (!d) return;
  const btn = $("btn-recognize");
  btn.disabled = true; btn.textContent = "La styliste regarde…";
  $("photo-status").textContent = "Reconnaissance du vêtement…";
  try {
    const blob = await photoForAi();
    if (!blob) throw new AiError("other", "pas de photo");
    const r = await recognizeItem(aiKey(), blob);
    if (draft !== d) return;
    let applied = 0;
    const set = (k, v) => { if (v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) { d[k] = v; d.touched.add(k); applied++; } };
    if (r.name && !$("f-name").value.trim()) { d.name = r.name; $("f-name").value = r.name; }
    set("cat", r.cat); if (r.cat === "accessoire") set("acc", r.acc || "sac");
    set("color", r.color); set("pattern", r.pattern); set("material", r.material); set("warmth", r.warmth);
    set("seasons", r.seasons); set("occ", r.occ); set("styles", r.styles); set("rain", r.rain);
    if (r.brand && !$("f-brand").value.trim()) $("f-brand").value = r.brand;
    $("photo-status").textContent = applied ? "✨ Reconnu par la styliste. Vérifie et corrige si besoin, puis enregistre." : "La styliste n'a rien pu reconnaître sur cette photo.";
  } catch (e) {
    if (draft === d) $("photo-status").textContent = aiErrText(e);
  }
  btn.disabled = false; btn.textContent = "✨ Reconnaître le vêtement";
  if (draft === d) renderItemSheet();
}

async function runLabel(blob) {
  const d = draft; if (!d || !blob) return;
  const btn = $("btn-label");
  btn.disabled = true; btn.textContent = "Lecture de l'étiquette…";
  try {
    const r = await readLabel(aiKey(), blob);
    if (draft !== d) return;
    const got = [];
    if (r.brand) { $("f-brand").value = r.brand; got.push("marque"); }
    if (r.size) { $("f-size").value = r.size; got.push("taille"); }
    if (r.composition.length) {
      $("f-comp").value = r.composition.map((c) => (c.p ? c.p + " % " : "") + c.m).join(", ");
      got.push("composition");
      const m = materialFromComposition(r.composition);
      if (m.material && !d.touched.has("material")) { d.material = m.material; d.touched.add("material"); }
      if (m.warmth && !d.touched.has("warmth")) { d.warmth = m.warmth; d.touched.add("warmth"); if (!d.touched.has("seasons")) autoFill(); }
    }
    if (r.care.length) { $("f-care").value = r.care.join(" · "); got.push("entretien"); }
    $("photo-status").textContent = got.length ? "Étiquette lue : " + got.join(", ") + ". Détails dans « Plus de détails »." : "Rien de lisible sur cette étiquette.";
    if (got.length > 1) $("f-more").open = true;
  } catch (e) {
    if (draft === d) $("photo-status").textContent = aiErrText(e);
  }
  btn.disabled = false; btn.textContent = "Photographier l'étiquette";
  if (draft === d) renderItemSheet();
}

async function saveItemForm(e) {
  e.preventDefault();
  const err = $("f-err");
  draft.name = $("f-name").value.trim();
  if (!draft.name) { showErr(err, "Donne un nom au vêtement, par exemple « Jean noir »."); $("f-name").focus(); return; }
  if (!draft.occ.length) { $("f-more").open = true; return showErr(err, "Choisis au moins une occasion dans « Plus de détails »."); }
  if (!draft.seasons.length) { $("f-more").open = true; return showErr(err, "Choisis au moins une saison dans « Plus de détails »."); }
  err.hidden = true;
  const next = !!(e.submitter && e.submitter.id === "btn-save-next");
  const wasEditing = !!editing;
  const btn = $("btn-save"), btnNext = $("btn-save-next");
  const label = next ? btnNext : btn, labelText = label.textContent;
  btn.disabled = true; btnNext.disabled = true; label.textContent = "Enregistrement…";
  const id = editing ? editing.id : uid();
  const oldPhoto = editing ? editing.photo : null;
  try {
    let photo = draft.photo || null;
    let cut = draft.useCut === false ? null : draft.cut || null;
    if (draft.newBlob) { photo = await sync.uploadPhoto(draft.newBlob, id); cut = null; }
    if (draft.cutBlob && draft.useCut) cut = await sync.uploadPhoto(draft.cutBlob, id, "-cut");
    const oldCut = editing ? editing.cut : null;
    const item = {
      id, name: draft.name, cat: draft.cat, color: draft.color, pattern: draft.pattern, warmth: draft.warmth,
      cut, seasons: draft.seasons, rain: draft.rain, occ: draft.occ, stored: !!draft.stored, dirty: !!draft.dirty, dirtyAt: draft.dirty ? (editing && editing.dirty && editing.dirtyAt) || Date.now() : null, photo,
      brand: $("f-brand").value.trim() || null, size: $("f-size").value.trim() || null,
      price: parsePrice($("f-price").value), shop: $("f-shop").value.trim() || null,
      wish: !!draft.wish, repair: !!draft.repair, repairNote: draft.repair ? $("f-repair-note").value.trim() || null : null,
      composition: $("f-comp").value.trim() || null, care: $("f-care").value.trim() || null,
      styles: draft.styles, material: draft.material || null, acc: draft.cat === "accessoire" ? draft.acc || "sac" : null,
      createdAt: editing ? editing.createdAt || Date.now() : Date.now(), updatedAt: Date.now()
    };
    sync.change((d) => {
      const i = d.items.findIndex((x) => x.id === id);
      if (i >= 0) d.items[i] = item; else d.items.push(item);
    });
    if (oldPhoto && oldPhoto !== photo) sync.deletePhoto(oldPhoto);
    if (oldCut && oldCut !== cut) sync.deletePhoto(oldCut);
    if (catFilter !== "tous" && catFilter !== "maison" && catFilter !== item.cat) catFilter = item.cat;
    closeItem();
    toast(wasEditing ? "Modifié." : item.wish ? item.name + " ajouté à tes envies." : item.name + " ajouté au dressing.");
    if (item.wish && !wasEditing) showWardrobeTab("wishes");
    if (next) { const keepCat = item.cat; openItem(null); draft.defaultCat = keepCat; autoFill(); renderItemSheet(); setTimeout(() => $("f-name").focus(), 60); }
  } catch (ex) {
    showErr(err, ex.status === 0 ? "Pas de connexion : la photo n'a pas pu partir. Réessaie quand tu as du réseau."
      : ex.status === 401 || ex.status === 403 ? "GitHub refuse le jeton. Vérifie-le dans Réglages."
      : "L'envoi n'a pas abouti (" + (ex.message || "erreur") + "). Réessaie.");
  }
  btn.disabled = false; btnNext.disabled = false; label.textContent = labelText;
}

function deleteItem() {
  const b = $("btn-del");
  if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Confirmer la suppression"; return; }
  const it = editing; if (!it) return;
  sync.change((d) => {
    const i = d.items.findIndex((x) => x.id === it.id);
    if (i >= 0) d.items[i] = { id: it.id, deleted: true, updatedAt: Date.now() };
  });
  if (it.photo) sync.deletePhoto(it.photo);
  if (it.cut) sync.deletePhoto(it.cut);
  closeItem();
  toast(it.name + " supprimé.");
}

// ---------------- onglets ----------------
function showTab(which) {
  for (const t of ["today", "wardrobe", "agenda", "settings"]) {
    $("view-" + t).hidden = t !== which;
    $("tab-" + t).setAttribute("aria-selected", t === which);
  }
  window.scrollTo(0, 0);
}

// ---------------- événements ----------------
function on(id, ev, fn) { $(id).addEventListener(ev, fn); }
function delegate(id, attr, fn) {
  on(id, "click", (e) => { const b = e.target.closest("[data-" + attr + "]"); if (b && !b.disabled) fn(b.dataset[attr.replace(/-([a-z])/g, (m, c) => c.toUpperCase())], b, e); });
}

function bind() {
  for (const t of ["today", "wardrobe", "agenda", "settings"]) on("tab-" + t, "click", () => showTab(t));
  on("profile-btn", "click", () => showTab("settings"));
  on("day-today", "click", () => { dayOffset = 0; renderWeather(); renderControls(); newSuggestion(true); });
  on("day-tomorrow", "click", () => { dayOffset = 1; renderWeather(); renderControls(); newSuggestion(true); });

  delegate("temp-chips", "t", (t) => {
    if (t === "pluie") settings.manual.rain = !settings.manual.rain; else settings.manual.temp = t;
    saveSettings(); renderControls(); newSuggestion(true);
  });
  const markHonored = () => honored.add((sync ? sync.profile.id : "demo") + "/" + dayStr(dayOffset));
  delegate("occ-chips", "o", (o) => { markHonored(); occOverride[dayStr(dayOffset)] = o; renderControls(); newSuggestion(true); });
  delegate("mood-chips", "m", (m) => { markHonored(); mood = m; renderControls(); newSuggestion(true); });

  on("btn-other", "click", () => newSuggestion(false));
  on("btn-wear", "click", () => { if (dayOffset === 1 && !wornEntry(context())) toggleReady(); else wearCurrent(); });
  on("ready-box", "click", (e) => { const b = e.target.closest("[data-ready]"); if (!b) return; if (b.dataset.ready === "adapt") adaptReady(); else if (b.dataset.ready === "keep") keepReady(); else if (b.dataset.ready === "undo") toggleReady(); });
  on("btn-ai", "click", askAi);
  on("btn-like", "click", () => {
    if (!current) return;
    const fb = (data().feedback || {})[current.key];
    const v = fb && fb.v === 1 ? 0 : 1;
    const apply = (d) => { d.feedback = d.feedback || {}; d.feedback[current.key] = { v, t: Date.now() }; };
    if (isDemo()) { apply(demoDoc); renderOutfit(); } else sync.change(apply);
    if (v) keepOutfit(current.pieces, "aime", current.title || "");
    toast(v ? "Noté, et gardée dans « Mes tenues »." : "Retiré de tes tenues aimées.");
  });
  on("btn-dislike", "click", () => {
    if (!current) return;
    const key = current.key;
    const apply = (d) => { d.feedback = d.feedback || {}; d.feedback[key] = { v: -1, t: Date.now() }; };
    if (isDemo()) apply(demoDoc); else sync.change(apply);
    const refused = current.pieces.slice();
    newSuggestion(false);
    askWhy(key, refused);
  });
  delegate("why-chips", "why", (w) => {
    if (w === "skip") { $("why-box").hidden = true; return; }
    if (w === "piece") { whyPieces(); return; }
    setWhy(whyFor.key, { why: w });
  });
  delegate("why-chips", "piece", (id) => setWhy(whyFor.key, { why: "piece", piece: id }));
  delegate("worn-box", "dirty", (id, b) => { setDirty(id, b.getAttribute("aria-pressed") !== "true"); });
  on("worn-box", "click", (e) => { if (e.target.id === "btn-unwear") unwearCurrent(); });
  on("btn-connect", "click", () => openProfile(null));

  delegate("cat-filter", "f", (f) => { catFilter = f; renderWardrobe(); });
  on("search", "input", (e) => { search = e.target.value; renderWardrobe(); });
  delegate("brand-chips", "brand", (b) => { const same = normTxt(search) === normTxt(b); search = same ? "" : b; $("search").value = search; renderWardrobe(); });
  delegate("grid", "id", (id) => { const it = liveItems().find((i) => i.id === id); if (it) openItem(it); });
  delegate("laundry-row", "clean", (id) => { setDirty(id, false); toast("Remis dans le dressing."); });
  on("btn-all-clean", "click", () => {
    if (!sync) return;
    sync.change((d) => { for (const it of d.items) if (it.dirty) { it.dirty = false; it.dirtyAt = null; it.updatedAt = Date.now(); } });
    toast("Tout est propre.");
  });
  on("btn-add", "click", () => openItem(null));

  // fiche vêtement
  on("item-form", "submit", saveItemForm);
  on("item-close", "click", closeItem);
  on("item-overlay", "click", (e) => { if (e.target === $("item-overlay")) closeItem(); });
  on("f-name", "input", (e) => { if (!draft) return; draft.name = e.target.value; if (!editing) { autoFill(); renderItemSheet(); } });
  const touch = (k) => draft.touched.add(k);
  const refill = () => { if (!editing) autoFill(); renderItemSheet(); };
  delegate("f-cat", "c", (v) => { draft.cat = v; touch("cat"); refill(); });
  delegate("f-acc", "acc", (v) => { draft.acc = v; touch("acc"); refill(); });
  delegate("f-color", "k", (v) => { draft.color = v; touch("color"); renderItemSheet(); });
  on("btn-recognize", "click", runRecognize);
  on("btn-label", "click", async () => {
    if (!cameraSupported()) { $("f-label-file").click(); return; }
    try { const b = await takePhoto(); if (b) runLabel(b); }
    catch (e) { $("f-label-file").click(); }
  });
  on("f-label-file", "change", async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { runLabel(await resizeFile(f, 1400)); } catch (ex) { $("photo-status").textContent = "Cette image n'a pas pu être lue."; }
    e.target.value = "";
  });
  delegate("f-pattern", "p", (v) => { draft.pattern = v; touch("pattern"); renderItemSheet(); });
  delegate("f-warm", "w", (v) => { draft.warmth = +v; touch("warmth"); refill(); });
  delegate("f-season", "s", (v) => { draft.seasons = draft.seasons.includes(v) ? draft.seasons.filter((x) => x !== v) : draft.seasons.concat(v); touch("seasons"); renderItemSheet(); });
  delegate("f-rain", "r", (v) => { draft.rain = v; touch("rain"); renderItemSheet(); });
  delegate("f-style", "st", (v) => { draft.styles = draft.styles.includes(v) ? draft.styles.filter((x) => x !== v) : draft.styles.concat(v); touch("styles"); renderItemSheet(); });
  delegate("f-mat", "mat", (v) => { draft.material = draft.material === v ? null : v; touch("material"); refill(); });
  delegate("f-occ", "o", (v) => { draft.occ = draft.occ.includes(v) ? draft.occ.filter((x) => x !== v) : draft.occ.concat(v); touch("occ"); refill(); });
  delegate("f-dirty", "d", (v) => { draft.dirty = v === "true"; renderItemSheet(); });
  delegate("f-stored", "st", (v) => { draft.stored = v === "true"; renderItemSheet(); });
  delegate("f-repair", "rp", (v) => { draft.repair = v === "true"; renderItemSheet(); if (draft.repair) setTimeout(() => $("f-repair-note").focus(), 50); });
  delegate("f-wish", "wi", (v) => { draft.wish = v === "true"; renderItemSheet(); });
  on("btn-del", "click", deleteItem);
  on("btn-with", "click", () => { const it = editing && liveItems().find((i) => i.id === editing.id); if (!it) return; closeItem(); openWith(it); });
  delegate("f-cutmode", "cm", (v) => { draft.useCut = v === "true"; renderItemSheet(); });
  on("btn-cut", "click", async () => {
    if (!draft || !draft.photo) return;
    $("btn-cut").hidden = true;
    try { const url = await sync.photoUrl(draft.photo); const blob = await (await fetch(url)).blob(); await runCutout(blob); }
    catch (e) { $("photo-status").textContent = "La photo n'a pas pu être chargée. Vérifie ta connexion."; }
  });
  on("btn-camera", "click", async () => {
    try {
      const blob = await takePhoto();
      if (blob && draft) setDraftPhoto(blob);
    } catch (e) {
      $("photo-status").textContent = e && e.name === "NotAllowedError"
        ? "Caméra refusée. Autorise-la dans les réglages du navigateur, ou choisis une photo dans l'album."
        : "Caméra indisponible sur cet appareil. Choisis une photo dans l'album.";
    }
  });
  on("f-file", "change", async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f || !draft) return;
    $("photo-status").textContent = "Préparation de la photo…";
    try { setDraftPhoto(await resizeFile(f)); }
    catch (ex) { $("photo-status").textContent = "Cette image n'a pas pu être lue. Essaie un fichier JPEG ou PNG."; }
    e.target.value = "";
  });

  // agenda
  delegate("days", "day", (d) => openDay(d));
  delegate("calendar", "cal", (d) => openCalDay(d));
  delegate("calendar", "calnav", (n) => {
    const [y, m] = calMonth.split("-").map(Number); const d = new Date(y, m - 1 + +n, 1);
    calMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); renderCalendar();
  });
  delegate("cal-sheet", "cd", calAction);
  on("cal-overlay", "click", (e) => { if (e.target === $("cal-overlay")) $("cal-overlay").hidden = true; });
  delegate("d-occ", "o", (v) => { dayDraft.occ = v; renderDaySheet(); });
  delegate("d-imp", "i", (v) => { dayDraft.important = v === "true"; renderDaySheet(); });
  on("day-form", "submit", (e) => {
    e.preventDefault();
    const day = editingDay, entry = { occ: dayDraft.occ, important: dayDraft.important, note: $("d-note").value.trim(), t: Date.now() };
    sync.change((d) => { d.agenda = d.agenda || {}; d.agenda[day] = entry; });
    delete occOverride[day];
    $("day-overlay").hidden = true;
  });
  on("btn-d-clear", "click", () => {
    const day = editingDay;
    sync.change((d) => { d.agenda = d.agenda || {}; d.agenda[day] = { deleted: true, t: Date.now() }; });
    $("day-overlay").hidden = true;
  });
  on("day-close", "click", () => ($("day-overlay").hidden = true));
  on("day-overlay", "click", (e) => { if (e.target === $("day-overlay")) $("day-overlay").hidden = true; });

  delegate("week", "wk-act", (act, b) => weekAction(act, b));
  on("wd-tab-pieces", "click", () => showWardrobeTab("pieces"));
  on("wd-tab-outfits", "click", () => showWardrobeTab("outfits"));
  on("wd-tab-wishes", "click", () => showWardrobeTab("wishes"));
  on("btn-wish-add", "click", () => { openItem(null); draft.wish = true; $("item-title").textContent = "Nouvelle envie"; renderItemSheet(); });
  on("btn-shop", "click", () => { shopAsWish = false; $("shop-file").click(); });
  on("btn-wish-shop", "click", () => { shopAsWish = true; $("shop-file").click(); });
  on("shop-file", "change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) importShop(f); });
  on("wishes", "click", (e) => {
    const b = e.target.closest("[data-wa2]"); if (!b) return;
    const it = wishItems().find((i) => i.id === b.dataset.id); if (!it) return;
    if (b.dataset.wa2 === "bought") { mutate((d) => { const x = d.items.find((i) => i.id === it.id); if (x) { x.wish = false; x.createdAt = Date.now(); x.updatedAt = Date.now(); } }); toast(it.name + " rejoint ton dressing."); }
    if (b.dataset.wa2 === "looks") openWith(it);
    if (b.dataset.wa2 === "edit") openItem(it);
  });
  on("btn-compose", "click", () => openCompose(null));
  delegate("outfits-grid", "saved", (id) => openSaved(id));
  delegate("saved-sheet", "sv", (act, b) => savedAction(act, b));
  on("saved-overlay", "click", (e) => { if (e.target === $("saved-overlay")) $("saved-overlay").hidden = true; });
  delegate("c-picker", "pk", (id) => togglePick(id));
  on("compose-form", "submit", saveCompose);
  on("compose-close", "click", () => ($("compose-overlay").hidden = true));
  on("compose-overlay", "click", (e) => { if (e.target === $("compose-overlay")) $("compose-overlay").hidden = true; });
  on("btn-c-del", "click", () => {
    const b = $("btn-c-del");
    if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Confirmer"; return; }
    const id = compose.id; mutate((d) => { d.outfits[id] = { deleted: true, t: Date.now() }; });
    $("compose-overlay").hidden = true; toast("Tenue supprimée.");
  });
  delegate("with-sheet", "wa", (act, b) => withAction(act, b));
  on("with-overlay", "click", (e) => { if (e.target === $("with-overlay")) $("with-overlay").hidden = true; });
  delegate("lay", "pid", (id) => openPiece(id));
  on("btn-audit", "click", openAudit);
  on("btn-stats", "click", openStats);
  delegate("repair-row", "fixed", (id) => { const it = liveItems().find((i) => i.id === id); setRepair(id, false); toast((it ? it.name : "La pièce") + " est réparée : elle revient dans les tenues."); });
  delegate("stats-sheet", "stp", (d) => { statsPeriod = +d; renderStats(); });
  delegate("stats-sheet", "stx", () => { $("stats-overlay").hidden = true; });
  delegate("stats-sheet", "sid", (id) => { const it = liveItems().find((i) => i.id === id); if (it) { $("stats-overlay").hidden = true; openItem(it); } });
  on("stats-overlay", "click", (e) => { if (e.target === $("stats-overlay")) $("stats-overlay").hidden = true; });
  delegate("season-card", "season", seasonAction);
  delegate("season-sheet", "season", seasonAction);
  delegate("season-sheet", "sp", (v) => { const [k, id] = v.split(":"); const set = k === "s" ? seasonSel.store : seasonSel.out; if (set.has(id)) set.delete(id); else set.add(id); renderSeasonSheet(); });
  on("season-overlay", "click", (e) => { if (e.target === $("season-overlay")) $("season-overlay").hidden = true; });
  delegate("audit-sheet", "au", (v) => { if (v === "close") $("audit-overlay").hidden = true; else runAudit(); });
  delegate("audit-sheet", "aid", (id) => { const it = liveItems().find((i) => i.id === id); if (it) { $("audit-overlay").hidden = true; openItem(it); } });
  on("audit-overlay", "click", (e) => { if (e.target === $("audit-overlay")) $("audit-overlay").hidden = true; });
  delegate("props-sheet", "pr", (v) => { if (v === "close") $("props-overlay").hidden = true; else chooseProposal(v); });
  on("props-overlay", "click", (e) => { if (e.target === $("props-overlay")) $("props-overlay").hidden = true; });
  on("btn-props", "click", openProposals);
  delegate("piece-sheet", "pa", (act, b) => pieceAction(act, b));
  delegate("piece-sheet", "alti", (i) => pickAlt(i));
  on("piece-overlay", "click", (e) => { if (e.target === $("piece-overlay")) $("piece-overlay").hidden = true; });

  on("btn-batch", "click", openBatch);
  delegate("batch-sheet", "bt", (act) => batchAction(act));
  delegate("batch-sheet", "bk", (i) => { const e = batch.entries[+i]; e.keep = !e.keep; renderBatch(); });
  on("batch-sheet", "input", (e) => { const i = e.target.dataset.bn; if (i !== undefined && batch) batch.entries[+i].name = e.target.value; });
  on("b-file-one", "change", async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f || !batch) return;
    try { runGroup(await resizeFile(f, 1800)); } catch (x) { batch.status = "Cette image n'a pas pu être lue."; renderBatch(); }
  });
  on("b-file-many", "change", async (e) => {
    const fs = [...(e.target.files || [])]; e.target.value = ""; if (!batch) return;
    for (const f of fs.slice(0, 40)) { try { queueSingle(await resizeFile(f, 900)); } catch (x) {} }
  });

  // valises
  on("btn-new-trip", "click", openTripForm);
  delegate("trips", "trip", (id) => openTrip(id));
  on("trip-form", "submit", saveTrip);
  on("trip-close", "click", () => ($("trip-overlay").hidden = true));
  on("trip-overlay", "click", (e) => { if (e.target === $("trip-overlay")) $("trip-overlay").hidden = true; });
  on("tripview-overlay", "click", (e) => { if (e.target === $("tripview-overlay")) { $("tripview-overlay").hidden = true; openTripId = null; } });
  delegate("tripview", "tv", (act, b) => tripAction(act, b));
  delegate("tripview", "check", (id) => toggleCheck(id));
  delegate("t-occ", "o", (v) => { tripDraft.occ = v; tripDraft.extra = tripDraft.extra.filter((x) => x !== v); renderTripForm(); });
  delegate("t-extra", "x", (v) => { tripDraft.extra = tripDraft.extra.includes(v) ? tripDraft.extra.filter((x) => x !== v) : tripDraft.extra.concat(v); renderTripForm(); });
  delegate("t-climate", "cl", (v) => { tripDraft.climate = v; renderTripForm(); });
  on("t-start", "change", () => renderTripForm());
  const tripSearch = async () => {
    const q = $("t-city").value.trim(); if (!q) return;
    $("t-city-results").innerHTML = '<span class="note">Recherche…</span>';
    try {
      tripDraft.results = await searchCity(q);
      $("t-city-results").innerHTML = tripDraft.results.length ? tripDraft.results.map((r, i) => '<button type="button" class="chip" data-tc="' + i + '">' + esc(r.name) + "<small>" + esc(r.region) + "</small></button>").join("") : '<span class="note">Aucune ville trouvée.</span>';
    } catch (e) { $("t-city-results").innerHTML = '<span class="note">Recherche impossible pour l\'instant. Vérifie ta connexion.</span>'; }
  };
  on("t-city-btn", "click", tripSearch);
  on("t-city", "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tripSearch(); } });
  delegate("t-city-results", "tc", (i) => {
    const r = tripDraft.results[+i];
    tripDraft.dest = { name: r.name, lat: +r.lat.toFixed(3), lon: +r.lon.toFixed(3) };
    $("t-city-results").innerHTML = ""; $("t-city").value = r.name;
    $("t-dest").textContent = "Destination : " + r.name + (r.region ? " (" + r.region + ")" : "");
  });

  // réglages
  on("btn-new-profile", "click", () => openProfile(null));
  delegate("profiles", "use", (id) => { activate(id); showTab("today"); });
  delegate("profiles", "edit", (id) => openProfile(getProfiles().find((p) => p.id === id)));
  on("profile-form", "submit", saveProfile);
  on("profile-close", "click", () => ($("profile-overlay").hidden = true));
  on("profile-overlay", "click", (e) => { if (e.target === $("profile-overlay")) $("profile-overlay").hidden = true; });
  on("btn-p-del", "click", removeProfile);
  on("btn-geo", "click", useGeo);
  on("city-form", "submit", async (e) => {
    e.preventDefault();
    const q = $("city-input").value.trim(); if (!q) return;
    $("city-results").innerHTML = '<span class="note">Recherche…</span>';
    try {
      const res = await searchCity(q);
      $("city-results").innerHTML = res.length ? res.map((r, i) => '<button type="button" class="chip" data-city="' + i + '">' + esc(r.name) + "<small>" + esc(r.region) + "</small></button>").join("") : '<span class="note">Aucune ville trouvée.</span>';
      $("city-results").onclick = (ev) => {
        const b = ev.target.closest("[data-city]"); if (!b) return;
        const r = res[+b.dataset.city];
        settings.loc = { lat: +r.lat.toFixed(3), lon: +r.lon.toFixed(3), name: r.name };
        saveSettings(); $("city-results").innerHTML = ""; $("city-input").value = "";
        renderSettings(); weather = { 0: null, 1: null }; loadWeather(true);
        toast("Météo de " + r.name + ".");
      };
    } catch (ex) { $("city-results").innerHTML = '<span class="note">Recherche impossible pour l\'instant. Vérifie ta connexion.</span>'; }
  });
  const toggleStyle = (id) => {
    const cur = prefs().styles || [];
    if (!cur.includes(id) && cur.length >= 3) { toast("3 styles au maximum : retires-en un d'abord."); return; }
    setPrefs({ styles: cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id) });
  };
  delegate("style-chips", "style", toggleStyle);
  delegate("designer-chips", "style", toggleStyle);
  on("style-note", "change", (e) => setPrefs({ note: e.target.value.trim() }));
  checkCutCrash();
  delegate("cut-chips", "cut", (k) => { try { localStorage.setItem("dressing:cut", k); } catch (e) {} renderCutChips(); });
  on("btn-recut", "click", recutAll);
  on("btn-look-add", "click", () => $("look-file").click());
  on("look-file", "change", (e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) addLooks(fs); });
  on("looks", "click", (e) => {
    const b = e.target.closest("[data-look-del]"); if (!b) return;
    const id = b.dataset.lookDel; const l = (data().looks || {})[id];
    mutate((d) => { if (d.looks && d.looks[id]) { d.looks[id].deleted = true; d.looks[id].t = Date.now(); } });
    if (l && l.photo && sync) sync.deletePhoto(l.photo);
    toast("Look retiré.");
  });
  on("looks", "change", (e) => {
    const id = e.target.dataset.lookNote; if (!id) return; const v = e.target.value.trim();
    mutate((d) => { if (d.looks && d.looks[id]) { d.looks[id].note = v; d.looks[id].t = Date.now(); } });
  });
  on("ai-key", "focus", (e) => { if (e.target.value.startsWith("••")) e.target.value = ""; });
  on("ai-key", "blur", () => setTimeout(renderSettings, 200));
  on("btn-ai-save", "click", async () => {
    const st = $("ai-key-status");
    const v = $("ai-key").value.trim();
    if (!v || v.startsWith("••")) { st.textContent = "Colle ta clé API, elle commence par sk-ant-."; st.hidden = false; return; }
    st.textContent = "Vérification auprès d'Anthropic…"; st.hidden = false;
    try {
      await testKey(v);
      LS.set("dressing:aikey", v);
      st.textContent = "Clé enregistrée sur cet appareil. Le bouton « Demander à la styliste » est prêt.";
    } catch (e) {
      st.textContent = e.kind === "auth" ? "Anthropic ne reconnaît pas cette clé. Vérifie qu'elle est complète."
        : e.kind === "credit" ? "La clé fonctionne mais le compte n'a pas de crédit. Ajoute du crédit dans la console Anthropic."
        : e.kind === "network" ? "Pas de connexion. Réessaie quand tu as du réseau."
        : "Anthropic a répondu : " + e.message;
    }
    renderSettings();
  });
  on("btn-ai-del", "click", () => { LS.del("dressing:aikey"); $("ai-key-status").textContent = "Clé retirée de cet appareil."; $("ai-key-status").hidden = false; renderSettings(); });
  delegate("wk-chips", "wk", (v) => setPrefs({ weekdayOcc: v }));
  delegate("we-chips", "we", (v) => setPrefs({ weekendOcc: v }));
  delegate("rest-chips", "r", (v) => { settings.restDays = +v; saveSettings(); renderSettings(); newSuggestion(true); });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("item-overlay").hidden) closeItem();
    $("profile-overlay").hidden = true; $("day-overlay").hidden = true; $("trip-overlay").hidden = true;
    $("with-overlay").hidden = true; $("compose-overlay").hidden = true; $("saved-overlay").hidden = true;
    if (!$("tripview-overlay").hidden) { $("tripview-overlay").hidden = true; openTripId = null; }
  });
  let shownDay = dayStr(0);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (dayStr(0) !== shownDay) {
      shownDay = dayStr(0);
      dayOffset = new Date().getHours() >= 19 ? 1 : 0;
      occOverride = {}; mood = ""; current = null;
      renderAll();
    }
    if (sync) sync.sync();
    loadWeather(false);
  });
}

// ---------------- démarrage ----------------
initCamera();
bind();
const startId = getActiveId();
activate(getProfiles().some((p) => p.id === startId) ? startId : (getProfiles()[0] || {}).id || null);
loadWeather(false);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
}

// ---------------- mises à jour ----------------
// L'iPhone garde volontiers l'ancienne version : on compare avec version.json à chaque ouverture.
async function checkUpdate() {
  try {
    const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const v = (await r.json()).version;
    if (v && v !== VERSION) $("update-banner").hidden = false;
  } catch (e) {}
}
async function applyUpdate() {
  $("btn-update").disabled = true; $("btn-update").textContent = "Mise à jour…";
  try { for (const k of await caches.keys()) if (k.startsWith("dressing-app-")) await caches.delete(k); } catch (e) {}
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
  location.reload();
}
$("btn-update").addEventListener("click", applyUpdate);
checkUpdate();
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
