# Graphax — beta

🌐 **Language:** English | [Français](README.fr.md)

Graphax is a local interactive graph board for investigations, research, and story development. Create projects, nodes, categories, and relationships; arrange the graph and import or export projects as JSON. The interface is in French.

**Beta:** the application is under development and has not yet received a complete security and functionality review. Keep independent backups of important projects.

Reversing a link now keeps pending edits, and a failed save is reported with a retry action instead of showing "saved". Deleting the selected node or link with the Delete or Backspace key now asks for confirmation first. Creating, importing and deleting a project, a category or a node is now done in a single transaction, so a failure leaves no partial data, and the API refuses links, nodes and categories that refer to a missing project, node or category, or to another project. Request bodies are validated and limited to 2 MB (50 MB for an import). The remaining review items (see the repository issue tracker) are still open, so keep exported backups of important projects.

## Run locally

Requires Node.js 22.18 or later and pnpm. The transfer was built with Node.js 22 and pnpm 12. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run the automated API tests with `pnpm test`; they use a temporary database and fictional data.

## Design and version

The interface follows the SECTION 21 design system used across Teriak47 projects: warm bistre dark surfaces, a single cold blue accent, square corners with 21° cuts, straight links, eye-slit status markers and a footer signature. Chakra Petch and Fragment Mono (OFL-1.1, bundled with `@fontsource`) are loaded locally, so nothing is downloaded. The tokens are in `src/ds/`. Category colours and shapes in existing projects are kept; legacy rounded shapes are drawn as squares.

The version shown in the footer comes from `package.json`, which must match `tool.yaml` (checked by `pnpm test`). `/api/health` also reports it.

Open the local Vite address shown in the terminal. The application starts a local API backed by SurrealDB. It cannot run by opening `index.html` directly. To build and start the unified server:

```sh
pnpm build
pnpm start
```

The project uses local disk storage under `data/` in the tool directory, whichever folder the server is started from; set `GRAPHAX_DATA_DIR` to use another location. This directory is ignored by Git and must not be published. Export and back up projects separately when needed.

Planned fixes, optimisations and features are listed in the [roadmap](docs/ROADMAP.md).

Older versions on Windows created the database in a nested folder such as `<working directory>/D/…/data/graphax.db`. If no database exists at the expected place, Graphax copies one found there and logs it; the original is left untouched.

## Local API protection

The API listens on `127.0.0.1` only, sends no CORS headers, and refuses requests whose `Host` or `Origin` header is not the application itself or the Vite dev server (`localhost:5173`). Other websites therefore cannot read or modify local data, including through DNS rebinding. Additional origins can be allowed with `GRAPHAX_ALLOWED_ORIGINS` (comma-separated). There is no user authentication: anyone with access to your local machine session can use the API. The bundled demo uses fictional example addresses.

## Licence

Graphax is part of Teriak Toolbox under the repository's GPL v3 licence. Dependencies retain their own licences.
