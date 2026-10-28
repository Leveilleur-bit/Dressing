# Dressing du matin

Une appli de téléphone qui propose une tenue chaque matin à partir de ton dressing.

Elle tient compte de :

- **la météo**, récupérée automatiquement (température ressentie le matin et l'après-midi, pluie, vent, neige) ;
- **la saison** de chaque pièce ;
- **l'occasion** (quotidien, travail, soirée, sport, maison / travaux), choisie toute seule d'après l'agenda ; une pièce marquée uniquement « Maison / travaux » n'est jamais proposée pour sortir ;
- **les couleurs** (une seule couleur vive sur une base neutre) et **les motifs** (un seul à la fois) ;
- **la rotation** : ce que tu as porté récemment passe après le reste ;
- **le linge sale** : une pièce « au sale » n'est plus proposée jusqu'à ce qu'elle soit lavée ;
- **tes goûts** : « J'aime » et « Pas pour moi » apprennent ce qui te plaît ; après un refus, l'appli demande pourquoi (trop de couleurs, pas de saison, une pièce qui déplaît…) et s'en souvient ;
- **ton envie du jour** : confort, classe ou de la couleur.
- **les accessoires** : écharpe, bonnet et gants quand il fait froid, lunettes et chapeau au soleil, sac, ceinture ou bijou assortis ;
- **tes styles et créatrices** préférés (jusqu'à 3 par personne), et en option une **styliste IA**.
- **tes looks favoris** (Réglages → Looks que j'aime) : des captures Instagram, Pinterest ou des photos de magazine, rangées dans le dépôt privé ; la styliste les regarde et en reprend l'esprit avec tes propres vêtements.

Et aussi :

- une **fiche d'ajout courte** : photo, nom, catégorie, couleur, épaisseur ; le reste est deviné d'après le nom (« Chemise en lin » → haut, léger, lin, printemps-été, travail) et se corrige dans « Plus de détails » ;
- la **recherche** dans le dressing, et le filtre **À trier** (pièces pas portées depuis 6 mois) ;
- l'**occasion par défaut** en semaine et le week-end, réglable pour chaque personne ;
- la **tenue préparée la veille** : le soir, l'appli montre la tenue de demain ; « Je la prépare pour demain » la garde, et le matin un message prévient si la météo a changé, avec « Adapter la tenue » ;
- le **changement de saison** : l'appli repère les pièces hors saison à ranger et celles à ressortir ; une pièce rangée n'est plus proposée mais peut partir en voyage ;
- les **statistiques** (onglet Dressing) : tenues portées, part du dressing utilisée, pièces, couleurs et marques les plus portées, pièces jamais portées, sur 1 mois à tout l'historique ;
- la **valise** : destination, dates, météo sur place, une tenue par jour qui réutilise les mêmes pièces, et la liste à cocher.
- le **détourage automatique** des photos, par un petit modèle d'IA qui tourne sur le téléphone (gratuit, rien n'est envoyé, environ 55 Mo téléchargés une seule fois) ; une méthode simple reste disponible dans Réglages, ainsi qu'un bouton pour refaire le détourage de toutes les photos ;
- les catégories **Veste** et **Manteau** : un manteau quand il fait froid, une veste quand c'est doux, jamais les deux ;
- **Que porter avec… ?** : depuis la fiche d'une pièce, 4 tenues construites autour d'elle ;
- **Mes tenues** : les tenues que tu composes toi-même, celles que tu aimes et celles que tu gardes, à porter en un geste ;
- **les pièces qui manquent** : les pièces de base qui ajouteraient le plus de tenues, et la progression du dressing par paliers ;
- la **marque** de chaque pièce, avec un filtre par marque ; une pièce d'une créatrice choisie dans « Mon style » compte dans ce style ;
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

La même clé sert à trois choses, chacune à environ 1 centime :

- **Demander à la styliste** : 3 tenues au choix (la sûre, la plus osée, la redécouverte), et ton choix lui apprend ton goût ; elle reçoit la liste des vêtements, la météo, les styles choisis et une planche photo numérotée de toutes les pièces, pour juger les vraies couleurs et matières (environ 2 centimes). Elle reçoit aussi tes tenues réellement portées, celles que tu as composées, celles que tu aimes ou refuses avec leur raison, pour s'adapter à ton goût ;
- **Reconnaître le vêtement** : la photo détourée du vêtement est envoyée pour remplir la fiche (nom, catégorie, couleur, matière, saisons…) ; c'est automatique quand on ajoute une photo et que le nom est encore vide ;
- **Photographier l'étiquette** : la photo de l'étiquette est envoyée pour lire la marque, la taille, la composition et l'entretien ; elle n'est pas conservée.

- **Bilan du dressing** (onglet Dressing) : pièces à ressortir, orphelines, doublons, pièces à questionner et achats utiles (environ 3 centimes) ;
- **Ajouter plusieurs vêtements** (onglet Dressing) : une photo de penderie, de pile ou de lit où la styliste liste et découpe chaque pièce (environ 2 centimes la photo), ou une rafale de photos (une par pièce) traitée pendant qu'on photographie (environ 1 centime la pièce).

Sans clé, la couleur et le motif sont quand même détectés sur le téléphone à partir de la photo.

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
- `sw.js`, `manifest.webmanifest` : l'installation sur le téléphone et le fonctionnement hors connexion ;
- `js/vendor/bgremoval.js` et `bg/` : la bibliothèque [@imgly/background-removal](https://github.com/imgly/background-removal-js) 1.4.5 et son modèle ISNet, sous licence AGPL-3.0 (code source public), pour le détourage sur le téléphone.
