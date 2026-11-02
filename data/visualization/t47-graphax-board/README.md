# Graphax — beta

🌐 **Language:** English | [Français](README.fr.md)

Graphax is a local interactive graph board for investigations, research, and story development. Create projects, nodes, categories, and relationships; arrange the graph and import or export projects as JSON. The interface is in French.

**Beta:** the application is under development and has not yet received a complete security and functionality review. Keep independent backups of important projects.

## Run locally

Requires Node.js 22.18 or later and pnpm. The transfer was built with Node.js 22 and pnpm 12. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local Vite address shown in the terminal. The application starts a local API backed by SurrealDB. It cannot run by opening `index.html` directly. To build and start the unified server:

```sh
pnpm build
pnpm start
```

The project uses local disk storage under `data/`; this directory is ignored by Git and must not be published. Export and back up projects separately when needed.

## Current security limitation

The API binds to localhost but currently permits cross-origin requests without application authentication. A malicious website open in the same browser may be able to access or modify local Graphax data while the application is running. This requires review before relying on Graphax for sensitive data. The bundled demo uses fictional example addresses.

## Licence

Graphax is part of Teriak Toolbox under the repository's GPL v3 licence. Dependencies retain their own licences.
