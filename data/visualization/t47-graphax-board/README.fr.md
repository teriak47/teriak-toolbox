# Graphax — Tableau d'Enquête & Graphe d'Analyse Interactif (bêta)

🌐 **Langue :** [English](README.md) | Français

**Bêta :** l'application est en développement et n'a pas encore fait l'objet d'une revue complète de sécurité et de fonctionnement. Conservez des sauvegardes indépendantes de vos projets importants.

L'inversion d'un lien conserve désormais les modifications en attente, et un enregistrement échoué est signalé avec une action « Réessayer » au lieu d'afficher « Sauvegardé ». La suppression du nœud ou du lien sélectionné au clavier (`Suppr` ou `Retour arrière`) demande désormais une confirmation. La création, l'import et la suppression d'un projet, d'une catégorie ou d'un nœud se font en une seule transaction : un échec ne laisse aucune donnée partielle, et l'API refuse les liens, nœuds et catégories qui font référence à un projet, un nœud ou une catégorie inexistants, ou à un autre projet. Le contenu des requêtes est validé et limité à 2 Mo (50 Mo pour un import). Les autres points de la revue (voir le suivi des issues du dépôt) restent ouverts : conservez des exports de sauvegarde de vos projets importants.

Application locale d'investigation, d'OSINT/Cyber, d'analyse de lore et de recherche complexe conçue pour dépasser les limites des graphes flottants classiques.

## Architecture Technique

- **Frontend :** React 19 + TypeScript + Vite 8 + Tailwind CSS v4
- **Moteur de Graphe :** canevas SVG développé pour Graphax. `src/components/GraphCanvas.tsx` porte son état, sa caméra et sa physique, et `src/components/canvas/` ses éléments (nœuds, liens, dock, mini-map, confirmation de suppression, menu de catégorie) — cartes d'indices personnalisées, liens tirés depuis le cadre d'un nœud, édition directe des labels sur les flèches, mini-map, simulation de forces optionnelle et mise en page hiérarchique (`@dagrejs/dagre`). Au-delà de 1 000 nœuds, la simulation de forces passe à une approximation de Barnes-Hut pour que les grands graphes restent fluides.
- **API locale :** Rust + axum (`api/`), uniquement sur `127.0.0.1`. Elle sert aussi l'interface.
- **Base de Données 100% Locale :** **SurrealDB Embedded** 3.3 (crate Rust, stockage SurrealKV sur disque, relations graphe natives `RELATE`). Les bases écrites par les versions précédentes de Graphax s'ouvrent telles quelles.
- **Appli de bureau :** Tauri 2 (`src-tauri/`), qui réunit l'interface et l'API dans un seul programme.

## Appli de bureau

Téléchargez l'installeur de votre système dans les [Releases GitHub](https://github.com/teriak47/teriak-toolbox/releases) du dépôt (`Graphax_<version>_x64-setup.exe` ou `.msi` sous Windows, `.dmg` sous macOS, `.deb`, `.rpm` ou `.AppImage` sous Linux), installez-le et ouvrez Graphax depuis vos applications. Rien d'autre n'est nécessaire.

Les installeurs ne sont pas signés : le premier lancement affiche un avertissement.

- **Windows :** « Windows a protégé votre ordinateur » → *Informations complémentaires* → *Exécuter quand même*.
- **macOS :** clic droit sur Graphax dans Applications → *Ouvrir* → *Ouvrir* (ou *Réglages Système* → *Confidentialité et sécurité* → *Ouvrir quand même*).
- **Linux :** pas d'avertissement ; l'appli a besoin de WebKitGTK (`libwebkit2gtk-4.1`), que les paquets `.deb` et `.rpm` installent.

