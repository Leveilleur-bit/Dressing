// Choix de la tenue : on génère des combinaisons et on garde les mieux notées.
import { COLORS, CATS, ACC_TYPES } from "./catalog.js";
import { styleScore, STYLES } from "./styles.js";

export function seasonOf(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const m = d.getMonth() + 1, day = d.getDate();
  const md = m * 100 + day;
  if (md >= 321 && md < 621) return "printemps";
  if (md >= 621 && md < 923) return "ete";
  if (md >= 923 && md < 1221) return "automne";
  return "hiver";
}

/** Épaisseur visée selon la température ressentie */
export function warmthFor(feels) {
  if (feels == null) return 2;
  if (feels < 9) return 3;
  if (feels < 19) return 2;
  return 1;
}

export function daysBetween(fromIso, toDay) {
  if (!fromIso) return null;
  const a = new Date(fromIso.slice(0, 10) + "T12:00:00");
  const b = new Date(toDay + "T12:00:00");
  return Math.round((b - a) / 864e5);
}

export const comboKey = (pieces) => pieces.map((p) => p.id).sort().join("|");

/**
 * ctx : {day, season, occ, mood, important, restDays,
 *        w: {morning, afternoon, rain, wind, snow}}  (températures ressenties)
 * data : {items, feedback}
 */
