// Génère index.html : l'appli en un seul fichier (HTML + CSS + JS intégrés),
// à ouvrir directement sur le téléphone ou à publier avec GitHub Pages.
//   npm run build
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const js = (await build({
  entryPoints: [root('app/app.js')], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
})).outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(root('app/style.css'), 'utf8');
// Remplacement par fonction : sinon « $' », « $& »… présents dans le code minifié sont interprétés.
const html = readFileSync(root('app/index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}</style>`)
  .replace('<script type="module" src="app.js"></script>', () => `<script>${js}</script>`);
writeFileSync(root('index.html'), html);
console.log(`index.html (${Math.round(html.length / 1024)} Ko)`);
