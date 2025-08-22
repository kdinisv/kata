import { readdir, stat, rename } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function walk(dir, cb) {
  const items = await readdir(dir);
  for (const name of items) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, cb);
    else await cb(p);
  }
}

const root = fileURLToPath(new URL('../dist/cjs/', import.meta.url));
await walk(root, async (p) => {
  if (extname(p) === '.js') {
    const target = p.slice(0, -3) + '.cjs';
    await rename(p, target);
    // eslint-disable-next-line no-console
    console.log(`renamed ${p} -> ${target}`);
  }
});