L'appli range ses données dans son propre dossier : `%APPDATA%\com.teriak47.graphax` sous Windows, `~/Library/Application Support/com.teriak47.graphax` sous macOS, `~/.local/share/com.teriak47.graphax` sous Linux (`GRAPHAX_DATA_DIR` permet d'en choisir un autre). Pour reprendre les projets du mode navigateur, exportez chacun en JSON (« Exporter ») puis ouvrez-le avec « Importer .json » dans l'appli. Rouvrir Graphax quand il est déjà ouvert ramène sa fenêtre au premier plan. Fermer la fenêtre attend que la base soit fermée proprement.

## Mode navigateur et développement

Graphax peut aussi tourner dans un navigateur, depuis un clone du dépôt. Il faut Rust ([rustup](https://rustup.rs)) pour l'API locale, et Node.js 22.18 ou plus récent avec pnpm 12 pour l'interface. Depuis ce dossier :

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start      # API et interface sur http://127.0.0.1:3456
```

Le mode navigateur garde ses données dans `data/` de ce dossier, comme les versions précédentes : leurs projets s'ouvrent tels quels. `pnpm dev` lance l'API et le serveur de développement Vite (http://localhost:5173).

L'appli de bureau se construit à partir des mêmes sources : `pnpm dev:desktop` la lance en développement et `pnpm build:desktop` fabrique les installeurs du système courant. Sous Linux, il faut les bibliothèques de développement WebKitGTK (voir les [prérequis Tauri](https://v2.tauri.app/start/prerequisites/)).

Tests : `pnpm test` lance les tests de l'API en HTTP contre l'API locale (base temporaire, données fictives) et les tests unitaires de l'interface ; `cargo test -p graphax-api` lance les tests propres à l'API ; `pnpm build` puis `pnpm test:e2e` lance les tests de l'interface dans un vrai navigateur (Chromium de Playwright requis une fois : `pnpm exec playwright install chromium`). La CI les lance tous et vérifie que l'appli de bureau se compile.

Versions publiées : pousser un tag `t47-graphax-board/v<version>` (sur un commit de `main` qui porte cette version) fabrique les installeurs Windows, macOS et Linux et les joint à une Release GitHub en brouillon, publiée à la main.

## Design et version

L'interface suit le design system SECTION 21 des projets Teriak47 : surfaces sombres bistre, un seul accent bleu froid, angles droits avec coupes à 21°, liens en segments droits, fentes d'œil pour les états et signature de pied. Chakra Petch et Fragment Mono (OFL-1.1, fournies par `@fontsource`) sont chargées localement : rien n'est téléchargé. Les tokens sont dans `src/ds/`. Les couleurs et formes de catégories des projets existants sont conservées ; les anciennes formes arrondies sont dessinées en carrés. Les nœuds peuvent être carrés, à coin coupé, hexagonaux, en losange, octogonaux ou ronds, et les liens s'arrêtent sur chaque contour.

La version affichée dans le pied de page vient de `package.json`, qui doit correspondre à `tool.yaml` (vérifié par `pnpm test`) et aux crates Rust de `Cargo.toml` (vérifié par `cargo test`). `/api/health` la renvoie aussi.

## Raccourcis & Interactions sur le Canevas

- **Double-clic sur le fond du canevas :** Crée instantanément un nœud aux coordonnées du curseur.
- **Glisser-déposer un nœud :** Positionnement libre sauvegardé automatiquement dans SurrealDB (`positionX`, `positionY`).
- **Glisser depuis le cadre autour d'un nœud vers un autre :** Crée une relation graphe native avec saisie directe du label sur la flèche.
- **Double-clic sur le label d'une flèche :** Modifie le texte de la relation directement sur le graphe.
- **Couleur des liens :** dans l'inspecteur d'un lien, choisissez une des huit couleurs proposées (ou « Défaut » pour revenir au gris) ; la couleur est conservée à l'inversion et à l'export.
- **Sens des liens :** chaque lien orienté porte une flèche au milieu et une à l'arrivée. Quand un nœud est sélectionné, ses liens sortants s'affichent en bleu et ses liens entrants en lavande, avec une légende qui les compte ; des tirets animés montrent le sens du lien survolé ou sélectionné.
- **Clic sur un nœud ou un lien :** Ouvre le panneau latéral d'inspection à droite (catégorie, métadonnées libres clé/valeur, notes complètes en Markdown avec aperçu rendu, trait plein vs pointillés d'hypothèse, orientation).
- **`Ctrl + K` :** Recherche instantanée avec centrage automatique de la caméra sur l'indice sélectionné.
  Tapez `Clé:valeur` (ex. `IP:192.0.2`) pour chercher dans un attribut précis, ou `Clé:` pour trouver les nœuds qui ont cet attribut.
- **Attributs (métadonnées) :** les clés déjà utilisées dans le projet sont proposées à la saisie ; le type des valeurs est reconnu (URL, IP, date, empreinte…), une valeur qui ne correspond pas à sa clé est signalée, une URL peut s'ouvrir dans un nouvel onglet (jamais une URL désamorcée comme `hxxps://exemple[.]org`) et chaque valeur peut être copiée.
- **Champs par défaut d'une catégorie :** dans la fenêtre de la catégorie, listez les champs (ex. `IP`, `ASN`, `Pays`) ajoutés vides à ses nouveaux nœuds et quand un nœud passe dans cette catégorie ; l'œil affiche jusqu'à deux de ces valeurs sous le titre du nœud. Les champs manquants d'un nœud existant sont proposés en un clic dans le panneau d'inspection. Les catégories des modèles en ont déjà.
- **Modèles de catégories :** un nouveau projet peut partir de cinq jeux : Enquête OSINT (personnes, organisations, comptes en ligne, contacts, lieux, événements), Cyber / CTI (acteurs malveillants, malwares, vulnérabilités, IP, domaines, victimes), Lore, Recherche, ou aucun. Les formes ont le même sens partout : cercle = personne, hexagone = technique, octogone = menace ou risque, losange = incertain, coin coupé = preuve ou document, carré = le reste. Les catégories gardent leur ordre et les nouvelles s'ajoutent à la fin.
- **Fiabilité (code de l'Amirauté) :** chaque nœud peut recevoir une cote, la fiabilité de la source de A (totalement fiable) à F (inconnue) et la crédibilité de l'information de 1 (confirmée) à 6 (inconnue), choisies dans l'inspecteur. Elle s'affiche en badge sur le nœud et se recherche avec `Fiabilité:B2`.
- **Copier-coller et duplication :** `Ctrl+C` copie les nœuds sélectionnés (avec les liens entre eux) et `Ctrl+V` en colle des copies légèrement décalées, dans le même projet ou un autre. Un projet se duplique depuis sa carte dans la liste des projets.
- **Exporter :** le menu « Exporter » enregistre le projet en JSON (réimportable), un rapport Markdown (nœuds par catégorie avec fiabilité, attributs et notes, puis les liens) ou une image de tout le graphe (SVG ou PNG).
- **Types de liens :** chaque couleur de lien peut recevoir un nom dans la section « Types de liens » (par exemple « Financier » pour le sable) ; un clic sur un type n'affiche que ses liens, et un lien créé pendant ce filtre prend sa couleur.
- **Vues :** le sélecteur Graphe / Tableau / Chronologie affiche le graphe, un tableau triable des nœuds et liens affichés, ou une chronologie de leurs attributs datés. Le bouton de focus de l'inspecteur n'affiche que le voisinage d'un nœud (1 à 3 liens), et le panneau de sélection multiple trouve le plus court chemin entre deux nœuds ; « Revenir à tout le graphe » quitte l'un comme l'autre. Le menu Disposition peut regrouper les nœuds en une colonne par catégorie. La section « Vues enregistrées » garde sous un nom les filtres, le voisinage, le mode d'affichage et le cadrage actuels, pour y revenir en un clic.
- **Sélection multiple :** `Ctrl+clic` (`Cmd` sur Mac) ajoute ou retire un nœud, `Maj`+glisser sur le fond sélectionne les nœuds d'une zone. Glisser l'un d'eux déplace tout le groupe ; `Suppr` (après confirmation) ou le panneau latéral les supprime avec leurs liens. `Échap` vide la sélection.
- **Annuler / rétablir :** boutons ↶ ↷ dans la barre d'outils, ou `Ctrl+Z` et `Ctrl+Y` (hors champ de texte). Les déplacements, dispositions automatiques, modifications d'un nœud (titre, notes, catégorie, attributs) ou d'un lien (libellé, style, orientation, couleur, notes, inversion) l'ordre et les modifications des catégories s'annulent, tout comme la création ou la suppression d'un nœud (avec ses liens), d'un lien ou d'une catégorie. Une catégorie supprimée revient à sa place, avec les nœuds qui l'utilisaient (sauf s'ils en ont reçu une autre entre-temps).
- **Gérer les catégories :** clic droit (sans glisser) sur un nœud pour changer sa catégorie depuis un menu ; ses champs par défaut manquants sont ajoutés. Glissez les catégories dans la barre latérale pour les réordonner (ou flèches ↑ ↓ sur la poignée). Avant de supprimer une catégorie, la fenêtre liste les nœuds qui deviendront « Non classé ». La même fenêtre permet de fusionner une catégorie dans une autre (ses nœuds y passent, avec ses champs par défaut ; Ctrl+Z annule). Le signet au-dessus de la liste enregistre les catégories du projet comme preset, proposé ensuite sous « Mes presets » à la création d'un projet.
- **`Suppr` (`Delete`) ou `Retour arrière` :** Demande la suppression du nœud ou du lien sélectionné ; `Entrée` confirme, `Échap` annule.

## Protection de l'API locale

L'API n'écoute que sur `127.0.0.1`, n'envoie aucun en-tête CORS et refuse les requêtes dont l'en-tête `Host` ou `Origin` n'est pas l'application elle-même (port 3456 en mode navigateur, 3457 dans l'appli de bureau) ou le serveur de développement Vite (`localhost:5173`). Les autres sites ne peuvent donc ni lire ni modifier les données locales, y compris par DNS rebinding. D'autres origines peuvent être autorisées avec `GRAPHAX_ALLOWED_ORIGINS` (séparées par des virgules). Il n'y a pas d'authentification utilisateur : toute personne ayant accès à votre session locale peut utiliser l'API. Les adresses de la démonstration sont fictives.

## Données locales

Graphax ne fonctionne pas en ouvrant `index.html` directement : il a besoin de son API locale. En mode navigateur, les données sont stockées dans `data/` à la racine de l'outil, quel que soit le dossier depuis lequel l'API est lancée ; `GRAPHAX_DATA_DIR` permet de choisir un autre emplacement. Ce dossier est exclu de Git et ne doit pas être publié. L'appli de bureau utilise son propre dossier (voir « Appli de bureau »).

Instantanés : toutes les 30 minutes, Graphax enregistre chaque projet modifié dans `snapshots/<id du projet>/` de son dossier de données et garde les 10 derniers (`GRAPHAX_AUTO_SNAPSHOT_MINUTES` règle l'intervalle, `0` les désactive). Le bouton « Instantanés » d'un projet en prend un à la demande, en restaure un comme nouveau projet (le projet courant n'est pas modifié) ou en supprime un. Les fichiers ont le format d'export : on peut aussi les importer depuis la liste des projets, même après la suppression du projet. Ils restent dans le même dossier de données : gardez une copie ailleurs pour les projets importants.

Les corrections, optimisations et ajouts prévus sont listés dans la [feuille de route](docs/ROADMAP.md) (en anglais).

En mode navigateur sous Windows, d'anciennes versions créaient la base dans un dossier imbriqué du type `<dossier de lancement>/D/…/data/graphax.db`. Si aucune base n'existe à l'emplacement attendu, Graphax copie celle qu'il y trouve et l'indique dans le journal ; l'original n'est pas modifié.

## Licence

Graphax fait partie de Teriak Toolbox et est distribué sous la licence GPL v3 du dépôt. Les dépendances conservent leurs propres licences.
