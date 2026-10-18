// Bibliothèque de styles et de créatrices.
// Chaque profil traduit une esthétique en règles simples que le moteur sait noter :
//   colors   : couleurs fétiches / à éviter (ids de catalog.js)
//   tags     : styles de pièces fétiches / à éviter (ids de STYLE_TAGS)
//   materials: matières fétiches
//   words    : mots dans le nom des pièces (sans accents, en minuscules)
//   combos   : associations signature, chaque partie = liste de mots possibles
//   maxAccents / motifs : tolérance à la couleur et aux motifs
//   hint     : description envoyée à la styliste IA

export const STYLE_TAGS = [
  { id: "classique", label: "Classique" }, { id: "chic", label: "Chic" },
  { id: "decontracte", label: "Décontracté" }, { id: "sport", label: "Sport / street" },
  { id: "boheme", label: "Bohème" }, { id: "rock", label: "Rock" },
  { id: "romantique", label: "Romantique" }, { id: "workwear", label: "Workwear" }
];

export const MATERIALS = [
  { id: "coton", label: "Coton" }, { id: "lin", label: "Lin" }, { id: "laine", label: "Laine" },
  { id: "maille", label: "Maille / cachemire" }, { id: "jean", label: "Jean" }, { id: "cuir", label: "Cuir" },
  { id: "daim", label: "Daim" }, { id: "soie", label: "Soie / satin" }, { id: "velours", label: "Velours" },
  { id: "technique", label: "Technique / synthétique" }
];

