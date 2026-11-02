# Graphax — Tableau d'Enquête & Graphe d'Analyse Interactif (bêta)

🌐 **Langue :** [English](README.md) | Français

**Bêta :** l'application est en développement et n'a pas encore fait l'objet d'une revue complète de sécurité et de fonctionnement. Conservez des sauvegardes indépendantes de vos projets importants.

La revue a relevé une perte possible des dernières modifications d'un lien lorsqu'il est inversé rapidement, ainsi qu'un état « enregistré » trompeur si l'enregistrement d'un élément échoue. Vérifiez les changements importants et conservez des exports de sauvegarde jusqu'à la correction de ces problèmes.

Application locale d'investigation, d'OSINT/Cyber, d'analyse de lore et de recherche complexe conçue pour dépasser les limites des graphes flottants classiques.

## Architecture Technique

- **Frontend :** React 19 + TypeScript + Vite 8 + Tailwind CSS v4
- **Moteur de Graphe :** `@xyflow/react` (React Flow v12) — cartes d'indices personnalisées, poignées multidirectionnelles libres, édition directe des labels sur les flèches, mini-map, alignement optionnel (`@dagrejs/dagre`)
- **Backend Local :** Node.js + Hono (`http://127.0.0.1:3456`)
- **Base de Données 100% Locale :** **SurrealDB Embedded** (`@surrealdb/node` avec moteur persistant sur disque `surrealkv://` dans `./data/graphax.db`, relations graphe natives `RELATE`)

## Démarrage Rapide

Prérequis : Node.js 22.18 ou plus récent et pnpm. Le transfert a été compilé avec Node.js 22 et pnpm 12.

```bash
pnpm install --frozen-lockfile

# Mode développement (lance l'API SurrealDB locale + l'interface Vite sur http://localhost:5173)
pnpm dev

# Build de production + lancement serveur unifié (http://127.0.0.1:3456)
pnpm build
pnpm start
```

## Raccourcis & Interactions sur le Canevas

- **Double-clic sur le fond du canevas :** Crée instantanément un nœud aux coordonnées du curseur.
- **Glisser-déposer un nœud :** Positionnement libre sauvegardé automatiquement dans SurrealDB (`positionX`, `positionY`).
- **Glisser depuis une poignée d'un nœud vers un autre :** Crée une relation graphe native avec saisie directe du label sur la flèche.
- **Double-clic sur le label d'une flèche :** Modifie le texte de la relation directement sur le graphe.
- **Clic sur un nœud ou un lien :** Ouvre le panneau latéral d'inspection à droite (catégorie, métadonnées libres clé/valeur, notes complètes en Markdown avec aperçu rendu, trait plein vs pointillés d'hypothèse, orientation).
- **`Ctrl + K` :** Recherche instantanée avec centrage automatique de la caméra sur l'indice sélectionné.
- **`Suppr` (`Delete`) :** Supprime le nœud ou le lien sélectionné.

## Limite de sécurité actuelle

L'API écoute en local, mais accepte actuellement les requêtes d'autres origines sans authentification applicative. Un site malveillant ouvert dans le même navigateur pourrait accéder aux données de Graphax ou les modifier pendant son fonctionnement. Ce point doit être revu avant d'y confier des données sensibles. Les adresses de la démonstration sont fictives.

Les données locales du dossier `data/` sont exclues de Git et ne doivent pas être publiées. Exportez et sauvegardez vos projets séparément au besoin.

## Licence

Graphax fait partie de Teriak Toolbox et est distribué sous la licence GPL v3 du dépôt. Les dépendances conservent leurs propres licences.
