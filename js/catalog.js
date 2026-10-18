export const CATS = [
  { id: "haut", label: "Haut" }, { id: "bas", label: "Bas" }, { id: "robe", label: "Robe" },
  { id: "veste", label: "Veste" }, { id: "chaussures", label: "Chaussures" },
  { id: "accessoire", label: "Accessoire" }
];

export const ACC_TYPES = [
  { id: "sac", label: "Sac" }, { id: "echarpe", label: "Écharpe" }, { id: "bonnet", label: "Bonnet" },
  { id: "gants", label: "Gants" }, { id: "ceinture", label: "Ceinture" }, { id: "bijou", label: "Bijou / montre" },
  { id: "chapeau", label: "Chapeau / casquette" }, { id: "lunettes", label: "Lunettes de soleil" }
];

// [libellé, couleur, neutre ?, avec article]
export const COLORS = {
  noir: ["Noir", "#1f2024", 1, "le noir"], blanc: ["Blanc", "#f5f5f2", 1, "le blanc"],
  gris: ["Gris", "#9a9da4", 1, "le gris"], beige: ["Beige", "#d6c2a3", 1, "le beige"],
  marine: ["Marine", "#24315c", 1, "le marine"], denim: ["Denim", "#4b6b96", 1, "le denim"],
  marron: ["Marron", "#6b4a33", 1, "le marron"], kaki: ["Kaki", "#7a7a4f", 1, "le kaki"],
  camel: ["Camel", "#b98a4e", 1, "le camel"], ecru: ["Écru", "#ece4d2", 1, "l'écru"],
  bleu: ["Bleu", "#3d86d6", 0, "le bleu"], vert: ["Vert", "#4f8a56", 0, "le vert"],
  rouge: ["Rouge", "#b8382f", 0, "le rouge"], rose: ["Rose", "#e3a3b4", 0, "le rose"],
  jaune: ["Jaune", "#e2b93b", 0, "le jaune"], orange: ["Orange", "#d9773a", 0, "l'orange"],
  violet: ["Violet", "#7a5aa8", 0, "le violet"], bordeaux: ["Bordeaux", "#6e1f2e", 0, "le bordeaux"]
};

export const WARM = [{ id: 1, label: "Léger" }, { id: 2, label: "Moyen" }, { id: 3, label: "Chaud" }];
export const PATTERNS = [{ id: "uni", label: "Uni" }, { id: "motif", label: "Motif (rayures, carreaux, fleurs…)" }];
export const RAIN = [
  { id: "normal", label: "Normal" },
  { id: "impermeable", label: "Imperméable" },
  { id: "fragile", label: "Craint la pluie (daim, soie…)" }
];
export const SEASONS = [
  { id: "printemps", label: "Printemps" }, { id: "ete", label: "Été" },
  { id: "automne", label: "Automne" }, { id: "hiver", label: "Hiver" }
];
export const OCCS = [
  { id: "quotidien", label: "Quotidien" }, { id: "travail", label: "Travail" },
  { id: "soiree", label: "Soirée" }, { id: "sport", label: "Sport" },
  { id: "maison", label: "Maison / travaux" }
];
export const MOODS = [
  { id: "", label: "Peu importe" }, { id: "confort", label: "Confort" },
  { id: "classe", label: "Classe" }, { id: "couleur", label: "De la couleur" }
];
// réglage manuel quand la météo n'est pas disponible (ressenti moyen)
export const MANUAL_TEMPS = [
  { id: "froid", label: "Froid", range: "< 8 °C", m: 4, a: 7 },
  { id: "frais", label: "Frais", range: "8–15 °C", m: 10, a: 13 },
  { id: "doux", label: "Doux", range: "15–22 °C", m: 16, a: 20 },
  { id: "chaud", label: "Chaud", range: "> 22 °C", m: 23, a: 27 },
  { id: "pluie", label: "Pluie", range: "☂", toggle: true }
];

