// Ce qui manque au dressing : quelles pièces ajouteraient le plus de tenues possibles.
import { COLORS } from "./catalog.js";

const ALL = ["printemps", "ete", "automne", "hiver"];
const MID = ["printemps", "automne", "hiver"];
const WARM = ["automne", "hiver"];
const LIGHT = ["printemps", "ete"];
const DAY = ["quotidien", "travail"];

// pièces de base qu'on retrouve dans la plupart des dressings
const CANDIDATES = [
  { label: "un t-shirt blanc", cat: "haut", color: "blanc", seasons: ALL, occ: ["quotidien"] },
  { label: "une chemise blanche", cat: "haut", color: "blanc", seasons: ALL, occ: DAY.concat("soiree") },
  { label: "une chemise bleu ciel", cat: "haut", color: "bleu", seasons: ALL, occ: DAY },
  { label: "un pull marine", cat: "haut", color: "marine", seasons: WARM, occ: DAY },
  { label: "un pull gris", cat: "haut", color: "gris", seasons: WARM, occ: DAY },
  { label: "un pull écru", cat: "haut", color: "ecru", seasons: WARM, occ: DAY },
  { label: "un haut noir", cat: "haut", color: "noir", seasons: ALL, occ: DAY.concat("soiree") },
  { label: "une marinière", cat: "haut", color: "marine", pattern: "motif", seasons: MID, occ: ["quotidien"] },
  { label: "un jean brut", cat: "bas", color: "denim", seasons: ALL, occ: ["quotidien", "soiree"] },
  { label: "un pantalon beige", cat: "bas", color: "beige", seasons: ALL, occ: DAY },
  { label: "un pantalon noir", cat: "bas", color: "noir", seasons: ALL, occ: DAY.concat("soiree") },
  { label: "un pantalon marine", cat: "bas", color: "marine", seasons: ALL, occ: DAY },
  { label: "une jupe noire", cat: "bas", color: "noir", seasons: MID, occ: DAY.concat("soiree") },
  { label: "une robe noire", cat: "robe", color: "noir", seasons: MID, occ: ["travail", "soiree"] },
  { label: "des baskets blanches", cat: "chaussures", color: "blanc", seasons: ALL, occ: ["quotidien"] },
  { label: "des bottines noires", cat: "chaussures", color: "noir", seasons: WARM, occ: DAY.concat("soiree") },
  { label: "des mocassins marron", cat: "chaussures", color: "marron", seasons: MID, occ: DAY },
  { label: "des sandales", cat: "chaussures", color: "camel", seasons: LIGHT, occ: ["quotidien", "soiree"] },
  { label: "un trench beige", cat: "manteau", color: "beige", seasons: ["printemps", "automne"], occ: DAY, rain: "impermeable" },
  { label: "un manteau camel", cat: "manteau", color: "camel", seasons: WARM, occ: DAY.concat("soiree") },
  { label: "un blazer marine", cat: "veste", color: "marine", seasons: MID, occ: DAY.concat("soiree") }
];

const accent = (c) => COLORS[c] && !COLORS[c][2];

function compatible(pieces) {
  const acc = new Set(pieces.map((p) => p.color).filter(accent));
  if (acc.size > 1) return false;
  if (pieces.filter((p) => p.pattern === "motif").length > 1) return false;
  const seasonOk = ALL.some((s) => pieces.every((p) => !(p.seasons && p.seasons.length) || p.seasons.includes(s)));
  if (!seasonOk) return false;
  const occs = ["quotidien", "travail", "soiree", "sport"];
  return occs.some((o) => pieces.every((p) => !(p.occ && p.occ.length) || p.occ.includes(o)));
}

/** Nombre de tenues (haut + bas ou robe, + chaussures) qui tiennent la route. Plafonné pour rester rapide. */
export function countOutfits(items, cap = 2000) {
  const ok = items.filter((i) => !i.deleted && !(i.occ && i.occ.length && i.occ.every((o) => o === "maison")));
  const by = (c) => ok.filter((i) => i.cat === c);
  const tops = by("haut"), bottoms = by("bas"), dresses = by("robe"), shoes = by("chaussures");
  const bases = [];
  for (const t of tops) for (const b of bottoms) if (compatible([t, b])) bases.push([t, b]);
  for (const d of dresses) bases.push([d]);
  let n = 0;
  for (const base of bases) {
    if (!shoes.length) { n++; continue; }
    for (const s of shoes) { if (compatible(base.concat(s))) n++; if (n >= cap) return n; }
  }
  return n;
}

/** Les pièces qui ajouteraient le plus de tenues. */
export function suggestGaps(items, max = 3, seasons = null) {
  const live = items.filter((i) => !i.deleted && !i.stored);
  const base = countOutfits(live);
  const owned = (c) => live.some((i) => i.cat === c.cat && i.color === c.color && (i.pattern || "uni") === (c.pattern || "uni"));
  const res = [];
  for (const c of CANDIDATES) {
    if (owned(c)) continue;
    // pas de sandales à conseiller en octobre : seulement ce qui sert maintenant ou bientôt
    if (seasons && c.seasons && !c.seasons.some((x) => seasons.includes(x))) continue;
    const fake = { id: "gap", name: c.label, cat: c.cat, color: c.color, pattern: c.pattern || "uni", seasons: c.seasons, occ: c.occ };
    let gain;
    if (c.cat === "veste" || c.cat === "manteau") {
      // une veste ne crée pas de tenue, elle en couvre : on compte les tenues qu'elle accompagne bien
      const tops = live.filter((i) => i.cat === "haut"), bottoms = live.filter((i) => i.cat === "bas");
      gain = 0;
      for (const t of tops) for (const b of bottoms) if (compatible([t, b, fake])) gain++;
      const jackets = live.filter((i) => i.cat === c.cat).length;
      gain = Math.round(gain / (jackets + 1)); // moins utile si on a déjà des vestes
    } else gain = countOutfits(live.concat(fake)) - base;
    if (gain > 0) res.push({ ...c, gain });
  }
  res.sort((a, b) => b.gain - a.gain);
  // pas trois pièces de la même catégorie
  const out = [], perCat = {};
  for (const r of res) { if ((perCat[r.cat] || 0) >= 1) continue; perCat[r.cat] = 1; out.push(r); if (out.length >= max) break; }
  return { total: base, gaps: out };
}

export const MILESTONES = [
  { n: 10, msg: "les premières tenues apparaissent" },
  { n: 25, msg: "les tenues commencent à varier" },
  { n: 40, msg: "un vrai dressing : de quoi tenir deux semaines sans répéter" },
  { n: 60, msg: "toutes les saisons sont couvertes" },
  { n: 100, msg: "dressing complet" }
];
