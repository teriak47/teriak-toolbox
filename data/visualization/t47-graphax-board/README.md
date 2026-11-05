# Graphax — beta

🌐 **Language:** English | [Français](README.fr.md)

Graphax is a local interactive graph board for investigations, research, and story development. Create projects, nodes, categories, and relationships; arrange the graph and import or export projects as JSON. The interface is in French.

**Beta:** the application is under development and has not yet received a complete security and functionality review. Keep independent backups of important projects.

Reversing a link now keeps pending edits, and a failed save is reported with a retry action instead of showing "saved". Deleting the selected node or link with the Delete or Backspace key now asks for confirmation first. Creating, importing and deleting a project, a category or a node is now done in a single transaction, so a failure leaves no partial data, and the API refuses links, nodes and categories that refer to a missing project, node or category, or to another project. Request bodies are validated and limited to 2 MB (50 MB for an import). The remaining review items (see the repository issue tracker) are still open, so keep exported backups of important projects.

## Architecture

- **Front end:** React 19, TypeScript, Vite 8 and Tailwind CSS v4.
- **Graph canvas:** an SVG canvas written for Graphax (`src/components/GraphCanvas.tsx`), with custom node cards, links drawn from a node's frame, inline link labels, a mini-map, an optional force simulation and a hierarchical layout (`@dagrejs/dagre`).
- **Local back end:** Node.js and Hono on `http://127.0.0.1:3456`.
- **Local database:** embedded SurrealDB (`@surrealdb/node` with its native engine `@surrealdb/node-native`), stored on disk with `surrealkv://` in `data/graphax.db`, using native graph relations (`RELATE`).

## Run locally

Requires Node.js 22.18 or later and pnpm. The transfer was built with Node.js 22 and pnpm 12. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run the automated API tests with `pnpm test`; they use a temporary database and fictional data.

## Design and version

The interface follows the SECTION 21 design system used across Teriak47 projects: warm bistre dark surfaces, a single cold blue accent, square corners with 21° cuts, straight links, eye-slit status markers and a footer signature. Chakra Petch and Fragment Mono (OFL-1.1, bundled with `@fontsource`) are loaded locally, so nothing is downloaded. The tokens are in `src/ds/`. Category colours and shapes in existing projects are kept; legacy rounded shapes are drawn as squares. Nodes can be square, cut-corner, hexagonal, diamond-shaped, octagonal or round, and links end on each outline.

A category can list default metadata keys (for example `IP`, `ASN`, `Pays`). They are added, empty, to its new nodes and to a node moved into it, and up to two of them can be shown under the node title. The inspector offers a node's missing keys in one click, and the preset categories come with their own keys.

A new project can start from five category sets: OSINT investigation (people, organisations, online accounts, contacts, places, events), Cyber / CTI (threat actors, malware, vulnerabilities, IPs, domains, victims), lore, research, or none. Shapes mean the same in every set: a circle is a person, a hexagon something technical, an octagon a threat or risk, a diamond something uncertain, a cut corner evidence or a document, and a square the rest. Categories keep their order, and new ones are added at the end.

Each node can carry a reliability grade, the Admiralty code: a source reliability from A (totally reliable) to F (cannot be judged) and an information credibility from 1 (confirmed) to 6 (cannot be judged), chosen in the inspector. It shows as a badge on the node and can be searched with `Fiabilité:B2`.

`Ctrl+C` copies the selected nodes (with the links between them) and `Ctrl+V` pastes copies a little to the side, in the same project or another one. A project can be duplicated from its card on the project list.

The "Exporter" menu saves the project as JSON (re-importable), a Markdown report, or a picture of the whole graph (SVG or PNG).

Several nodes can be selected at once: `Ctrl+click` (`Cmd` on Mac) adds or removes a node, and `Shift`+drag on the background selects the nodes inside a box. Dragging one of them moves the whole group; `Delete` (after confirmation) or the side panel deletes them with their links. `Escape` clears the selection.

Undo and redo are in the toolbar, and on `Ctrl+Z` and `Ctrl+Y` outside text fields. Moves, automatic layouts, node edits (title, notes, category, attributes), link edits (label, style, orientation, colour, notes, reversal), the category order and category edits can be undone, and so can creating or deleting a node (with its links), a link or a category. A deleted category comes back in its place, with the nodes that used it (unless they got another category since).

Right-click a node (without dragging) to change its category from a menu; the new category's missing default keys are added. Drag categories in the sidebar to reorder them (or use the up and down arrows on the handle). Before a category is deleted, the editor lists the nodes that will become unclassified. The same editor merges a category into another one (its nodes and default keys move there; `Ctrl+Z` undoes it). The bookmark button above the category list saves the project's categories as a preset, offered under "Mes presets" when creating a project.

The version shown in the footer comes from `package.json`, which must match `tool.yaml` (checked by `pnpm test`). `/api/health` also reports it.

Open the local Vite address shown in the terminal. The application starts a local API backed by SurrealDB. It cannot run by opening `index.html` directly. To build and start the unified server:

```sh
pnpm build
pnpm start
```

The project uses local disk storage under `data/` in the tool directory, whichever folder the server is started from; set `GRAPHAX_DATA_DIR` to use another location. This directory is ignored by Git and must not be published.

Snapshots: every 30 minutes, the server saves each project that changed to `data/snapshots/<project id>/` and keeps the 10 latest (`GRAPHAX_AUTO_SNAPSHOT_MINUTES` sets the interval, `0` turns it off). The "Instantanés" button in a project takes one on demand, restores one as a new project (the current project is left as it is) or deletes one. Snapshot files use the export format, so one can also be imported from the project list, even after its project was deleted. They live in the same `data/` directory: keep a copy elsewhere for important projects.

Planned fixes, optimisations and features are listed in the [roadmap](docs/ROADMAP.md).

Older versions on Windows created the database in a nested folder such as `<working directory>/D/…/data/graphax.db`. If no database exists at the expected place, Graphax copies one found there and logs it; the original is left untouched.

## Local API protection

The API listens on `127.0.0.1` only, sends no CORS headers, and refuses requests whose `Host` or `Origin` header is not the application itself or the Vite dev server (`localhost:5173`). Other websites therefore cannot read or modify local data, including through DNS rebinding. Additional origins can be allowed with `GRAPHAX_ALLOWED_ORIGINS` (comma-separated). There is no user authentication: anyone with access to your local machine session can use the API. The bundled demo uses fictional example addresses.

## Licence

Graphax is part of Teriak Toolbox under the repository's GPL v3 licence. Dependencies retain their own licences.
