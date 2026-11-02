# T47 Event Inspector

Explore and compare event records in JSON or NDJSON files in a local browser. The interface is in English.

## Start

Open `index.html` directly in a modern browser. No installation or server is required. Use **Import** or drag and drop one or more files into the page. The included `exemple_A.ndjson` and `exemple_B.ndjson` contain fictional data for trying the interface.

## Features

- Browse records and their fields; choose and reorder visible columns.
- Search, filter, sort, and inspect individual events.
- Compare two imported datasets or filtered subsets using selected keys and fields.
- Copy selected records as JSON, NDJSON, or tab-separated text.

Field paths distinguish a literal key such as `["a.b"]` from a nested path such as `a.b`. Numbers that cannot be represented without changing their value are retained as raw JSON numbers, including very small nonzero values.

Files are processed locally in browser memory. Large files may exceed the browser's available memory; the built-in help panel describes further limits. Clipboard availability depends on the browser and its permissions. Interpretation of the events and comparison results remains the user's responsibility.

## Limitations

The application runs in browser memory, so available memory and browser limits constrain file sizes and operations. Check the original records when the outcome is important.

SECTION 21's Chakra Petch and Fragment Mono fonts are used when installed locally; otherwise the page uses system fonts. The application does not download fonts or other resources.

## Tests

With Node.js 22 or later, run `node --test tests/*.test.cjs` from this directory. Node.js is needed only to run the tests, not to use the application.

## Licence

This tool is part of Teriak Toolbox and is distributed under the repository's GPL v3 licence.
