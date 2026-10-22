// Styliste IA : demande une tenue à Claude à partir du dressing (texte seulement, aucune photo).
import { COLORS, CATS, OCCS, SEASONS, ACC_TYPES } from "./catalog.js";
import { STYLES, STYLE_TAGS, MATERIALS } from "./styles.js";
import { daysBetween } from "./engine.js";

export const AI_MODEL = "claude-sonnet-5-5";

export class AiError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function call(key, body) {
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    });
  } catch (e) { throw new AiError("network", "Pas de connexion"); }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) {}
    const kind = res.status === 401 ? "auth" : res.status === 429 ? "rate" : res.status === 400 && /credit|billing/i.test(msg) ? "credit" : res.status === 529 || res.status >= 500 ? "busy" : "other";
    throw new AiError(kind, msg);
  }
  return res.json();
}

export async function testKey(key) {
  await call(key, { model: AI_MODEL, max_tokens: 5, messages: [{ role: "user", content: "Réponds juste OK." }] });
}

const label = (list, id) => (list.find((x) => x.id === id) || {}).label || id;

function describeItem(it, day) {
  const d = daysBetween(it.lastWorn, day);
  const parts = [
    it.cat === "accessoire" ? "accessoire (" + label(ACC_TYPES, it.acc || "sac").toLowerCase() + ")" : label(CATS, it.cat).toLowerCase(),
    (COLORS[it.color] || ["?"])[0].toLowerCase(),
    it.pattern === "motif" ? "à motif" : "uni",
    ["", "léger", "épaisseur moyenne", "chaud"][it.warmth || 2],
    it.material ? label(MATERIALS, it.material).toLowerCase() : null,
    (it.styles || []).length ? "style " + it.styles.map((s) => label(STYLE_TAGS, s).toLowerCase()).join("/") : null,
    "saisons " + (it.seasons || []).map((s) => label(SEASONS, s).toLowerCase()).join("/"),
    "occasions " + (it.occ || []).map((o) => label(OCCS, o).toLowerCase()).join("/"),
    it.rain === "impermeable" ? "imperméable" : it.rain === "fragile" ? "craint la pluie" : null,
    it.brand ? "marque " + it.brand : null,
        d === null ? "jamais porté" : d <= 0 ? "porté aujourd'hui" : "porté il y a " + d + " j"
  ].filter(Boolean);
  return `- [${it.id}] ${it.name} : ${parts.join(", ")}`;
}

/**
 * Demande une tenue. Renvoie {ids, title, why:[], tip}.
 */