export function suggest(data, ctx, avoidKeys, opts = {}) {
  const home = ctx.occ === "maison";
  // une pièce réservée à la maison ne sort jamais
  const homeOnly = (i) => (i.occ || []).length > 0 && i.occ.every((o) => o === "maison");
  const all = data.items.filter((i) => !i.deleted && !i.dirty && (home || !homeOnly(i)));
  const items = all.filter((i) => i.cat !== "accessoire");
  const accessories = all.filter((i) => i.cat === "accessoire");
  const fb = data.feedback || {};
  const disliked = new Set(Object.keys(fb).filter((k) => fb[k].v === -1));
  const liked = new Set(Object.keys(fb).filter((k) => fb[k].v === 1));

  // apprentissage par paires : une paire présente dans des tenues aimées / refusées
  const pairScore = new Map();
  for (const k of Object.keys(fb)) {
    if (!fb[k].v) continue;
    const ids = k.split("|");
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const pk = ids[i] < ids[j] ? ids[i] + "|" + ids[j] : ids[j] + "|" + ids[i];
      pairScore.set(pk, (pairScore.get(pk) || 0) + fb[k].v);
    }
  }

  // à la maison, on compte sur le chauffage : ressenti ramené entre 13 et 24°, pas de pluie
  const w = home ? { ...ctx.w, morning: Math.min(24, Math.max(13, ctx.w.morning)), afternoon: Math.min(24, Math.max(13, ctx.w.afternoon ?? ctx.w.morning)), rain: false, snow: false, wind: 0 } : ctx.w;
  const cold = w.morning;               // ressenti du matin
  const warm = w.afternoon ?? w.morning; // ressenti de l'après-midi
  const swing = warm - cold;
  const layered = swing >= 7;
  // la base (haut/bas) suit l'après-midi quand il y a un gros écart, la veste couvre le matin
  const baseTarget = warmthFor(layered ? (cold + warm) / 2 + 2 : (cold + warm) / 2);
  const needJacket = !home && (cold < 15 || w.rain || w.snow);
  const allowJacket = home ? cold < 16 : needJacket || cold < 21 || w.wind >= 35;

  const by = (c) => items.filter((i) => i.cat === c);
  const tops = by("haut"), bottoms = by("bas"), dresses = by("robe"), jackets = by("veste"), shoes = by("chaussures");

  const bases = [];
  tops.forEach((t) => bottoms.forEach((b) => bases.push([t, b])));
  dresses.forEach((d) => bases.push([d]));
  if (!bases.length) { tops.forEach((t) => bases.push([t])); bottoms.forEach((b) => bases.push([b])); }
  if (!bases.length) return null;

  const restDays = ctx.restDays ?? 3;

  const itemScore = (it) => {
    let s = 0;
    const wm = it.warmth || 2;
    if (it.cat === "veste") s -= 1.2 * Math.abs(wm - warmthFor(cold));
    else if (it.cat === "chaussures") {
      if (w.rain || w.snow || cold < 6) s += wm >= 2 ? 1 : -2;
      else if (warm > 24) s += wm <= 2 ? 1 : -2;
    } else s -= (home ? 0.8 : 1.8) * Math.abs(wm - baseTarget);

    // saison
    if (it.seasons && it.seasons.length) s += it.seasons.includes(ctx.season) ? 1 : -4;

    // occasion
    s += (it.occ || []).includes(ctx.occ) ? (home ? 3 : 2) : home ? -5 : -3.5;

    // pluie
    if (w.rain || w.snow) {
      if (it.rain === "fragile") s -= 5;
      if (it.rain === "impermeable" && (it.cat === "veste" || it.cat === "chaussures")) s += 2.5;
    }

    // humeur / importance
    const o = it.occ || [];
    if (ctx.mood === "confort") { if (o.includes("quotidien") || o.includes("sport")) s += 1.2; if (o.includes("soiree") && !o.includes("quotidien")) s -= 1.2; }
    if (ctx.mood === "classe" || ctx.important) { if (o.includes("travail") || o.includes("soiree")) s += 1.5; if (o.includes("sport")) s -= 3; }

    // rotation (désactivée pour la valise : on réutilise volontiers)
    if (!opts.noRotation) {
      const d = daysBetween(it.lastWorn, ctx.day);
      if (d !== null && d < restDays) s -= 4 + (restDays - d);
      else s += Math.min(d === null ? 21 : d, 21) * 0.12;
    }
    // valise : réutiliser ce qui est déjà dans la valise, éviter de remettre la même chose deux jours de suite
    // (un bas ou une veste se remettent facilement, un haut beaucoup moins)
    if (opts.packed && opts.packed.has(it.id)) s += { chaussures: 4, veste: 4, bas: 3, haut: 1.5, robe: 1.5 }[it.cat] || 2;
    if (opts.prev && opts.prev.has(it.id)) s -= { haut: 6, robe: 6, bas: 2 }[it.cat] || 0;
    return s;
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const combos = new Map();
  const tries = Math.min(900, bases.length * Math.max(1, shoes.length) * (jackets.length + 1) * 3);
  for (let i = 0; i < tries; i++) {
    const pieces = pick(bases).slice();
    if (allowJacket && jackets.length && (needJacket || Math.random() < 0.4)) pieces.unshift(pick(jackets));
    if (shoes.length) pieces.push(pick(shoes));
    const key = comboKey(pieces);
    if (combos.has(key) || disliked.has(key)) continue;
    let s = pieces.reduce((a, p) => a + itemScore(p), 0);

    // couleurs : une couleur vive au plus sur une base neutre
    const accents = new Set(pieces.map((p) => p.color).filter((c) => COLORS[c] && !COLORS[c][2]));
    if (accents.size === 1) s += ctx.mood === "couleur" ? 3 : 1;
    if (accents.size === 0 && ctx.mood === "couleur") s -= 2.5;
    if (accents.size > 1) s -= 2.5 * (accents.size - 1);

    // motifs : un seul à la fois
    const motifs = pieces.filter((p) => p.pattern === "motif").length;
    if (motifs > 1) s -= 4 * (motifs - 1);

    // couches
    const hasJacket = pieces.some((p) => p.cat === "veste");
    if (needJacket && !hasJacket) s -= 4;
    if (w.wind >= 40 && pieces.some((p) => p.cat === "robe" && (p.warmth || 2) === 1)) s -= 2;
    if (pieces.some((p) => p.cat === "robe") && cold < 5) s -= 1.5;

    // goûts appris
    const st = home ? { score: 0, reasons: [] } : styleScore(pieces, ctx.styles || [], COLORS);
    s += st.score;

    if (liked.has(key)) s += 3;
    for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
      const x = pieces[a].id, y = pieces[b].id;
      const ps = pairScore.get(x < y ? x + "|" + y : y + "|" + x);
      if (ps) s += Math.max(-4, Math.min(4, ps * 1.2));
    }
    combos.set(key, { key, pieces, score: s, style: st });
  }

  const ranked = [...combos.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const fresh = ranked.filter((c) => !avoidKeys.includes(c.key));
  const cands = fresh.length ? fresh : ranked;
  // on varie seulement entre des tenues presque aussi bonnes que la meilleure
  const pool = cands.slice(0, 3).filter((c) => c.score >= cands[0].score - 3);
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const acc = home ? { pieces: [], reasons: [] } : pickAccessories(accessories, chosen.pieces, ctx, w, opts);
  const reasons = explain(chosen, ctx, { needJacket, layered, liked, pairScore });
  const popAcc = acc.pieces.some((a) => COLORS[a.color] && !COLORS[a.color][2]);
  const base = popAcc ? reasons.filter((r) => !r.startsWith("Tout en tons neutres")) : reasons;
  return { ...chosen, pieces: chosen.pieces.concat(acc.pieces), reasons: base.concat(acc.reasons) };
}

