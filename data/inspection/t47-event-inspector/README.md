# Event Inspector

Explore and compare event records in JSON or NDJSON files in a local browser. The interface is in French.

## Start

Open `index.html` directly in a modern browser. No installation or server is required. Use **Importer** or drag and drop one or more files into the page. The included `exemple_A.ndjson` and `exemple_B.ndjson` contain fictional data for trying the interface.

## Features

- Browse records and their fields; choose and reorder visible columns.
- Search, filter, sort, and inspect individual events.
- Compare two imported datasets or filtered subsets using selected keys and fields.
- Copy selected records as JSON, NDJSON, or tab-separated text.

Files are processed locally in browser memory. Large files may exceed the browser's available memory; the built-in **Limites & Aide** panel describes further limits. Clipboard availability depends on the browser and its permissions. Interpretation of the events and comparison results remains the user's responsibility.

## Known limitations

- A property whose name contains a dot can be confused with a nested property having the same displayed path during comparison. A difference can be missed.
- Extremely small nonzero JSON numbers such as `1e-400` can be converted to zero during import. The built-in claim of exact numerical preservation does not cover this case.

Check original records when these cases may apply. These inherited issues are tracked for a later tool review.

## Licence

This tool is part of Teriak Toolbox and is distributed under the repository's GPL v3 licence.
