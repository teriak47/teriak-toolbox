# Graphax roadmap

Proposed work on Graphax, grouped as fixes, optimisations, visual improvements and new features. Each item is done as its own change and validated before the next one starts.

Effort: **S** small, **M** medium, **L** large.

## 1. Fixes

| ID | Status | Issue | Where | Severity | Effort |
|---|---|---|---|---|---|
| C1 | Done | The Delete key removed the selected node or link at once, with no confirmation and no undo. It now asks first (Enter or Delete again confirms, Escape cancels); Backspace works the same way. | `src/components/GraphCanvas.tsx` | High | S |
| C2 | Done | Project import, project deletion and category deletion ran several statements without a transaction, so a failure part-way could leave a half-imported project, orphan nodes or stale category references. Project creation, the demo, import and every deletion now run in a single transaction. | `server/bulk.ts`, `server/routes/*.ts` | High | M |
| C3 | Done | The API did not check that the project, nodes or category existed before creating a category, node or link, nor that both ends of a link belonged to the same project; a batch position update could also move another project's nodes. These references are now checked (404 for a missing project, 400 for an invalid node or category). | `server/guards.ts`, `server/routes/*.ts` | Medium | M |
| C4 | Done | Input validation was thin: `color`, `icon` and `shape` accepted any string, requests had no size limit, malformed JSON returned 500 instead of 400, and fields of the wrong type could crash a route. Category styles are now validated (`#rgb` is stored as `#rrggbb`), requests are limited to 2 MB (50 MB for an import), malformed or non-object JSON returns 400, and imports skip or default invalid entries. | `server/validation.ts`, `server/routes/*.ts`, `server/app.ts` | Medium | S |
| C5 | Done | Category defaults disagreed (`mapCategory` used `rounded` / `#38bdf8`, presets `sharp` / `#47c0ef`, import `rounded`), and `normalizeCategoryRecord` was an unused duplicate. Defaults now come from one place in `shared/types.ts` (`#47c0ef`, `tag`, `sharp`), stored records with unknown values are read with these defaults, and the duplicate is removed. | `shared/types.ts`, `server/mappers.ts`, `server/presets.ts` | Low | S |
| C6 | Done | Exporting from the workspace had no error handling, so a failure went unnoticed, and an edit typed just before or still being saved could be missing from the file. The export now waits for the inspector's typing delay and for saves in flight, reports a failure, warns when some edits are not saved, and shares its code with the dashboard (file names keep accented letters readable). | `src/lib/exportProject.ts`, `src/components/Workspace.tsx` | Low | S |
| C7 | Done | The French README described the canvas as React Flow while it is a custom SVG renderer, and `@xyflow/react` and `tsx` were unused dependencies. Both READMEs now describe the actual architecture and the two packages are removed. `@surrealdb/node-native` is kept: it is a required peer dependency of `@surrealdb/node`. | `README*.md`, `package.json` | Low | S |

## 2. Optimisations

| ID | Status | Topic | Finding | Benefit | Effort |
|---|---|---|---|---|---|
| O1 | Done (part) | Live physics | The loop never stopped once the graph settled, re-rendered the whole SVG on every frame and saved every node position every 1.8 s. It now goes to sleep when the graph is still (no DOM updates at rest), wakes when a node is dragged or the links change, and saves only the nodes that moved, when the graph settles or at most every 5 s while it moves. On the demo, 12 s of physics went from 8 saves of all nodes to 2. Still open: the force computation is O(n²), which may need a Barnes-Hut approximation beyond a few hundred nodes. | CPU and battery use, fewer writes | M |
| O2 | Done | Batch positions | The server ran one query per node, sequentially; it now updates them in one transaction (done with C3). | Faster layouts | S |
| O3 | Done | Project list | Counting loaded every category, node and link record; counts now come from `GROUP BY` with `count()` in the database. Measured on 4 projects with 20,000 nodes and 20,000 links: about 30 % faster (≈250 ms to ≈175 ms), since SurrealDB still scans the rows but no longer returns them. | Faster dashboard with large databases | S |
| O4 | Done | Create, demo, import | Records were created one at a time; they are now written with batched inserts in one transaction (done with C2). | Speed and atomicity | S |
| O5 | Done | Bundle size | The client bundle was 562 kB in one file. The workspace, the Markdown preview (`react-markdown`, `remark-gfm`) and `dagre` are now loaded on demand: the initial bundle is 275 kB (86 kB gzipped, from 173 kB), and the build no longer warns about chunk size. | Faster start | S |
| O6 | Done (part) | Large components | `GraphCanvas.tsx` (1,909 lines) and `Workspace.tsx` (1,321) mixed state, persistence, camera, physics and geometry. Extracted: `useSaveQueue` (save tracking and retry), `useViewport` (camera, wheel zoom, coordinate conversions), `usePhysicsSimulation` (live layout), and the pure `canvasGeometry` and `edgeGeometry` modules, now unit tested. `GraphCanvas.tsx` is down to 1,512 lines and `Workspace.tsx` to 1,262. Still open: splitting the canvas markup (nodes, links, mini-map, dock) into components. | Maintainability, testable code | L |