export async function askStylist(key, { items, ctx, weather, prefs, liked, disliked, current }) {
  const homeOnly = (i) => (i.occ || []).length > 0 && i.occ.every((o) => o === "maison");
  const clean = items.filter((i) => !i.dirty && (ctx.occ === "maison" || !homeOnly(i)));
  const styleNames = STYLES.filter((s) => (prefs.styles || []).includes(s.id));
  const w = ctx.w;
  const weatherText = weather
    ? `ressenti ${Math.round(weather.morning.feels)}° à 8 h et ${Math.round(weather.afternoon.feels)}° à 15 h, ${weather.sky.toLowerCase()}, pluie ${weather.rainProb} %, vent ${weather.wind} km/h${weather.snow ? ", neige" : ""}`
    : `environ ${w.morning}° le matin et ${w.afternoon}° l'après-midi${w.rain ? ", pluie" : ""} (réglage manuel)`;

  const system = [
    "Tu es une styliste personnelle française, précise et bienveillante.",
    "Tu composes UNE tenue complète uniquement avec les pièces listées (identifiants entre crochets), jamais avec des pièces inventées.",
    "Une tenue = un haut et un bas, ou une robe ; des chaussures s'il y en a ; une veste ou un manteau si la météo le demande. Tu peux superposer deux hauts (ex. chemise sous un pull).",
    "Ajoute un à trois accessoires listés (sac, écharpe, bonnet, ceinture, bijou…) quand ils complètent bien la tenue ou que le froid les demande.",
    "Respecte la météo, l'occasion, la saison et évite les pièces portées ces derniers jours.",
    "L'occasion « maison / travaux » désigne une tenue pour rester chez soi ou bricoler : confort avant tout, pièces de maison (pilou, vieux jean, sweat) bienvenues, pas besoin de manteau ni de style.",
    "Inspire-toi fortement des styles et créatrices aimés : explique en quoi la tenue leur ressemble, concrètement.",
    "Réponds en JSON strict, sans texte autour, au format :",
    '{"pieces":["id1","id2"],"titre":"4 à 6 mots","pourquoi":["phrase courte","phrase courte","phrase courte"],"conseil":"une astuce de portage (rentrer la chemise, retrousser, accessoire déjà évoqué…) ou chaîne vide"}'
  ].join("\n");

  const user = [
    `Jour : ${new Date(ctx.day + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} (${label(SEASONS, ctx.season).toLowerCase()}).`,
    `Météo : ${weatherText}.`,
    `Occasion : ${label(OCCS, ctx.occ).toLowerCase()}${ctx.important ? ", jour important" : ""}${ctx.agenda && ctx.agenda.note ? " (" + ctx.agenda.note + ")" : ""}.`,
    ctx.mood ? `Envie du jour : ${ctx.mood === "couleur" ? "de la couleur" : ctx.mood}.` : "",
    styleNames.length ? "Styles et créatrices aimés :\n" + styleNames.map((s) => `- ${s.hint}`).join("\n") : "Aucun style précisé.",
    prefs.note ? `En ses mots : « ${prefs.note} »` : "",
    liked.length ? "Tenues déjà aimées :\n" + liked.slice(0, 6).map((l) => "- " + l).join("\n") : "",
    disliked.length ? "Tenues refusées (à ne pas reproposer) :\n" + disliked.slice(0, 6).map((l) => "- " + l).join("\n") : "",
    current ? `L'appli proposait déjà : ${current}. Propose autre chose si tu peux faire mieux, sinon améliore-la.` : "",
    "Pièces disponibles (propres) :",
    clean.map((it) => describeItem(it, ctx.day)).join("\n")
  ].filter(Boolean).join("\n\n");

  const j = await call(key, { model: AI_MODEL, max_tokens: 900, system, messages: [{ role: "user", content: user }] });
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new AiError("format", "Réponse illisible");
  let out;
  try { out = JSON.parse(m[0]); } catch (e) { throw new AiError("format", "Réponse illisible"); }
  const valid = new Set(clean.map((i) => i.id));
  const ids = [...new Set((out.pieces || []).map(String))].filter((id) => valid.has(id));
  if (!ids.length) throw new AiError("format", "Aucune pièce reconnue");
  return {
    ids,
    title: String(out.titre || "La proposition de la styliste"),
    why: (Array.isArray(out.pourquoi) ? out.pourquoi : [out.pourquoi]).filter(Boolean).map(String).slice(0, 5),
    tip: out.conseil ? String(out.conseil) : ""
  };
}

// ---------------- reconnaissance par photo ----------------
async function toJpegB64(blob, max = 900) {
  const bmp = window.createImageBitmap ? await createImageBitmap(blob) : await new Promise((res, rej) => { const u = URL.createObjectURL(blob); const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); // fond blanc sous une photo détourée
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const out = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
  const buf = new Uint8Array(await out.arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function askVision(key, blob, system, text, { maxTokens = 700, size = 900 } = {}) {
  const data = await toJpegB64(blob, size);
  const j = await call(key, {
    model: AI_MODEL, max_tokens: maxTokens, system,
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }, { type: "text", text }] }]
  });
  const t = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new AiError("format", "Réponse illisible");
  try { return JSON.parse(m[0]); } catch (e) { throw new AiError("format", "Réponse illisible"); }
}

