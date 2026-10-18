# Dressing du matin

Une appli de téléphone qui propose une tenue chaque matin à partir de ton dressing.

Elle tient compte de :

- **la météo**, récupérée automatiquement (température ressentie le matin et l'après-midi, pluie, vent, neige) ;
- **la saison** de chaque pièce ;
- **l'occasion** (quotidien, travail, soirée, sport, maison / travaux), choisie toute seule d'après l'agenda ; une pièce marquée uniquement « Maison / travaux » n'est jamais proposée pour sortir ;
- **les couleurs** (une seule couleur vive sur une base neutre) et **les motifs** (un seul à la fois) ;
- **la rotation** : ce que tu as porté récemment passe après le reste ;
- **le linge sale** : une pièce « au sale » n'est plus proposée jusqu'à ce qu'elle soit lavée ;
- **tes goûts** : « J'aime » et « Pas pour moi » apprennent ce qui te plaît ;
- **ton envie du jour** : confort, classe ou de la couleur.
- **les accessoires** : écharpe, bonnet et gants quand il fait froid, lunettes et chapeau au soleil, sac, ceinture ou bijou assortis ;
- **tes styles et créatrices** préférés (jusqu'à 3 par personne), et en option une **styliste IA**.

Et aussi :

- une **fiche d'ajout courte** : photo, nom, catégorie, couleur, épaisseur ; le reste est deviné d'après le nom (« Chemise en lin » → haut, léger, lin, printemps-été, travail) et se corrige dans « Plus de détails » ;
- la **recherche** dans le dressing, et le filtre **À trier** (pièces pas portées depuis 6 mois) ;
- l'**occasion par défaut** en semaine et le week-end, réglable pour chaque personne ;
- la **valise** : destination, dates, météo sur place, une tenue par jour qui réutilise les mêmes pièces, et la liste à cocher.
- le **détourage automatique** des photos : pose le vêtement à plat sur un drap ou un sol uni et contrasté, l'appli enlève le fond ;
- la tenue présentée en **flat lay** (haut, veste qui chevauche, bas, chaussures, sac), et la **garde-robe de la semaine** : une planche avec les pièces de la semaine et une tenue prévue pour chaque jour.

## Où sont les données

- `Dressing` (ce dépôt, public) : uniquement le code de l'appli, sans aucune donnée personnelle.
- `Dressing-donnees-R` et `Dressing-donnees-H` (privés) : le dressing de chaque personne, avec le fichier `dressing.json` et le dossier `photos/`.

L'appli crée elle-même `dressing.json` au premier lancement. Les photos prises avec l'appareil photo intégré partent directement dans le dépôt privé et ne sont jamais enregistrées dans l'album du téléphone.

## Mise en route

### 1. Activer GitHub Pages (une seule fois)

1. Dans ce dépôt : **Settings → Pages**.
2. Sous « Build and deployment », Source : **Deploy from a branch**.
3. Branch : **main**, dossier **/ (root)**, puis **Save**.
4. Après une minute environ, l'appli est en ligne à l'adresse
   **https://leveilleur-bit.github.io/Dressing/**

### 2. Créer un jeton pour chaque personne

À faire deux fois : une fois pour `Dressing-donnees-R`, une fois pour `Dressing-donnees-H`.

1. Va sur **github.com → photo de profil → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Nom : par exemple `Dressing R`. Expiration : 1 an, par exemple (il faudra le renouveler à l'échéance).
3. **Repository access → Only select repositories** : choisis **un seul** dépôt (`Dressing-donnees-R` ou `Dressing-donnees-H`).
4. **Permissions → Repository permissions → Contents : Read and write**. Ne touche à rien d'autre.
5. **Generate token**, puis copie le jeton (il commence par `github_pat_`). GitHub ne le montre qu'une fois.

### 3. Installer l'appli sur le téléphone

1. Ouvre **https://leveilleur-bit.github.io/Dressing/**
   - sur iPhone, avec **Safari** : bouton Partager → **Sur l'écran d'accueil** ;
   - sur Android, avec **Chrome** : menu ⋮ → **Ajouter à l'écran d'accueil** (ou **Installer l'application**).
2. Ouvre l'appli depuis l'icône, puis **Réglages → Ajouter un profil** :
   - prénom ;
   - dépôt : `Leveilleur-bit/Dressing-donnees-R` (ou `-H`) ;
   - le jeton de cette personne.
3. Dans **Réglages**, choisis le lieu pour la météo (ta position ou une ville).

Sur un appareil partagé, on peut ajouter les deux profils et passer de l'un à l'autre dans Réglages.

### 4. Optionnel : la styliste IA

1. Crée un compte sur **console.anthropic.com**, ajoute un peu de crédit (5 $ suffisent pour plusieurs mois) et fixe une **limite de dépense mensuelle** dans les réglages de facturation.
2. Crée une clé API (**API Keys → Create Key**).
3. Dans l'appli : **Réglages → Styliste IA**, colle la clé, puis **Vérifier et enregistrer**.

La styliste reçoit la liste écrite des vêtements, la météo et les styles choisis, jamais les photos. Elle coûte environ 1 centime par demande.

## Si un téléphone est perdu

Supprime son jeton dans GitHub (Settings → Developer settings → Fine-grained tokens → Delete). L'autre dressing n'est pas touché. Crée un nouveau jeton pour le nouveau téléphone.

## Technique

Site statique sans dépendance, à servir tel quel :

- `index.html`, `styles.css`, `app.js` : l'interface ;
- `js/engine.js` : le choix des tenues ;
- `js/store.js` : la synchronisation avec le dépôt privé, avec fusion automatique si deux appareils modifient en même temps ;
- `js/github.js` : l'API GitHub « contents » ;
- `js/weather.js` : la météo [Open-Meteo](https://open-meteo.com) (gratuite, sans clé) ;
- `js/camera.js` : l'appareil photo intégré ;
- `sw.js`, `manifest.webmanifest` : l'installation sur le téléphone et le fonctionnement hors connexion.
