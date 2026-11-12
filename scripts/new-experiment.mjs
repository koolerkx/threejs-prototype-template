#!/usr/bin/env node
// Scaffolds src/experiments/<id>/ from src/experiments/_template/.
//   yarn new energy-shield
//   yarn new energy-shield --title "Energy shield"
import { cp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { title: { type: 'string' } } });
const id = positionals[0];
if (!id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  console.error('Usage: yarn new <kebab-case-id> [--title "Readable title"]');
  process.exit(2);
}

const root = resolve('src/experiments');
const target = join(root, id);
if (await stat(target).catch(() => null)) {
  console.error(`src/experiments/${id} already exists.`);
  process.exit(1);
}

const title = values.title ?? id.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
await cp(join(root, '_template'), target, { recursive: true });
for (const name of await readdir(target)) {
  const file = join(target, name);
  if (!/\.(ts|md)$/.test(name)) continue;
  const text = await readFile(file, 'utf8');
  await writeFile(file, text.replaceAll('__TITLE__', title).replaceAll('__ID__', id));
}
console.log(`Created src/experiments/${id}/ (index.ts, brief.md). Open http://127.0.0.1:5173/?exp=${id}`);
