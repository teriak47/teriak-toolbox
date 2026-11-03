import fs from 'node:fs';
import path from 'node:path';

// The tool version lives in package.json and tool.yaml (kept identical by a test)
export const APP_VERSION: string = (
  JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf-8')
  ) as { version: string }
).version;
