// Builds dist/spiderman.html — the entire game (three.js + code + styles)
// inlined into ONE self-contained file. It can be opened directly from the
// iPhone Files app in Safari, AirDropped, emailed, or hosted anywhere.
//
//   node tools/build-single.mjs

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  alias: { three: join(root, 'vendor/three.module.js') },
  write: false,
});
// escape sequences that would terminate the inline <script> tag early
const js = result.outputFiles[0].text
  .replaceAll('</script', '<\\/script')
  .replaceAll('<!--', '<\\!--');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');

let html = readFileSync(join(root, 'index.html'), 'utf8');
// strip the import map, external stylesheet and module-script tags
// NB: replacer functions, not strings — minified JS contains `$&` sequences
// that string replacements would expand into the matched text.
html = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, () => '')
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="[^"]*"><\/script>/, () => `<script>\n${js}\n</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/spiderman.html'), html);
console.log(`dist/spiderman.html written (${(html.length / 1024).toFixed(0)} KB)`);