/** Ajoute 0 à 3 accessoires qui vont avec la tenue. */
function pickAccessories(accs, pieces, ctx, w, opts) {
  if (!accs.length) return { pieces: [], reasons: [] };
  const cold = w.morning, warm = w.afternoon ?? w.morning;
  const accents = new Set(pieces.map((p) => p.color).filter((c) => COLORS[c] && !COLORS[c][2]));
  const score = (a) => {
    let s = Math.random() * 0.6;
    s += (a.occ || []).includes(ctx.occ) ? 2 : -3;
    if (a.seasons && a.seasons.length) s += a.seasons.includes(ctx.season) ? 0.5 : -3;
    const neutral = COLORS[a.color] && COLORS[a.color][2];
    if (neutral) s += 0.5;
    else if (accents.has(a.color)) s += 1.5;
    else if (accents.size === 0) s += ctx.mood === "couleur" ? 2 : 0.5;
    else s -= 3;
    if (a.pattern === "motif" && pieces.some((p) => p.pattern === "motif")) s -= 3;
    if ((w.rain || w.snow) && a.rain === "fragile") s -= 5;
    if (!opts.noRotation) { const d = daysBetween(a.lastWorn, ctx.day); if (d !== null && d < 1) s -= 1; }
    if (opts.packed && opts.packed.has(a.id)) s += 2;
    return s;
  };
  const best = (type) => accs.filter((a) => a.acc === type).map((a) => ({ a, s: score(a) })).sort((x, y) => y.s - x.s)[0];
  const out = [], why = [];
  const warmNames = [];
  const want = { echarpe: cold < 10, bonnet: cold < 5 || (w.snow), gants: cold < 3 };
  for (const t of ["echarpe", "bonnet", "gants"]) {
    if (!want[t]) continue;
    const b = best(t); if (b && b.s > -3) { out.push(b.a); warmNames.push(b.a.name.toLowerCase()); }
  }
  if (warmNames.length) why.push(`Il fait ${Math.round(cold)}° ressentis le matin : ${warmNames.join(", ")}.`);
  const sunny = !w.rain && !w.snow && warm >= 22;
  if (sunny) {
    const l = best("lunettes"); if (l && l.s > -1) out.push(l.a);
    const h = accs.filter((a) => a.acc === "chapeau" && (a.warmth || 2) === 1).map((a) => ({ a, s: score(a) })).sort((x, y) => y.s - x.s)[0];
    if (h && h.s > 0) out.push(h.a);
  }
  const extras = ["sac", "ceinture", "bijou"].map(best).filter((b) => b && b.s > 0.5).sort((x, y) => y.s - x.s);
  for (const b of extras) {
    if (out.length >= 4) break;
    if (b.a.acc === "ceinture" && !pieces.some((p) => p.cat === "bas")) continue;
    out.push(b.a);
  }
  const pop = out.find((a) => COLORS[a.color] && !COLORS[a.color][2] && accents.size === 0);
  if (pop) why.push(`${pop.name} apporte la touche de couleur.`);
  return { pieces: out, reasons: why };
}

/**
 * Valise : une tenue par jour, en réutilisant au maximum les mêmes pièces.
 * days : [{day, season, occ, w}]  →  {outfits:[{day, pieces, reasons}], packed:[items]}
 */
export function planTrip(data, days, base) {
  const packed = new Set();
  const outfits = [];
  let prev = new Set();
  const avoid = [];
  for (const d of days) {
    const ctx = { ...base, ...d, restDays: 0 };
    const r = suggest(data, ctx, avoid, { noRotation: true, packed, prev });
    if (!r) { outfits.push({ day: d.day, pieces: [], reasons: [] }); continue; }
    r.pieces.forEach((p) => packed.add(p.id));
    prev = new Set(r.pieces.map((p) => p.id));
    avoid.push(r.key);
    outfits.push({ day: d.day, pieces: r.pieces, reasons: r.reasons });
  }
  const byId = new Map(data.items.map((i) => [i.id, i]));
  return { outfits, packed: [...packed].map((id) => byId.get(id)).filter(Boolean) };
}

