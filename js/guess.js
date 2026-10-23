// Devine les caractéristiques d'une pièce à partir de son nom (« Doudoune noire », « Chemise en lin »…).
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const has = (name, words) => words.some((w) => new RegExp("(^|[^a-z])" + w).test(name));

const CAT_WORDS = [
  ["accessoire", ["sac", "pochette", "cabas", "echarpe", "foulard", "cheche", "snood", "bonnet", "gant", "moufle", "ceinture", "collier", "bracelet", "bague", "boucles? d", "montre", "chapeau", "casquette", "beret", "bob", "lunettes"]],
  ["chaussures", ["basket", "sneaker", "chaussure", "botte", "boots", "bottine", "mocassin", "derby", "derbies", "richelieu", "sandale", "tong", "escarpin", "ballerine", "espadrille", "chausson", "mule", "santiag", "converse", "stan smith", "talon", "slingback", "babies", "babie", "trotteur", "loafer", "mary.jane", "sabot", "claquette", "bottillon", "richelieu", "chelsea", "nu-pied", "nu pied"]],
  ["manteau", ["manteau", "trench", "parka", "doudoune", "caban", "duffle", "pardessus", "imper", "cape", "anorak", "loden"]],
  ["veste", ["veste", "blouson", "blazer", "perfecto", "k-way", "kway", "cire", "bomber", "teddy", "surchemise", "gilet sans manche", "doudounette", "peignoir"]],
  ["robe", ["robe", "combinaison", "salopette"]],
  ["bas", ["jean", "pantalon", "chino", "short", "bermuda", "jupe", "legging", "jogging", "cargo", "culotte", "survetement bas", "bas de"]],
  ["haut", ["chemise", "t-shirt", "tshirt", "tee", "pull", "sweat", "hoodie", "polo", "blouse", "top", "debardeur", "marin", "cardigan", "gilet", "col roule", "chemisier", "body", "brassiere", "pilou", "polaire", "haut"]]
];
const ACC_WORDS = [
  ["sac", ["sac", "pochette", "cabas"]], ["echarpe", ["echarpe", "foulard", "cheche", "snood"]], ["bonnet", ["bonnet", "beret"]],
  ["gants", ["gant", "moufle"]], ["ceinture", ["ceinture"]], ["bijou", ["collier", "bracelet", "bague", "boucles? d", "montre"]],
  ["chapeau", ["chapeau", "casquette", "bob"]], ["lunettes", ["lunettes"]]
];

