// Styliste IA : demande une tenue à Claude à partir du dressing (texte seulement, aucune photo).
import { COLORS, CATS, OCCS, SEASONS } from "./catalog.js";
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
    label(CATS, it.cat).toLowerCase(),
    (COLORS[it.color] || ["?"])[0].toLowerCase(),
    it.pattern === "motif" ? "à motif" : "uni",
    ["", "léger", "épaisseur moyenne", "chaud"][it.warmth || 2],
    it.material ? label(MATERIALS, it.material).toLowerCase() : null,
    (it.styles || []).length ? "style " + it.styles.map((s) => label(STYLE_TAGS, s).toLowerCase()).join("/") : null,
    "saisons " + (it.seasons || []).map((s) => label(SEASONS, s).toLowerCase()).join("/"),
    "occasions " + (it.occ || []).map((o) => label(OCCS, o).toLowerCase()).join("/"),
    it.rain === "impermeable" ? "imperméable" : it.rain === "fragile" ? "craint la pluie" : null,
    d === null ? "jamais porté" : d <= 0 ? "porté aujourd'hui" : "porté il y a " + d + " j"
  ].filter(Boolean);
  return `- [${it.id}] ${it.name} : ${parts.join(", ")}`;
}

/**
 * Demande une tenue. Renvoie {ids, title, why:[], tip}.
 */
export async function askStylist(key, { items, ctx, weather, prefs, liked, disliked, current }) {
  const clean = items.filter((i) => !i.dirty);
  const styleNames = STYLES.filter((s) => (prefs.styles || []).includes(s.id));
  const w = ctx.w;
  const weatherText = weather
    ? `ressenti ${Math.round(weather.morning.feels)}° à 8 h et ${Math.round(weather.afternoon.feels)}° à 15 h, ${weather.sky.toLowerCase()}, pluie ${weather.rainProb} %, vent ${weather.wind} km/h${weather.snow ? ", neige" : ""}`
    : `environ ${w.morning}° le matin et ${w.afternoon}° l'après-midi${w.rain ? ", pluie" : ""} (réglage manuel)`;

  const system = [
    "Tu es une styliste personnelle française, précise et bienveillante.",
    "Tu composes UNE tenue complète uniquement avec les pièces listées (identifiants entre crochets), jamais avec des pièces inventées.",
    "Une tenue = un haut et un bas, ou une robe ; des chaussures s'il y en a ; une veste ou un manteau si la météo le demande. Tu peux superposer deux hauts (ex. chemise sous un pull).",
    "Respecte la météo, l'occasion, la saison et évite les pièces portées ces derniers jours.",
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
