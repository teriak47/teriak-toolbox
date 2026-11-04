# Graphax roadmap

Proposed work on Graphax, grouped as fixes, optimisations, visual improvements and new features. Each item is done as its own change and validated before the next one starts.

Effort: **S** small, **M** medium, **L** large.

## 1. Fixes

| ID | Status | Issue | Where | Severity | Effort |
|---|---|---|---|---|---|
| C1 | Done | The Delete key removed the selected node or link at once, with no confirmation and no undo. It now asks first (Enter or Delete again confirms, Escape cancels); Backspace works the same way. | `src/components/GraphCanvas.tsx` | High | S |
| C2 | Planned | Project import, project deletion and category deletion run several statements without a transaction, so a failure part-way leaves a half-imported project, orphan nodes or stale category references. | `server/routes/projects.ts`, `server/routes/categories.ts` | High | M |
| C3 | Planned | The API does not check that the project or nodes exist before creating a category, node or link, nor that both ends of a link belong to the same project. | `server/routes/*.ts` | Medium | M |
| C4 | Planned | Input validation is thin: `color`, `icon` and `shape` accept any string, imports have no size limit, and malformed JSON returns 500 instead of 400. | `server/routes/*.ts`, `server/app.ts` | Medium | S |
| C5 | Planned | Category defaults disagree (`mapCategory` uses `rounded` / `#38bdf8`, presets use `sharp` / `#47c0ef`, import uses `rounded`), and `normalizeCategoryRecord` is an unused duplicate. | `server/mappers.ts`, `server/presets.ts` | Low | S |
| C6 | Planned | Exporting from the workspace has no error handling, so a failure goes unnoticed. | `src/components/Workspace.tsx` | Low | S |
| C7 | Planned | The README mentions React Flow while the canvas is a custom SVG renderer, and `@xyflow/react`, `@surrealdb/node-native` and `tsx` appear unused (to confirm by removing them). | `README*.md`, `package.json` | Low | S |

## 2. Optimisations

| ID | Status | Topic | Finding | Benefit | Effort |
|---|---|---|---|---|---|
| O1 | Planned | Live physics | The loop never stops once the graph settles, sets React state on every frame (re-rendering the whole SVG), is O(n²), and saves every node position every 1.8 s. | CPU and battery use, smoothness beyond ~150 nodes | M |
| O2 | Planned | Batch positions | The server runs one query per node, sequentially, instead of one statement in a transaction. | Faster layouts | S |
| O3 | Planned | Project list | Counting loads every category, node and link in the database instead of using `GROUP BY` with `count()`. | Fast dashboard with large databases | S |
| O4 | Planned | Create, demo, import | Records are created one at a time instead of a batched insert in a transaction (also fixes part of C2). | Speed and atomicity | S |
| O5 | Planned | Bundle size | The client bundle is 562 kB; `react-markdown`, `remark-gfm` and `dagre` can be loaded on demand, and unused dependencies removed (C7). | Faster start | S |
| O6 | Planned | Large components | `GraphCanvas.tsx` (≈1,800 lines) and `Workspace.tsx` (≈1,270 lines) can be split into hooks such as `useSaveQueue`, `useViewport` and `usePhysics`. Do this before V4, A5 and A6. | Maintainability, testable code | L |

## 3. Visual improvements

| ID | Status | Topic | Proposal | Effort |
|---|---|---|---|---|
| V1 | Planned | Node shapes | Only square and cut-corner boxes are drawn today (legacy `rounded` and `pill` fall back to squares). Add a small set of distinct shapes that stay within the SECTION 21 style (for example hexagon, diamond, octagon, circle), a live preview in the category editor, and correct link clipping for every shape. | M |
| V2 | Planned | Link colours | Links take a single colour. Let a link have its own colour, or inherit a colour from a link type, with a short palette from the design tokens; show it in the inspector and the relation filter. | M |
| V3 | Planned | Link direction | The arrowhead is small and sits on the target border. Make direction easier to read: larger arrowheads, an optional mid-link arrow, a subtle flow animation on hover or selection, and outgoing versus incoming links highlighted differently when a node is selected. | M |
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
3. **Readability of the graph:** V3, V2, V1.
4. **Larger features:** A1, A2, A3.
5. **Later:** O6, then V4, A6 to A9.