const ids = (list) => list.map((x) => x.id).join(", ");

/** Reconnaît un vêtement sur une photo et remplit la fiche. */
export async function recognizeItem(key, blob) {
  const system = "Tu catalogues des vêtements pour un dressing en ligne. Tu réponds uniquement en JSON strict, en français, sans texte autour.";
  const text = [
    "Décris ce vêtement (ou accessoire) photographié.",
    "Réponds avec ce JSON, en utilisant UNIQUEMENT les valeurs proposées entre crochets :",
    "{",
    '"nom": "nom court et précis, 2 à 5 mots, ex. « Cardigan en grosse maille écru »",',
    `"categorie": [${ids(CATS)}],`,
    `"accessoire": [${ids(ACC_TYPES)}] ou null,`,
    `"couleur": [${Object.keys(COLORS).join(", ")}],`,
    '"motif": ["uni", "motif"],',
    `"matiere": [${ids(MATERIALS)}] ou null,`,
    '"epaisseur": [1 = léger, 2 = moyen, 3 = chaud],',
    `"saisons": liste parmi [${ids(SEASONS)}],`,
    `"occasions": liste parmi [${ids(OCCS)}],`,
    `"styles": liste de 0 à 2 parmi [${ids(STYLE_TAGS)}],`,
    '"pluie": ["normal", "impermeable", "fragile"] (fragile = daim, soie, toile claire…),',
    '"marque": la marque seulement si un logo ou une étiquette est lisible sur la photo, sinon null',
    "}",
    "Si la photo ne montre pas un vêtement, réponds {\"erreur\": \"pas un vêtement\"}."
  ].join("\n");
  const r = await askVision(key, blob, system, text);
  if (r.erreur) throw new AiError("notcloth", r.erreur);
  return normalizeItem(r);
}

function normalizeItem(r) {
  const one = (v, list) => (list.some((x) => (x.id ?? x) === v) ? v : null);
  const many = (v, list) => (Array.isArray(v) ? v.filter((x) => list.some((y) => y.id === x)) : []);
  return {
    name: typeof r.nom === "string" ? r.nom.slice(0, 60) : "",
    cat: one(r.categorie, CATS),
    acc: one(r.accessoire, ACC_TYPES),
    color: Object.keys(COLORS).includes(r.couleur) ? r.couleur : null,
    pattern: r.motif === "motif" ? "motif" : r.motif === "uni" ? "uni" : null,
    material: one(r.matiere, MATERIALS),
    warmth: [1, 2, 3].includes(+r.epaisseur) ? +r.epaisseur : null,
    seasons: many(r.saisons, SEASONS),
    occ: many(r.occasions, OCCS),
    styles: many(r.styles, STYLE_TAGS).slice(0, 2),
    rain: ["normal", "impermeable", "fragile"].includes(r.pluie) ? r.pluie : null,
    brand: typeof r.marque === "string" && r.marque.trim() ? r.marque.trim().slice(0, 40) : null
  };
}

/** Lit une étiquette : marque, taille, composition, entretien. */
export async function readLabel(key, blob) {
  const system = "Tu lis des étiquettes de vêtements. Tu réponds uniquement en JSON strict, en français, sans texte autour. Tu n'inventes rien : ce qui n'est pas lisible vaut null.";
  const text = [
    "Lis cette étiquette de vêtement et réponds avec ce JSON :",
    "{",
    '"marque": "nom de la marque" ou null,',
    '"taille": "taille telle qu\'écrite (ex. M, 38, 42 EU)" ou null,',
    '"composition": [{"matiere": "laine", "pourcentage": 70}, …] (traduire en français, matière principale d\'abord) ou [],',
    '"entretien": ["Lavage à 30°", "Pas de sèche-linge", …] (traduire les symboles en phrases courtes) ou []',
    "}",
    "Si ce n'est pas une étiquette lisible, réponds {\"erreur\": \"étiquette illisible\"}."
  ].join("\n");
  const r = await askVision(key, blob, system, text);
  if (r.erreur) throw new AiError("unreadable", r.erreur);
  const comp = Array.isArray(r.composition) ? r.composition.filter((c) => c && c.matiere).map((c) => ({ m: String(c.matiere).toLowerCase(), p: +c.pourcentage || null })) : [];
  return {
    brand: typeof r.marque === "string" && r.marque.trim() ? r.marque.trim().slice(0, 40) : null,
    size: typeof r.taille === "string" && r.taille.trim() ? r.taille.trim().slice(0, 20) : null,
    composition: comp,
    care: Array.isArray(r.entretien) ? r.entretien.filter((x) => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 8) : []
  };
}