## 3. Visual improvements

| ID | Status | Topic | Proposal | Effort |
|---|---|---|---|---|
| V1 | Done | Node shapes | Only square and cut-corner boxes were drawn (legacy `rounded` and `pill` fall back to squares). Hexagon, diamond, octagon and circle are added, sized to carry the same visual weight as the square. Links end exactly on every outline (ray and polygon intersection, unit tested for each shape and direction), halos and selection rings follow the shape, and the category editor shows each shape and a live preview of the node. | M |
| V2 | Done (part) | Link colours | Links took a single colour. A link can now have its own colour, picked in the inspector from eight hues sharing the accent blue's lightness and chroma, or reset to the default grey. The colour is stored as `#rrggbb`, validated by the API, kept through reversal and export/import, and used for the link, its arrows and its label frame; a selected node's direction colours (V3) take precedence. Still open: link types that set a colour, and a filter by colour. | M |
| V3 | Done | Link direction | The arrowhead was small and sat on the target border. Arrowheads are larger, every directed link has a second arrow along it (moved towards the source when the middle holds the label), moving dashes show the direction of hovered or selected links, and when a node is selected its outgoing links are drawn in the accent blue and its incoming links in a matching lavender (new `--lien-sortant` and `--lien-entrant` tokens), with a legend giving both counts. The dash animation is disabled when the system asks for reduced motion. | M |
| V5 | Done (part) | Categories | The preset category sets are reviewed: the former "OSINT & Cyber" set is split into an OSINT investigation set (person, organisation, online account, contact, place, event, document, hypothesis) and a Cyber / CTI set, colours no longer repeat within a set, shapes follow one meaning across sets (circle person, hexagon technical, octagon threat or risk, diamond uncertain, cut corner evidence, square the rest), two icons are added (`@`, phone), and categories keep their order (new ones go last). Still open: reorder them, change a node's category from the canvas (context menu or keyboard), show which nodes use a category before deleting it, merge two categories, and save a project's categories as a reusable preset. | M |
| V6 | Done | Metadata | Metadata were plain key/value text fields. The inspector now suggests keys already used in the project, recognises value types (URL, e-mail, IPv4/IPv6, date, MD5/SHA-1/SHA-256/SHA-512, number, including defanged values), warns when a value does not fit its key (for example a date that is not a date), opens plain URLs in a new tab (defanged URLs are never linked) and copies values. The search accepts `Clé:valeur` and `Clé:` (empty fields never match). Each category can list up to 12 default keys, added empty to its new nodes and to nodes moved into it, and up to 2 of them are shown under the node title; the inspector offers a node's missing keys, and the preset categories come with their own keys. | M |
| V4 | Planned | Views | Add views beyond the free canvas: focus on a node's neighbourhood at N levels, shortest path between two nodes, a timeline built from node dates, a table or list view of nodes and links, grouping by category, and saved views (filters plus viewport). Absorbs A4 and A5. | L |

## 4. New features

| ID | Status | Feature | Why | Effort |
|---|---|---|---|---|
| A1 | Planned | Undo and redo (`Ctrl+Z` / `Ctrl+Y`) | The missing safety net, and the natural follow-up to C1 | M |
| A2 | Planned | Multiple selection (box select, Shift+click) to move or delete several items | Needed once a graph grows | M |
| A3 | Planned | A dedicated reliability field (Admiralty code A1–F6) with a badge on the node | The demo already stores it in free metadata | S |
| A4 | Moved to V4 | Neighbourhood focus and shortest path | | |
| A5 | Moved to V4 | Timeline view | | |
| A6 | Planned | Export the graph as PNG or SVG, and a Markdown report | Sharing and delivering an investigation | M |
| A7 | Planned | Automatic backups and project snapshots | The README asks users to keep backups; the tool could do it | S |
| A8 | Planned | Duplicate a project; copy and paste nodes | Everyday convenience | S |
| A9 | Planned | Front-end tests (Vitest and Playwright) in CI | Only the API is tested today | M |

## Suggested order

1. **Data safety:** C1, C2 with O4, C3, C4.
2. **Clean-up and performance:** C5, C6, C7, O1, O2, O3, O5.
3. **Readability and ease of use:** V3, V2, V1, V5, V6.
4. **Larger features:** A1, A2, A3.
5. **Later:** O6, then V4, A6 to A9.