export const STYLES = [
  // ---------------- styles ----------------
  { id: "minimaliste", kind: "style", name: "Minimaliste",
    desc: "Peu de pièces, coupes nettes, tons neutres, aucun logo.",
    colors: { love: ["noir", "blanc", "gris", "beige", "ecru", "marine", "camel"], avoid: ["orange", "violet", "jaune", "rose"] },
    tags: { love: ["classique", "chic"], avoid: ["boheme", "romantique"] }, materials: ["laine", "maille", "coton"],
    words: { love: ["col roule", "pantalon droit", "t-shirt blanc", "manteau"], avoid: ["logo", "imprime", "volant"] },
    combos: [], maxAccents: 0, motifs: false,
    hint: "minimalisme : palette neutre, une seule ligne claire par tenue, aucun motif ni logo, matières de qualité." },

  { id: "parisien", kind: "style", name: "Parisien",
    desc: "Marinière, jean brut, trench, mocassins, une touche de rouge.",
    colors: { love: ["marine", "blanc", "ecru", "beige", "noir", "denim", "camel"], avoid: ["orange", "violet", "jaune", "vert"], accent: ["rouge"] },
    tags: { love: ["classique", "chic", "decontracte"], avoid: ["sport"] }, materials: ["coton", "maille", "cuir", "jean"],
    words: { love: ["mariniere", "trench", "mocassin", "ballerine", "caban", "chemise", "jean"], avoid: ["jogging", "logo"] },
    combos: [
      { label: "marinière et jean", parts: [["mariniere", "raye"], ["jean"]] },
      { label: "trench sur jean", parts: [["trench"], ["jean"]] },
      { label: "caban et marinière", parts: [["caban"], ["mariniere"]] }
    ], maxAccents: 1, motifs: true,
    hint: "chic parisien décontracté : marinière, jean brut, trench, caban, mocassins ou ballerines, une seule touche de rouge, rien de trop apprêté." },

  { id: "preppy", kind: "style", name: "Preppy",
    desc: "Chemise oxford, pull col V ou torsadé, chino, blazer, mocassins.",
    colors: { love: ["marine", "blanc", "beige", "bordeaux", "vert", "camel", "bleu"], avoid: ["noir", "violet", "orange"] },
    tags: { love: ["classique", "chic"], avoid: ["rock", "sport", "boheme"] }, materials: ["coton", "laine", "maille"],
    words: { love: ["oxford", "chino", "blazer", "torsade", "col v", "polo", "mocassin", "cardigan"], avoid: ["clous", "perfecto"] },
    combos: [
      { label: "oxford et chino", parts: [["oxford", "chemise"], ["chino"]] },
      { label: "blazer et chino", parts: [["blazer"], ["chino", "pantalon"]] }
    ], maxAccents: 2, motifs: true,
    hint: "preppy : chemise oxford, pull col V ou torsadé sur les épaules, chino, blazer marine, mocassins ; couleurs college (marine, bordeaux, vert), carreaux et rayures bienvenus." },

  { id: "boheme", kind: "style", name: "Bohème",
    desc: "Fluide, imprimés, matières naturelles, tons terre.",
    colors: { love: ["ecru", "beige", "camel", "marron", "bordeaux", "kaki", "orange", "rose"], avoid: ["noir", "gris"] },
    tags: { love: ["boheme", "romantique", "decontracte"], avoid: ["sport", "workwear"] }, materials: ["lin", "coton", "daim", "maille"],
    words: { love: ["fleur", "fluide", "longue", "brode", "franges", "sandale", "bottine", "gilet"], avoid: ["costume", "cravate"] },
    combos: [{ label: "robe fluide et bottines", parts: [["robe"], ["bottine", "botte"]] }],
    maxAccents: 2, motifs: true,
    hint: "bohème : pièces fluides, imprimés fleuris ou ethniques, broderies, matières naturelles, tons terre, bottines ou sandales." },

  { id: "rock", kind: "style", name: "Rock",
    desc: "Perfecto, noir, jean slim, bottes, un peu d'attitude.",
    colors: { love: ["noir", "gris", "blanc", "denim", "bordeaux"], avoid: ["rose", "jaune", "orange", "beige"] },
    tags: { love: ["rock"], avoid: ["preppy", "romantique", "boheme"] }, materials: ["cuir", "jean", "coton"],
    words: { love: ["perfecto", "cuir", "slim", "boots", "botte", "t-shirt", "skinny", "noir"], avoid: ["mocassin", "polo"] },
    combos: [{ label: "perfecto et jean", parts: [["perfecto", "cuir"], ["jean", "slim"]] }],
    maxAccents: 1, motifs: false,
    hint: "rock : perfecto en cuir, jean slim noir ou délavé, t-shirt, bottes ou boots, palette noire, attitude décontractée." },

  { id: "street", kind: "style", name: "Streetwear",
    desc: "Sweat, baskets, coupes amples, pièces sport mélangées au reste.",
    colors: { love: ["noir", "blanc", "gris", "kaki", "beige"], avoid: ["bordeaux"] },
    tags: { love: ["sport", "decontracte"], avoid: ["chic", "romantique"] }, materials: ["coton", "technique", "jean"],
    words: { love: ["sweat", "hoodie", "basket", "sneaker", "cargo", "jogging", "doudoune", "bomber", "ample"], avoid: ["mocassin", "cravate", "escarpin"] },
    combos: [{ label: "sweat et baskets", parts: [["sweat", "hoodie"], ["basket", "sneaker"]] }],
    maxAccents: 1, motifs: true,
    hint: "streetwear : sweat ou hoodie, cargo ou jean ample, baskets, bomber ou doudoune, superpositions." },

  { id: "workwear", kind: "style", name: "Workwear",
    desc: "Veste de travail, surchemise, toile solide, tons kaki et brun.",
    colors: { love: ["kaki", "marron", "camel", "ecru", "denim", "marine", "beige"], avoid: ["rose", "violet"] },
    tags: { love: ["workwear", "decontracte"], avoid: ["romantique", "chic"] }, materials: ["coton", "jean", "cuir", "laine"],
    words: { love: ["surchemise", "veste de travail", "chore", "toile", "carpenter", "boots", "flanelle", "chino"], avoid: ["soie", "volant"] },
    combos: [{ label: "surchemise et jean", parts: [["surchemise", "flanelle"], ["jean"]] }],
    maxAccents: 1, motifs: true,
    hint: "workwear : veste de travail, surchemise, flanelle, jean brut ou pantalon de toile, boots en cuir, tons kaki, brun et indigo." },

  { id: "romantique", kind: "style", name: "Romantique",
    desc: "Volants, dentelle, fleurs, tons doux.",
    colors: { love: ["rose", "ecru", "blanc", "beige", "bleu", "bordeaux"], avoid: ["kaki", "noir"] },
    tags: { love: ["romantique", "boheme", "chic"], avoid: ["sport", "rock", "workwear"] }, materials: ["soie", "coton", "maille"],
    words: { love: ["volant", "dentelle", "fleur", "noeud", "ballerine", "blouse", "jupe", "robe"], avoid: ["cargo", "jogging"] },
    combos: [{ label: "blouse et jupe", parts: [["blouse"], ["jupe"]] }],
    maxAccents: 1, motifs: true,
    hint: "romantique : blouses à volants, dentelle, petites fleurs, jupes et robes, ballerines, tons poudrés." },

  { id: "chic", kind: "style", name: "Chic classique",
    desc: "Tailleur, chemise, manteau long, cuir, tons sobres.",
    colors: { love: ["marine", "noir", "blanc", "camel", "gris", "beige", "bordeaux"], avoid: ["orange", "jaune", "violet"] },
    tags: { love: ["chic", "classique"], avoid: ["sport", "boheme"] }, materials: ["laine", "soie", "cuir", "maille"],
    words: { love: ["blazer", "tailleur", "manteau", "chemise", "escarpin", "derby", "richelieu", "pantalon a pince"], avoid: ["jogging", "sweat", "logo"] },
    combos: [{ label: "blazer et chemise", parts: [["blazer", "veste"], ["chemise"]] }],
    maxAccents: 1, motifs: false,
    hint: "chic classique : blazer, chemise, pantalon à pinces, manteau long, chaussures en cuir, palette sobre." },

  { id: "scandinave", kind: "style", name: "Scandinave",
    desc: "Grosses mailles, superpositions, tons neutres et doux.",
    colors: { love: ["ecru", "gris", "beige", "blanc", "noir", "kaki", "camel"], avoid: ["orange", "violet", "rouge"] },
    tags: { love: ["decontracte", "classique"], avoid: ["rock", "romantique"] }, materials: ["laine", "maille", "coton", "lin"],
    words: { love: ["maille", "grosse maille", "col roule", "ample", "manteau", "pull"], avoid: ["volant", "clous"] },
    combos: [], maxAccents: 0, motifs: false,
    hint: "scandinave : grosses mailles, superpositions confortables, coupes amples, tons neutres et doux, aucun motif." },

  // ---------------- créatrices / maisons ----------------
  { id: "sezane", kind: "createur", name: "Sézane",
    desc: "Parisienne romantique : pulls doux, blouses, jupes midi, tons crème et touches de rouge.",
    colors: { love: ["ecru", "beige", "camel", "marine", "bordeaux", "blanc", "denim"], avoid: ["noir", "orange", "violet"], accent: ["rouge", "bordeaux"] },
    tags: { love: ["romantique", "chic", "classique"], avoid: ["sport", "rock"] }, materials: ["maille", "coton", "soie", "daim"],
    words: { love: ["pull", "cardigan", "blouse", "jupe midi", "robe", "mocassin", "ballerine", "boutons"], avoid: ["jogging", "sweat"] },
    combos: [{ label: "pull doux et jupe midi", parts: [["pull", "cardigan"], ["jupe"]] }],
    maxAccents: 1, motifs: true,
    hint: "Sézane : parisienne romantique, cardigans et pulls doux à boutons, blouses, jupes midi, jean, mocassins ; tons crème, camel, marine, touche de rouge." },

  { id: "apc", kind: "createur", name: "A.P.C.",
    desc: "Basiques parfaits : jean brut, chemise, pull col rond, sans logo.",
    colors: { love: ["marine", "denim", "blanc", "gris", "ecru", "kaki", "noir"], avoid: ["rose", "orange", "violet", "jaune"] },
    tags: { love: ["classique", "decontracte"], avoid: ["boheme", "romantique", "rock"] }, materials: ["jean", "coton", "laine"],
    words: { love: ["jean brut", "chemise", "col rond", "sweat", "chino", "caban"], avoid: ["imprime", "volant", "logo"] },
    combos: [{ label: "jean brut et pull col rond", parts: [["jean"], ["pull", "col rond"]] }],
    maxAccents: 0, motifs: false,
    hint: "A.P.C. : basiques sobres et précis, jean brut, chemise, pull col rond, caban, palette indigo, marine, gris, aucun logo." },

  { id: "marant", kind: "createur", name: "Isabel Marant",
    desc: "Bohème rock : blouses brodées, cuir, franges, bottes western.",
    colors: { love: ["ecru", "noir", "camel", "marron", "bordeaux", "beige"], avoid: ["marine", "vert"] },
    tags: { love: ["boheme", "rock"], avoid: ["classique", "sport"] }, materials: ["cuir", "daim", "soie", "coton"],
    words: { love: ["brode", "franges", "santiag", "bottes", "cuir", "blouse", "jupe courte", "ceinture"], avoid: ["polo", "chino"] },
    combos: [{ label: "blouse brodée et bottes", parts: [["blouse", "brode"], ["botte", "santiag"]] }],
    maxAccents: 1, motifs: true,
    hint: "Isabel Marant : bohème rock, blouses brodées, cuir et daim, franges, bottes western, allure décontractée." },

  { id: "jacquemus", kind: "createur", name: "Jacquemus",
    desc: "Lumière du Sud : lin, tons sable et soleil, coupes graphiques.",
    colors: { love: ["blanc", "ecru", "beige", "jaune", "bleu", "camel", "vert"], avoid: ["gris", "noir", "bordeaux"] },
    tags: { love: ["chic", "decontracte"], avoid: ["rock", "workwear"] }, materials: ["lin", "coton", "soie"],
    words: { love: ["lin", "chemise", "ample", "sandale", "panier", "short"], avoid: ["doudoune", "cuir"] },
    combos: [], maxAccents: 1, motifs: false,
    hint: "Jacquemus : esprit méditerranéen, lin, coupes graphiques et amples, tons sable, blanc, jaune soleil, bleu ciel." },

  { id: "ralph", kind: "createur", name: "Ralph Lauren",
    desc: "Américain classique : polo, oxford, tweed, chino, mocassins.",
    colors: { love: ["marine", "blanc", "beige", "bordeaux", "vert", "camel", "marron", "rouge"], avoid: ["violet", "orange"] },
    tags: { love: ["classique", "chic"], avoid: ["rock", "boheme"] }, materials: ["coton", "laine", "cuir", "velours"],
    words: { love: ["polo", "oxford", "tweed", "chino", "torsade", "blazer", "mocassin", "cable"], avoid: ["clous", "cargo"] },
    combos: [{ label: "polo et chino", parts: [["polo"], ["chino"]] }, { label: "torsadé et chemise", parts: [["torsade"], ["chemise", "oxford"]] }],
    maxAccents: 2, motifs: true,
    hint: "Ralph Lauren : classique américain, polo, chemise oxford, pull torsadé, tweed, chino, mocassins ou bottes en cuir ; marine, vert anglais, bordeaux." },

  { id: "ami", kind: "createur", name: "Ami Paris",
    desc: "Parisien décontracté : bon manteau, pull, jean, baskets propres.",
    colors: { love: ["marine", "noir", "gris", "camel", "ecru", "blanc", "rouge"], avoid: ["violet", "jaune"] },
    tags: { love: ["decontracte", "chic", "classique"], avoid: ["boheme", "romantique"] }, materials: ["laine", "maille", "coton", "jean"],
    words: { love: ["manteau", "pull", "jean", "basket", "chemise", "sweat"], avoid: ["volant"] },
    combos: [{ label: "manteau, pull et baskets", parts: [["manteau"], ["basket"]] }],
    maxAccents: 1, motifs: false,
    hint: "Ami Paris : élégance parisienne décontractée, manteau en laine, pull, jean, baskets blanches propres." },

  { id: "agnesb", kind: "createur", name: "agnès b.",
    desc: "Intemporel : cardigan pression, marinière, noir et blanc.",
    colors: { love: ["noir", "blanc", "marine", "gris", "ecru", "rouge"], avoid: ["orange", "kaki"] },
    tags: { love: ["classique", "chic"], avoid: ["sport", "boheme"] }, materials: ["coton", "maille", "laine"],
    words: { love: ["cardigan", "mariniere", "raye", "veste", "chemise"], avoid: ["logo"] },
    combos: [{ label: "cardigan et marinière", parts: [["cardigan"], ["mariniere", "raye"]] }],
    maxAccents: 1, motifs: true,
    hint: "agnès b. : intemporel, cardigan à pressions, marinière, noir et blanc, simplicité graphique." },

  { id: "rouje", kind: "createur", name: "Rouje",
    desc: "Féminin rétro : robes fleuries, rouge, petites ballerines.",
    colors: { love: ["rouge", "ecru", "blanc", "noir", "rose", "bordeaux"], avoid: ["kaki", "gris"] },
    tags: { love: ["romantique", "chic"], avoid: ["sport", "workwear"] }, materials: ["coton", "soie", "maille"],
    words: { love: ["robe", "fleur", "ballerine", "jupe", "cardigan", "decollete"], avoid: ["cargo", "sweat"] },
    combos: [{ label: "robe fleurie et cardigan", parts: [["robe"], ["cardigan"]] }],
    maxAccents: 1, motifs: true,
    hint: "Rouje : féminin rétro et sensuel, robes à fleurs, rouge à lèvres en couleur fétiche, cardigans courts, ballerines." },

  { id: "kooples", kind: "createur", name: "The Kooples",
    desc: "Rock chic : noir, cuir, costume ajusté, chemise.",
    colors: { love: ["noir", "blanc", "gris", "bordeaux", "marine"], avoid: ["beige", "orange", "jaune", "rose"] },
    tags: { love: ["rock", "chic"], avoid: ["boheme", "sport"] }, materials: ["cuir", "laine", "soie"],
    words: { love: ["cuir", "perfecto", "costume", "blazer", "chemise", "slim", "boots"], avoid: ["polo", "short"] },
    combos: [{ label: "blazer et jean noir", parts: [["blazer"], ["jean", "slim"]] }],
    maxAccents: 0, motifs: false,
    hint: "The Kooples : rock chic, noir dominant, cuir, blazer ajusté, chemise, jean slim, boots." },

  { id: "barnie", kind: "createur", name: "Barnie",
    desc: "Vestiaire doux et facile : broderies, smocks, maille, tons terre avec une touche de rouge.",
    colors: { love: ["kaki", "camel", "beige", "ecru", "marron", "denim", "blanc"], avoid: ["violet", "jaune", "rose"], accent: ["rouge", "bordeaux", "orange"] },
    tags: { love: ["decontracte", "boheme", "chic"], avoid: ["sport", "rock"] }, materials: ["maille", "laine", "coton", "jean"],
    words: { love: ["brode", "smock", "blouse", "chemise", "cardigan", "pull", "jupe", "robe", "foulard", "voile"], avoid: ["logo", "jogging", "cargo"] },
    combos: [{ label: "blouse brodée et jean", parts: [["blouse", "brode", "chemise"], ["jean"]] }, { label: "pull doux et jupe", parts: [["pull", "cardigan"], ["jupe"]] }],
    maxAccents: 1, motifs: true,
    hint: "Barnie : vestiaire français doux et facile à superposer, broderies et smocks, maille douce, voile de coton, tons terre (kaki, camel, beige chiné) avec une touche de vermillon, de rouge ou de bordeaux." },

  { id: "maison123", kind: "createur", name: "Maison 123",
    desc: "Féminin et soigné : coupes élégantes, petite robe noire, maille, tailleur, dentelle.",
    colors: { love: ["noir", "ecru", "blanc", "camel", "marine", "beige", "bordeaux"], avoid: ["kaki", "orange"], accent: ["rose", "rouge", "bordeaux"] },
    tags: { love: ["chic", "romantique", "classique"], avoid: ["sport", "workwear"] }, materials: ["maille", "laine", "soie", "coton"],
    words: { love: ["robe", "dentelle", "cardigan", "pull", "tailleur", "blazer", "jupe", "escarpin", "bottine", "manteau"], avoid: ["jogging", "cargo", "sweat"] },
    combos: [{ label: "petite robe noire et escarpins", parts: [["robe"], ["escarpin", "bottine"]] }, { label: "blazer et jupe", parts: [["blazer", "veste"], ["jupe"]] }],
    maxAccents: 1, motifs: true,
    hint: "Maison 123 : prêt-à-porter féminin et soigné, coupes élégantes héritées du tailleur, petite robe noire, maille fine, dentelle et transparences, une allure polie au quotidien." },

  { id: "stellasuzie", kind: "createur", name: "Maison Stella & Suzie",
    desc: "Bohème solaire : imprimés vifs, matières légères et fluides, robes et blouses romantiques.",
    colors: { love: ["ecru", "blanc", "jaune", "orange", "rose", "rouge", "bleu", "camel", "vert"], avoid: ["gris", "noir"] },
    tags: { love: ["boheme", "romantique", "decontracte"], avoid: ["workwear", "rock", "sport"] }, materials: ["coton", "lin", "soie", "maille"],
    words: { love: ["imprime", "fleur", "robe", "blouse", "volant", "combinaison", "sandale", "jupe longue", "foulard", "casquette", "brode"], avoid: ["costume", "cravate", "jogging"] },
    combos: [{ label: "robe imprimée et sandales", parts: [["robe"], ["sandale", "espadrille"]] }, { label: "blouse et jean", parts: [["blouse"], ["jean"]] }],
    maxAccents: 2, motifs: true,
    hint: "Maison Stella & Suzie : bohème chic et féminin, imprimés solaires et couleurs vives, matières légères et fluides, robes, blouses et combinaisons, accessoires (foulards, casquettes, bijoux)." },

  { id: "uniqlo", kind: "createur", name: "Uniqlo U / Lemaire",
    desc: "Formes simples et fonctionnelles, tons doux, beaucoup de maille.",
    colors: { love: ["ecru", "beige", "kaki", "marron", "gris", "noir", "marine"], avoid: ["rose", "violet", "orange"] },
    tags: { love: ["decontracte", "classique"], avoid: ["romantique", "rock"] }, materials: ["coton", "maille", "laine", "lin"],
    words: { love: ["ample", "pantalon", "maille", "chemise", "manteau"], avoid: ["logo", "volant"] },
    combos: [], maxAccents: 0, motifs: false,
    hint: "Lemaire / Uniqlo U : vêtements fonctionnels aux formes souples, tons terre et doux, superpositions sobres." }
];

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const hasWord = (name, list) => list.some((w) => name.includes(w));