export function guess(name, { weekdayOcc = "travail" } = {}) {
  const n = norm(name);
  const g = {};
  for (const [cat, words] of CAT_WORDS) if (has(n, words)) { g.cat = cat; break; }
  if (g.cat === "accessoire") for (const [t, words] of ACC_WORDS) if (has(n, words)) { g.acc = t; break; }

  // épaisseur
  if (has(n, ["doudoune", "parka", "manteau", "laine", "pull", "polaire", "grosse maille", "col roule", "bonnet", "gant", "moufle", "botte", "boots", "velours", "cachemire", "fourre", "moumoute", "pilou", "duffle", "caban"])) g.warmth = 3;
  else if (has(n, ["lin", "t-shirt", "tshirt", "tee", "debardeur", "short", "bermuda", "sandale", "tong", "chemisette", "polo", "espadrille", "maillot", "bob", "lunettes", "robe d.ete", "voile", "crop"])) g.warmth = 1;

  // matière
  const MAT = [["lin", ["lin"]], ["daim", ["daim", "suede", "nubuck"]], ["cuir", ["cuir", "perfecto"]], ["jean", ["jean", "denim"]],
    ["maille", ["cachemire", "maille", "tricot", "mohair", "alpaga", "cardigan"]], ["laine", ["laine", "tweed", "flanelle", "merinos", "caban", "duffle"]],
    ["soie", ["soie", "satin"]], ["velours", ["velours"]], ["technique", ["polaire", "k-way", "kway", "nylon", "gore", "softshell", "doudoune", "legging"]],
    ["coton", ["coton", "oxford", "chino", "t-shirt", "tshirt", "sweat", "hoodie", "polo", "mariniere"]]];
  for (const [m, words] of MAT) if (has(n, words)) { g.material = m; break; }

  // motif
  if (has(n, ["raye", "rayure", "mariniere", "carreau", "ecossais", "tartan", "fleur", "fleuri", "imprime", "pois", "motif", "leopard", "zebre", "camouflage", "camo", "pied.de.poule", "vichy", "liberty", "paisley", "graphique"])) g.pattern = "motif";

  // pluie
  if (has(n, ["daim", "suede", "nubuck", "soie", "satin", "toile blanche"])) g.rain = "fragile";
  else if (has(n, ["imper", "k-way", "kway", "cire", "gore", "pluie", "parka", "boots", "botte de pluie", "caoutchouc"])) g.rain = "impermeable";

  // occasions
  const maison = has(n, ["pilou", "pyjama", "chausson", "peignoir", "plaid", "jardin", "bricolage", "troue", "vieux", "vieille", "maison"]);
  const sport = has(n, ["legging", "brassiere", "running", "rando", "survetement", "jogging", "short de sport", "sport", "trail", "velo", "maillot de bain", "k-way", "kway"]);
  const travail = has(n, ["chemise", "blazer", "costume", "tailleur", "chino", "mocassin", "derby", "derbies", "richelieu", "escarpin", "pantalon a pince", "pantalon de costume", "jupe crayon", "cravate", "col roule", "cardigan", "trench", "manteau", "montre", "ceinture"]);
  const soiree = has(n, ["robe", "escarpin", "talon", "paillette", "soie", "satin", "blazer", "costume", "smoking", "pochette", "collier", "boucles? d", "bijou"]);
  if (maison && !sport) g.occ = ["maison"];
  else {
    const occ = [];
    if (!sport || has(n, ["basket", "sneaker", "sweat", "hoodie", "k-way", "kway"])) occ.push("quotidien");
    if (travail || (weekdayOcc === "travail" && !sport && !maison && !has(n, ["short", "debardeur", "tong", "sweat", "hoodie", "jogging"]))) occ.push("travail");
    if (soiree) occ.push("soiree");
    if (sport) occ.push("sport");
    if (maison) occ.push("maison");
    g.occ = occ.length ? occ : ["quotidien"];
  }

  // style
  const st = [];
  if (has(n, ["chemise", "blazer", "chino", "mocassin", "oxford", "trench", "caban", "cardigan", "mariniere", "polo", "richelieu", "derby"])) st.push("classique");
  if (has(n, ["soie", "satin", "escarpin", "tailleur", "costume", "manteau long", "pochette", "talon"])) st.push("chic");
  if (has(n, ["jean", "t-shirt", "tshirt", "tee", "sweat", "basket", "sneaker", "converse"])) st.push("decontracte");
  if (has(n, ["jogging", "hoodie", "survetement", "legging", "sneaker", "cargo", "casquette", "running"])) st.push("sport");
  if (has(n, ["perfecto", "blouson en cuir", "veste en cuir", "boots", "santiag", "clous", "slim noir"])) st.push("rock");
  if (has(n, ["brode", "franges", "fleuri", "ethnique", "crochet", "sabot", "longue fluide"])) st.push("boheme");
  if (has(n, ["dentelle", "volant", "noeud", "ballerine", "smock"])) st.push("romantique");
  if (has(n, ["surchemise", "veste de travail", "carpenter", "chore", "flanelle", "salopette"])) st.push("workwear");
  if (st.length) g.styles = st.slice(0, 2);
  return g;
}

/** Saisons par défaut selon l'épaisseur, la matière et le type */
export function seasonsFor({ cat, acc, warmth, material }) {
  const all = ["printemps", "ete", "automne", "hiver"];
  if (cat === "accessoire") {
    if (["echarpe", "bonnet", "gants"].includes(acc)) return ["automne", "hiver"];
    if (acc === "lunettes") return ["printemps", "ete"];
    if (acc === "chapeau") return warmth === 3 ? ["automne", "hiver"] : warmth === 1 ? ["printemps", "ete"] : all;
    return all;
  }
  if (material === "lin") return ["printemps", "ete"];
  if (warmth === 1) return ["printemps", "ete"];
  if (warmth === 3) return ["automne", "hiver"];
  if (["velours", "laine"].includes(material)) return ["automne", "hiver", "printemps"];
  return all;
}