function explain(c, ctx, info) {
  const out = [];
  const home = ctx.occ === "maison";
  const w = home ? { ...ctx.w, rain: false, snow: false, wind: 0 } : ctx.w;
  if (home) out.push("Tenue pour rester à la maison ou bricoler : on privilégie le confort.");
  const jacket = c.pieces.find((p) => p.cat === "veste");
  if (home) { /* pas de commentaire météo */ }
  else if (jacket && info.layered) out.push(`Gros écart dans la journée (${Math.round(w.morning)}° ressentis le matin, ${Math.round(w.afternoon)}° l'après-midi) : ${jacket.name.toLowerCase()} à enlever en route.`);
  else if (jacket && (w.rain || w.snow) && jacket.rain === "impermeable") out.push(`${jacket.name} : il protège de la ${w.snow ? "neige" : "pluie"}.`);
  else if (jacket && (w.rain || w.snow)) out.push(`Une veste pour la ${w.snow ? "neige" : "pluie"}.`);
  else if (jacket && info.needJacket) out.push(`Une couche en plus pour ${Math.round(w.morning)}° ressentis le matin.`);
  if (w.wind >= 40) out.push(`Vent fort annoncé (${Math.round(w.wind)} km/h).`);

  const pieces = c.pieces.filter((p) => p.cat !== "chaussures");
  const oldest = pieces.map((p) => ({ p, d: daysBetween(p.lastWorn, ctx.day) }))
    .sort((a, b) => (b.d ?? 999) - (a.d ?? 999))[0];
  if (oldest) {
    if (oldest.d === null) out.push(`${oldest.p.name} : pas encore porté, c'est l'occasion.`);
    else if (oldest.d >= 10) out.push(`${oldest.p.name} : pas porté depuis ${oldest.d} jours.`);
  }

  const accents = [...new Set(c.pieces.map((p) => p.color).filter((x) => COLORS[x] && !COLORS[x][2]))];
  if (accents.length === 1) out.push(`Une seule couleur vive, ${COLORS[accents[0]][3]}, sur une base neutre.`);
  else if (accents.length === 0) out.push("Tout en tons neutres, facile à porter.");
  const motif = c.pieces.find((p) => p.pattern === "motif");
  if (motif) out.push(`${motif.name} porte le seul motif de la tenue.`);

  if (c.style && c.style.reasons.length) out.push(...c.style.reasons);
  else if (c.style && c.style.score >= 3 && ctx.styles && ctx.styles.length) {
    const names = STYLES.filter((s) => ctx.styles.includes(s.id)).map((s) => s.name);
    out.push("Dans l'esprit " + names.join(" / ") + ".");
  }
  if (info.liked.has(c.key)) out.push("Tu as aimé cette tenue.");
  if (ctx.important) out.push("Jour important dans ton agenda : on reste habillé.");

  const missOcc = c.pieces.filter((p) => !(p.occ || []).includes(ctx.occ));
  if (missOcc.length) out.push(`Pas idéal pour l'occasion : ${missOcc.map((p) => p.name).join(", ")}.`);
  const offSeason = c.pieces.filter((p) => p.seasons && p.seasons.length && !p.seasons.includes(ctx.season));
  if (offSeason.length) out.push(`Hors saison, faute de mieux : ${offSeason.map((p) => p.name).join(", ")}.`);
  if ((w.rain || w.snow) && c.pieces.some((p) => p.rain === "fragile")) out.push("Attention, une pièce craint la pluie.");
  return out;
}

export function missingNote(items, ctx) {
  const homeOnly = (i) => (i.occ || []).length > 0 && i.occ.every((o) => o === "maison");
  const ok = items.filter((i) => !i.deleted && !i.dirty && i.cat !== "accessoire" && (ctx.occ === "maison" || !homeOnly(i)));
  const has = (c) => ok.some((i) => i.cat === c);
  const miss = [];
  if (!has("robe") && !has("haut")) miss.push("un haut");
  if (!has("robe") && !has("bas")) miss.push("un bas");
  if (!has("chaussures")) miss.push("des chaussures");
  if (ctx.occ !== "maison" && (ctx.w.morning < 15 || ctx.w.rain) && !has("veste")) miss.push("une veste");
  if (!miss.length) return "";
  return "Ajoute " + miss.join(", ") + " pour compléter les tenues" + (items.some((i) => i.dirty && !i.deleted) ? " (les pièces au sale sont mises de côté)." : ".");
}

export { CATS };