/** Note d'une tenue pour les styles choisis. Renvoie {score, reasons}. */
export function styleScore(pieces, styleIds, COLORS) {
  const profiles = STYLES.filter((s) => styleIds.includes(s.id));
  if (!profiles.length) return { score: 0, reasons: [] };
  let total = 0; const reasons = [];
  for (const p of profiles) {
    let s = 0;
    for (const it of pieces) {
      const name = norm(it.name);
      if (p.colors.love.includes(it.color) || (p.colors.accent || []).includes(it.color)) s += 0.6;
      if (p.colors.avoid.includes(it.color)) s -= 1.4;
      const tags = it.styles || [];
      if (tags.some((t) => p.tags.love.includes(t))) s += 0.9;
      if (tags.some((t) => p.tags.avoid.includes(t))) s -= 1.6;
      if (it.material && p.materials.includes(it.material)) s += 0.5;
      if (hasWord(name, p.words.love)) s += 1;
      if (hasWord(name, p.words.avoid)) s -= 1.8;
    }
    const accents = new Set(pieces.map((it) => it.color).filter((c) => COLORS[c] && !COLORS[c][2]));
    if (accents.size > p.maxAccents) s -= 1.5 * (accents.size - p.maxAccents);
    if (p.colors.accent && pieces.some((it) => p.colors.accent.includes(it.color)) && accents.size === 1) {
      s += 1; reasons.push(`Touche de ${COLORS[[...accents][0]][0].toLowerCase()}, très ${p.name}.`);
    }
    if (!p.motifs && pieces.some((it) => it.pattern === "motif")) s -= 1.5;
    for (const c of p.combos) {
      const used = new Set();
      const ok = c.parts.every((words) => {
        const hit = pieces.find((it) => !used.has(it.id) && hasWord(norm(it.name), words));
        if (hit) used.add(hit.id);
        return !!hit;
      });
      if (ok) { s += 3; reasons.push(`Association signature ${p.name} : ${c.label}.`); }
    }
    total += s;
  }
  return { score: total / profiles.length * 1.3, reasons: reasons.slice(0, 2) };
}
