import { CATS, COLORS, WARM, PATTERNS, RAIN, SEASONS, OCCS, MOODS, MANUAL_TEMPS, GLYPH, ACC_TYPES, demoItems } from "./js/catalog.js";
import { guess, seasonsFor } from "./js/guess.js";
import { suggest, suggestMany, seasonOf, missingNote, comboKey, daysBetween, planTrip } from "./js/engine.js";
import { suggestGaps, MILESTONES } from "./js/gaps.js";
import { Sync, LS, uid, getProfiles, saveProfiles, getActiveId, setActiveId } from "./js/store.js";
import { Repo, parseRepo } from "./js/github.js";
import { fetchTwoDays, fetchRange, searchCity, locate } from "./js/weather.js";
import { initCamera, takePhoto, takePhotos, cameraSupported, resizeFile } from "./js/camera.js";
import { STYLES, STYLE_TAGS, MATERIALS } from "./js/styles.js";
import { askStylist, testKey, AiError, recognizeItem, readLabel, materialFromComposition, detectMany } from "./js/ai.js";
import { detectColor } from "./js/colorid.js";
import { removeBackground } from "./js/cutout.js";

const VERSION = "1.8.0";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------- état ----------------
let sync = null;               // synchronisation du profil actif (null = exemple)
let doc = null;                // données du dressing affiché
let demoDoc = { items: demoItems(), history: [], feedback: {}, agenda: {}, prefs: { styles: [], note: "", t: 0 }, trips: {}, week: null, outfits: {} };
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
function liveItems() {
  const d = data();
  const hist = (d.history || []).filter((h) => !h.deleted);
  const last = new Map(), count = new Map();
  for (const h of hist) for (const id of h.items) {
    count.set(id, (count.get(id) || 0) + 1);
    if (!last.has(id) || last.get(id) < h.day) last.set(id, h.day);
  }
  return (d.items || []).filter((i) => !i.deleted).map((i) => ({
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
const FL = {
  haut: { l: 8, t: 5, w: 46, h: 36, z: 3 },
  haut2: { l: 26, t: 3, w: 40, h: 34, z: 2 },
  robe: { l: 9, t: 4, w: 46, h: 68, z: 2 },
  bas: { l: 13, t: 35, w: 40, h: 47, z: 1 },
  veste: { l: 41, t: 9, w: 50, h: 40, z: 4 },
  chaussures: { l: 15, t: 82, w: 36, h: 14, z: 5 },
  chaussures2: { l: 52, t: 84, w: 30, h: 12, z: 5 },
  sac: { l: 61, t: 51, w: 32, h: 30, z: 5 },
  echarpe: { l: 50, t: 2, w: 24, h: 30, z: 6 },
  bonnet: { l: 75, t: 1, w: 22, h: 15, z: 6 },
  chapeau: { l: 73, t: 1, w: 25, h: 15, z: 6 },
  gants: { l: 1, t: 47, w: 15, h: 16, z: 6 },
  ceinture: { l: 12, t: 33, w: 44, h: 6, z: 4 },
  lunettes: { l: 57, t: 85, w: 27, h: 9, z: 6 },
  bijou: { l: 1, t: 82, w: 13, h: 12, z: 6 },
  extra: [{ l: 75, t: 18, w: 22, h: 18, z: 6 }, { l: 1, t: 64, w: 15, h: 16, z: 6 }, { l: 84, t: 84, w: 15, h: 12, z: 6 }, { l: 1, t: 1, w: 16, h: 14, z: 6 }]
};
function flatlay(pieces, small = false) {
  const used = new Set();
  let extra = 0;
  const slotFor = (p) => {
    let k = p.cat === "accessoire" ? p.acc || "sac" : p.cat;
    if (k === "haut" && used.has("haut")) k = "haut2";
    if (k === "chaussures" && used.has("chaussures")) k = "chaussures2";
    let s = !used.has(k) && FL[k];
    if (s) used.add(k);
    else s = FL.extra[extra++ % FL.extra.length];
    // sans veste ni bas (robe seule) : on resserre un peu la composition
    if (k === "sac" && !pieces.some((x) => x.cat === "veste")) s = { ...s, t: 34 };
    if (k === "chaussures" && pieces.some((x) => x.cat === "robe") && !pieces.some((x) => x.cat === "bas")) s = { ...s, t: 78 };
    return s;
  };
  const html = pieces.map((p, i) => {
    const s = slotFor(p);
    const path = p.cut || p.photo;
    const kind = p.cut ? "fl-cut" : p.photo ? "fl-photo" : "fl-glyph";
    const data = path && sync ? ' data-photo="' + esc(path) + '" data-alt="' + esc(p.name) + '"' : "";
    return '<div class="fl-item ' + kind + '" style="left:' + s.l + "%;top:" + s.t + "%;width:" + s.w + "%;height:" + s.h + "%;z-index:" + s.z + ";animation-delay:" + i * 0.05 + 's"' + data + ' title="' + esc(p.name) + '">' + glyph(p.cat, p.color, p.acc, p.name) + "</div>";
  }).join("");
  return '<div class="flatlay' + (small ? " small" : "") + '">' + html + "</div>";
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
  const order = { veste: 0, haut: 1, robe: 1, bas: 2, chaussures: 3, accessoire: 4 };
  const pieces = current.pieces.slice().sort((a, b) => (order[a.cat] ?? 5) - (order[b.cat] ?? 5));
  lay.innerHTML = flatlay(pieces) +
    '<ul class="fl-list">' + pieces.map((p) => '<li><span class="tag">' + esc(catLabel(p)) + '</span><span class="piece-name">' + esc(p.name) + '</span><span class="piece-meta">' + wornText(p) + "</span></li>").join("") + "</ul>";
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

function renderWorn(worn, c) {
  const btn = $("btn-wear"), box = $("worn-box");
  const when = dayOffset === 0 ? "aujourd'hui" : "demain";
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
    if (p && !p.deleted && !honored.has(hk)) {
      honored.add(hk);
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
  // 2. la tenue proposée plus tôt pour ce jour, si l'occasion et l'envie n'ont pas changé
  if (p && !p.deleted && p.occ === c.occ && (p.mood || "") === (c.mood || "") && (!p.wsig || p.wsig === wsig(c))) {
    const ps = usable(p.ids, false);
    if (ps && !incomplete(ps, c)) return { key: comboKey(ps.filter((x) => x.cat !== "accessoire")), pieces: ps, reasons: p.reasons || [], tip: p.tip || "", title: p.title || "", ai: !!p.ai, week: !!p.week };
  }
  return null;
}
function savePick(c) {
  if (!current) return;
  if (sync && !sync.loaded) return; // on attend d'avoir les données à jour avant d'écrire
  const pick = { ids: current.pieces.map((p) => p.id), occ: c.occ, mood: c.mood || "", wsig: wsig(c), reasons: current.reasons || [], tip: current.tip || "", title: current.title || "", ai: !!current.ai, week: !!current.week, t: Date.now() };
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
  const items = liveItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const fb = data().feedback || {};
  const names = (k) => k.split("|").map((id) => byId.get(id)).filter(Boolean).map((i) => i.name).join(" + ");
  const liked = Object.keys(fb).filter((k) => fb[k].v === 1).map(names).filter(Boolean);
  const disliked = Object.keys(fb).filter((k) => fb[k].v === -1).map(names).filter(Boolean);
  try {
    const loadImage = (it) => {
      const path = it.cut || it.photo;
      if (!path || !sync) return Promise.resolve(null);
      return sync.photoUrl(path).then((u) => fetch(u)).then((r) => r.blob());
    };
    const r = await askStylist(key, { items, ctx: c, weather: weather[dayOffset], prefs: prefs(), liked, disliked, current: current.pieces.map((p) => p.name).join(" + "), loadImage });
    const pieces = r.ids.map((id) => byId.get(id));
    current = { key: comboKey(pieces), pieces, reasons: r.why, tip: r.tip, title: r.title, ai: true };
    seen.push(current.key);
    savePick(c);
    wornKey = null; msg.hidden = true;
    renderOutfit();
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
  const inFilter = (i, f) => f === "tous" ? true : f === "maison" ? (i.occ || []).includes("maison") : f === "trier" ? toSort(i) : i.cat === f;
  $("cat-filter").innerHTML = [{ id: "tous", label: "Tout" }].concat(CATS, [{ id: "maison", label: "Maison" }, { id: "trier", label: "À trier" }]).map((c) => {
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
    thumb(it, it.demo ? "Exemple" : it.dirty ? "Au sale" : it.cat === "accessoire" ? catLabel(it) : "", isHome(it) ? "Maison" : "") +
    '<span class="piece-name">' + esc(it.name) + '</span><span class="piece-meta">' + (it.brand ? esc(it.brand) + " · " : "") + wornText(it) + (it.wornCount ? " · " + it.wornCount + " fois" : "") + "</span></button>"
  ).join("") : '<p class="empty">' + (q ? "Aucune pièce ne correspond à « " + esc(search.trim()) + " »." : catFilter === "trier" && all.length ? "Rien à trier : tout a été porté ces 6 derniers mois." : all.length ? "Rien dans cette catégorie pour l'instant." : "Ton dressing est vide. Ajoute ton premier vêtement : une photo, un nom, et c'est parti.") + "</p>";
  hydratePhotos($("view-wardrobe"));
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

  const byId = new Map((data().items || []).map((i) => [i.id, i]));
  const hist = (data().history || []).filter((h) => !h.deleted).slice(0, 20);
  $("history").innerHTML = hist.length ? hist.map((h) =>
    '<div class="h-entry"><div class="outfit-head"><span class="label">' + esc(fmtDay(h.day, { weekday: "long", day: "numeric", month: "short" })) +
    '</span><button type="button" class="link" data-unwear="' + esc(h.id) + '">Retirer</button></div><div class="h-thumbs">' +
    h.items.map((id) => byId.get(id)).filter((i) => i && !i.deleted).map((i) => thumb(i, "", "", ' title="' + esc(i.name) + '"')).join("") + "</div></div>"
  ).join("") : '<p class="empty">Les tenues que tu portes apparaîtront ici quand tu appuies sur « Je la porte ».</p>';
  hydratePhotos($("history"));
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
  const missingCats = [["haut", "un haut"], ["bas", "un bas"], ["chaussures", "des chaussures"], ["veste", "une veste"]].filter(([c]) => !all.some((i) => i.cat === c)).map(([, l]) => l);
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
  const { total, gaps } = suggestGaps(all);
  gp.innerHTML = '<div class="outfit-head"><span class="label">Pour plus de tenues</span><span class="progress">' + (total >= 2000 ? "2000+" : total) + " tenue" + (total > 1 ? "s" : "") + " possibles</span></div>" +
    (gaps.length ? '<ul class="gap-list">' + gaps.map((g) => '<li><span>Ajoute <strong>' + esc(g.label) + "</strong></span><span class=\"gain\">+" + g.gain + (g.cat === "veste" ? " tenues couvertes" : " tenues") + "</span></li>").join("") + "</ul>" +
      '<p class="note small">D\'après ce que tu as déjà : couleurs, saisons et occasions qui vont ensemble. Utile avant les soldes.</p>'
      : '<p class="note">Ton dressing est bien équilibré : aucune pièce de base n\'ajouterait beaucoup de tenues.</p>');
  gp.hidden = false;
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
const SINGLE = { bas: 1, robe: 1, veste: 1, chaussures: 1, haut: 2, accessoire: 4 };
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
  $("wd-pieces").hidden = which !== "pieces";
  $("wd-outfits").hidden = which !== "outfits";
  $("wd-tab-pieces").setAttribute("aria-pressed", which === "pieces");
  $("wd-tab-outfits").setAttribute("aria-pressed", which === "outfits");
}

// ---------------- QUE PORTER AVEC ----------------
let withResults = [];
function openWith(item) {
  let c = context();
  const occNote = (item.occ || []).includes(c.occ) ? "" : (item.occ || [])[0];
  if (occNote) c = { ...c, occ: occNote };
  withResults = suggestMany({ items: liveItems(), feedback: data().feedback }, c, 4, { must: item });
  const occLabel = (OCCS.find((o) => o.id === c.occ) || {}).label || "";
  $("with-sheet").innerHTML = '<div class="sheet-head"><div><span class="label">Que porter avec</span><h2>' + esc(item.name) + '</h2></div><button class="x" type="button" data-wa="close" aria-label="Fermer">✕</button></div>' +
    '<p class="note">' + (weather[dayOffset] ? "Pour la météo " + (dayOffset === 0 ? "d'aujourd'hui" : "de demain") : "Pour la saison") + " · " + esc(occLabel) + (item.dirty ? " · attention, cette pièce est au sale" : "") + "</p>" +
    (withResults.length ? '<div class="with-grid">' + withResults.map((r, i) =>
      '<div class="with-item">' + flatlay(r.pieces, true) + '<span class="piece-meta">' + esc(r.pieces.filter((p) => p.id !== item.id && p.cat !== "accessoire").map((p) => p.name).join(" · ")) + "</span>" +
      '<div class="actions"><button class="btn small-btn" type="button" data-wa="keep" data-i="' + i + '">Garder</button><button class="btn primary small-btn" type="button" data-wa="wear" data-i="' + i + '">La porter</button></div></div>').join("") + "</div>"
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
        try { const cr = await removeBackground(e.blob); if (cr.ok) e.cutBlob = cr.blob; } catch (x) {}
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
  try { const cr = await removeBackground(e.blob); if (cr.ok) { e.cutBlob = cr.blob; URL.revokeObjectURL(e.url); e.url = URL.createObjectURL(cr.blob); } } catch (x) {}
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
  $("item-title").textContent = it ? "Modifier" : "Nouveau vêtement";
  $("f-name").value = draft.name;
  $("f-brand").value = draft.brand || ""; $("f-size").value = draft.size || "";
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
  let r;
  try { r = await removeBackground(blob); } catch (e) { r = { ok: false }; }
  d.cutBusy = false;
  if (draft !== d) return; // fiche fermée entre-temps
  if (r.ok) {
    d.cutBlob = r.blob; d.cutUrl = URL.createObjectURL(r.blob); d.useCut = true;
    $("photo-status").textContent = "Vêtement détouré. Si le résultat ne te plaît pas, choisis « Photo entière ».";
  } else {
    d.useCut = false;
    $("photo-status").textContent = "Fond trop chargé ou trop proche du vêtement : photo gardée entière. Astuce : pose le vêtement à plat sur un drap ou un sol uni, de couleur différente, sans qu'il touche les bords.";
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
      cut, seasons: draft.seasons, rain: draft.rain, occ: draft.occ, dirty: !!draft.dirty, dirtyAt: draft.dirty ? (editing && editing.dirty && editing.dirtyAt) || Date.now() : null, photo,
      brand: $("f-brand").value.trim() || null, size: $("f-size").value.trim() || null,
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
    toast(wasEditing ? "Modifié." : item.name + " ajouté au dressing.");
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
  delegate("occ-chips", "o", (o) => { occOverride[dayStr(dayOffset)] = o; renderControls(); newSuggestion(true); });
  delegate("mood-chips", "m", (m) => { mood = m; renderControls(); newSuggestion(true); });

  on("btn-other", "click", () => newSuggestion(false));
  on("btn-wear", "click", wearCurrent);
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
    toast("Noté : cette tenue ne te sera plus proposée.");
    newSuggestion(false);
  });
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
  delegate("history", "unwear", (id) => {
    if (isDemo()) return;
    sync.change((d) => { const h = d.history.find((x) => x.id === id); if (h) { h.deleted = true; h.t = Date.now(); } });
    toast("Retiré de l'historique.");
  });
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
