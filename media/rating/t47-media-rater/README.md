# T47 Media Score

Rate films, series, anime, books, and music on a seven-point scale with optional per-criterion weights. The application converts the weighted score to scales of 10 and 5 and can export an Obsidian-compatible Markdown note. The interface is in French.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the local address shown by Vite. To check the project and create a production build, run `npm run check`, `npm test`, and `npm run build`. The development server listens on all network interfaces by default. This application requires a Vite server or a build served over HTTP; opening the source `index.html` directly is not supported.

## Use

Choose a media type, enter a title, rate at least one criterion, and adjust weights if needed. Calculate the result, then copy a summary or download a Markdown note. An optional cover image path or URL can be included in the note's frontmatter; no vault or image is required. Unrated criteria are omitted from the weighted average. Changing media type resets the current form.

The application does not store ratings between sessions. Clipboard access depends on browser permissions and a secure context such as `localhost`. Fonts are requested from Google Fonts when available; fallback fonts are used if they cannot be loaded.

## Licence

This tool is part of Teriak Toolbox and is distributed under the repository's GPL v3 licence. Dependencies retain their own licences; see the package lock and the licence files in installed packages.
