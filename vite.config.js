import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Every sketch folder (except _template) becomes its own page.
const root = import.meta.dirname;
const input = { main: resolve(root, 'index.html') };
for (const dir of readdirSync(resolve(root, 'sketches'), { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name === '_template') continue;
  const page = resolve(root, 'sketches', dir.name, 'index.html');
  if (existsSync(page)) input[dir.name] = page;
}

export default defineConfig({
  build: {
    rollupOptions: { input },
  },
});