export const GLYPH = {
  haut: "M20 10 L12 14 L4 26 L12 31 L16 26 L16 56 L48 56 L48 26 L52 31 L60 26 L52 14 L44 10 Q32 19 20 10Z",
  bas: "M18 6 H46 L50 58 H37 L32 24 L27 58 H14 Z",
  robe: "M24 6 H40 L42 18 L52 58 H12 L22 18 Z",
  veste: "M20 8 L8 16 L6 58 H27 L32 24 L37 58 H58 L56 16 L44 8 L32 24 Z",
  chaussures: "M6 44 L6 30 Q12 27 18 31 Q28 40 44 40 Q58 41 58 50 V54 H6 Z",
  accessoire: "M22 24 Q22 10 32 10 Q42 10 42 24 H38 Q38 14 32 14 Q26 14 26 24 Z M12 24 H52 L56 56 H8 Z",
  acc_echarpe: "M12 10 H52 V24 Q42 31 32 31 Q22 31 12 24 Z M36 29 H47 L51 57 H40 Z",
  acc_bonnet: "M12 44 Q12 15 32 15 Q52 15 52 44 Z M9 44 H55 V54 H9 Z M28 10 A4 4 0 1 0 36 10 A4 4 0 1 0 28 10 Z",
  acc_gants: "M18 56 V32 L12 24 L16 21 L22 27 V13 Q22 9 26 9 Q30 9 30 13 V11 Q30 7 34 7 Q38 7 38 11 V13 Q38 9 42 9 Q46 9 46 13 V40 Q46 56 33 56 Z",
  acc_ceinture: "M4 26 H60 V38 H4 Z M22 21 H40 V43 H22 Z M27 26 V38 H35 V26 Z",
  acc_bijou: "M32 10 A22 22 0 1 0 32.01 10 Z M32 18 A14 14 0 1 1 31.99 18 Z",
  acc_chapeau: "M5 44 Q32 53 59 44 Q59 37 48 37 Q48 17 32 17 Q16 17 16 37 Q5 37 5 44 Z",
  acc_lunettes: "M4 25 H60 V30 H56 Q56 45 43 45 Q33 45 33 32 H31 Q31 45 21 45 Q8 45 8 30 H4 Z"
};

export function defaultSeasons(warmth) {
  if (warmth === 1) return ["printemps", "ete"];
  if (warmth === 3) return ["automne", "hiver"];
  return ["printemps", "automne", "hiver"];
}

export function demoItems() {
  const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const all4 = ["printemps", "ete", "automne", "hiver"];
  return [
    { id: "d1", name: "Pull col rond", cat: "haut", color: "gris", pattern: "uni", warmth: 3, seasons: ["automne", "hiver"], occ: ["quotidien", "travail"], lastWorn: ago(4) },
    { id: "d2", name: "Chemise oxford", cat: "haut", color: "blanc", pattern: "uni", styles: ["classique"], material: "coton", warmth: 2, seasons: all4, occ: ["travail", "quotidien", "soiree"], lastWorn: ago(9) },
    { id: "d3", name: "Marinière", cat: "haut", color: "marine", pattern: "motif", styles: ["classique"], material: "coton", warmth: 2, seasons: ["automne", "hiver"], occ: ["quotidien"] },
    { id: "d4", name: "T-shirt", cat: "haut", color: "vert", pattern: "uni", warmth: 1, seasons: ["printemps", "ete"], occ: ["quotidien", "sport"] },
    { id: "d5", name: "Jean droit", cat: "bas", color: "denim", pattern: "uni", styles: ["decontracte"], material: "jean", warmth: 2, seasons: all4, occ: ["quotidien", "soiree"], lastWorn: ago(1) },
    { id: "d6", name: "Pantalon chino", cat: "bas", color: "beige", pattern: "uni", warmth: 2, seasons: all4, occ: ["travail", "quotidien"], lastWorn: ago(6) },
    { id: "d7", name: "Robe midi", cat: "robe", color: "bordeaux", pattern: "uni", warmth: 2, seasons: ["printemps", "automne"], occ: ["soiree", "travail"] },
    { id: "d8", name: "Trench", cat: "veste", color: "beige", pattern: "uni", styles: ["classique", "chic"], material: "coton", warmth: 2, rain: "impermeable", seasons: ["printemps", "automne"], occ: ["travail", "quotidien", "soiree"], lastWorn: ago(5) },
    { id: "d9", name: "Doudoune", cat: "veste", color: "noir", pattern: "uni", warmth: 3, seasons: ["automne", "hiver"], occ: ["quotidien", "sport"] },
    { id: "d10", name: "Baskets", cat: "chaussures", color: "blanc", pattern: "uni", warmth: 1, seasons: all4, occ: ["quotidien", "sport"], lastWorn: ago(1) },
    { id: "d11", name: "Bottines en daim", cat: "chaussures", color: "marron", pattern: "uni", warmth: 3, rain: "fragile", seasons: ["automne", "hiver"], occ: ["travail", "soiree", "quotidien"], lastWorn: ago(6) },
    { id: "d12", name: "Boots en cuir", cat: "chaussures", color: "noir", pattern: "uni", warmth: 3, rain: "impermeable", seasons: ["automne", "hiver"], occ: ["travail", "quotidien"] }
  ].map((x) => ({ ...x, demo: true, updatedAt: 1 }));
}