/** Composition → matière de la fiche + épaisseur conseillée. */
export function materialFromComposition(comp) {
  if (!comp || !comp.length) return {};
  const main = comp[0].m;
  const map = [["cachemire", "maille"], ["mohair", "maille"], ["alpaga", "maille"], ["laine", "laine"], ["lin", "lin"], ["soie", "soie"], ["cuir", "cuir"], ["daim", "daim"], ["velours", "velours"], ["coton", "coton"], ["polyester", "technique"], ["polyamide", "technique"], ["nylon", "technique"], ["élasthanne", "technique"], ["viscose", "soie"]];
  const hit = map.find(([w]) => main.includes(w));
  const wool = comp.filter((c) => /laine|cachemire|mohair|alpaga/.test(c.m)).reduce((a, c) => a + (c.p || 0), 0);
  return { material: hit ? hit[1] : null, warmth: wool >= 50 ? 3 : main.includes("lin") ? 1 : null };
}

/** Plusieurs vêtements sur une même photo (penderie, pile, lit) : liste + position de chacun. */
export async function detectMany(key, blob) {
  const system = "Tu catalogues des vêtements pour un dressing en ligne. Tu réponds uniquement en JSON strict, en français, sans texte autour.";
  const text = [
    "Liste TOUS les vêtements et accessoires distincts visibles sur cette photo (penderie, pile ou vêtements étalés), au maximum 30.",
    "Ignore les cintres, meubles, personnes et objets qui ne sont pas des vêtements. Ne compte pas deux fois la même pièce.",
    "Pour chaque pièce, donne sa position dans l'image : \"boite\": [gauche, haut, droite, bas] en millièmes de la largeur et de la hauteur (0 à 1000), en englobant la partie visible de la pièce.",
    "Réponds avec ce JSON :",
    '{"pieces": [{',
    '"boite": [g, h, d, b],',
    '"nom": "nom court et précis, 2 à 5 mots",',
    `"categorie": [${ids(CATS)}], "accessoire": [${ids(ACC_TYPES)}] ou null,`,
    `"couleur": [${Object.keys(COLORS).join(", ")}], "motif": ["uni", "motif"],`,
    `"matiere": [${ids(MATERIALS)}] ou null, "epaisseur": 1 | 2 | 3,`,
    `"saisons": [${ids(SEASONS)}], "occasions": [${ids(OCCS)}], "styles": 0 à 2 parmi [${ids(STYLE_TAGS)}],`,
    '"pluie": "normal" | "impermeable" | "fragile", "marque": si lisible sinon null',
    "}]}",
    "Si aucun vêtement n'est visible, réponds {\"pieces\": []}."
  ].join("\n");
  const r = await askVision(key, blob, system, text, { maxTokens: 6000, size: 1400 });
  const list = Array.isArray(r.pieces) ? r.pieces : [];
  return list.slice(0, 30).map((p) => {
    const b = Array.isArray(p.boite) && p.boite.length === 4 ? p.boite.map((v) => Math.max(0, Math.min(1000, +v || 0)) / 1000) : null;
    const box = b && b[2] > b[0] && b[3] > b[1] ? b : null;
    return { ...normalizeItem(p), box };
  }).filter((x) => x.name || x.cat);
}
