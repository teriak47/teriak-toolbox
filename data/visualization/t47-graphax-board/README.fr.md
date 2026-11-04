# Graphax — Tableau d'Enquête & Graphe d'Analyse Interactif (bêta)

🌐 **Langue :** [English](README.md) | Français

**Bêta :** l'application est en développement et n'a pas encore fait l'objet d'une revue complète de sécurité et de fonctionnement. Conservez des sauvegardes indépendantes de vos projets importants.

L'inversion d'un lien conserve désormais les modifications en attente, et un enregistrement échoué est signalé avec une action « Réessayer » au lieu d'afficher « Sauvegardé ». La suppression du nœud ou du lien sélectionné au clavier (`Suppr` ou `Retour arrière`) demande désormais une confirmation. La création, l'import et la suppression d'un projet, d'une catégorie ou d'un nœud se font en une seule transaction : un échec ne laisse aucune donnée partielle, et l'API refuse les liens, nœuds et catégories qui font référence à un projet, un nœud ou une catégorie inexistants, ou à un autre projet. Le contenu des requêtes est validé et limité à 2 Mo (50 Mo pour un import). Les autres points de la revue (voir le suivi des issues du dépôt) restent ouverts : conservez des exports de sauvegarde de vos projets importants.

Application locale d'investigation, d'OSINT/Cyber, d'analyse de lore et de recherche complexe conçue pour dépasser les limites des graphes flottants classiques.

## Architecture Technique

- **Frontend :** React 19 + TypeScript + Vite 8 + Tailwind CSS v4
- **Moteur de Graphe :** canevas SVG développé pour Graphax (`src/components/GraphCanvas.tsx`) — cartes d'indices personnalisées, liens tirés depuis le cadre d'un nœud, édition directe des labels sur les flèches, mini-map, simulation de forces optionnelle et mise en page hiérarchique (`@dagrejs/dagre`)
- **Backend Local :** Node.js + Hono (`http://127.0.0.1:3456`)
- **Base de Données 100% Locale :** **SurrealDB Embedded** (`@surrealdb/node` et son moteur natif `@surrealdb/node-native`, stockage persistant sur disque `surrealkv://` dans `./data/graphax.db`, relations graphe natives `RELATE`)

## Démarrage Rapide

Prérequis : Node.js 22.18 ou plus récent et pnpm. Le transfert a été compilé avec Node.js 22 et pnpm 12.

```bash
pnpm install --frozen-lockfile

# Mode développement (lance l'API SurrealDB locale + l'interface Vite sur http://localhost:5173)
pnpm dev

# Tests automatisés de l'API (base temporaire, données fictives)
pnpm test

# Build de production + lancement serveur unifié (http://127.0.0.1:3456)
pnpm build
pnpm start
```

## Design et version

L'interface suit le design system SECTION 21 des projets Teriak47 : surfaces sombres bistre, un seul accent bleu froid, angles droits avec coupes à 21°, liens en segments droits, fentes d'œil pour les états et signature de pied. Chakra Petch et Fragment Mono (OFL-1.1, fournies par `@fontsource`) sont chargées localement : rien n'est téléchargé. Les tokens sont dans `src/ds/`. Les couleurs et formes de catégories des projets existants sont conservées ; les anciennes formes arrondies sont dessinées en carrés.

La version affichée dans le pied de page vient de `package.json`, qui doit correspondre à `tool.yaml` (vérifié par `pnpm test`). `/api/health` la renvoie aussi.

## Raccourcis & Interactions sur le Canevas

- **Double-clic sur le fond du canevas :** Crée instantanément un nœud aux coordonnées du curseur.
- **Glisser-déposer un nœud :** Positionnement libre sauvegardé automatiquement dans SurrealDB (`positionX`, `positionY`).
- **Glisser depuis le cadre autour d'un nœud vers un autre :** Crée une relation graphe native avec saisie directe du label sur la flèche.
- **Double-clic sur le label d'une flèche :** Modifie le texte de la relation directement sur le graphe.
- **Sens des liens :** chaque lien orienté porte une flèche au milieu et une à l'arrivée. Quand un nœud est sélectionné, ses liens sortants s'affichent en bleu et ses liens entrants en ocre, avec une légende qui les compte ; des tirets animés montrent le sens du lien survolé ou sélectionné.
- **Clic sur un nœud ou un lien :** Ouvre le panneau latéral d'inspection à droite (catégorie, métadonnées libres clé/valeur, notes complètes en Markdown avec aperçu rendu, trait plein vs pointillés d'hypothèse, orientation).
- **`Ctrl + K` :** Recherche instantanée avec centrage automatique de la caméra sur l'indice sélectionné.
- **`Suppr` (`Delete`) ou `Retour arrière` :** Demande la suppression du nœud ou du lien sélectionné ; `Entrée` confirme, `Échap` annule.

## Protection de l'API locale

L'API n'écoute que sur `127.0.0.1`, n'envoie aucun en-tête CORS et refuse les requêtes dont l'en-tête `Host` ou `Origin` n'est pas l'application elle-même ou le serveur de développement Vite (`localhost:5173`). Les autres sites ne peuvent donc ni lire ni modifier les données locales, y compris par DNS rebinding. D'autres origines peuvent être autorisées avec `GRAPHAX_ALLOWED_ORIGINS` (séparées par des virgules). Il n'y a pas d'authentification utilisateur : toute personne ayant accès à votre session locale peut utiliser l'API. Les adresses de la démonstration sont fictives.

## Données locales

Les données sont stockées dans `data/` à la racine de l'outil, quel que soit le dossier depuis lequel le serveur est lancé ; `GRAPHAX_DATA_DIR` permet de choisir un autre emplacement. Ce dossier est exclu de Git et ne doit pas être publié. Exportez et sauvegardez vos projets séparément au besoin.

Les corrections, optimisations et ajouts prévus sont listés dans la [feuille de route](docs/ROADMAP.md) (en anglais).

Sous Windows, d'anciennes versions créaient la base dans un dossier imbriqué du type `<dossier de lancement>/D/…/data/graphax.db`. Si aucune base n'existe à l'emplacement attendu, Graphax copie celle qu'il y trouve et l'indique dans le journal ; l'original n'est pas modifié.

## Licence

Graphax fait partie de Teriak Toolbox et est distribué sous la licence GPL v3 du dépôt. Les dépendances conservent leurs propres licences.
