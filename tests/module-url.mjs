import { readFile } from 'node:fs/promises';
// Resolves relative imports against the importing file, so nested folders
// (i18n.js -> ./i18n/es.js -> ./es/common.js) inline correctly; every
// dependency is folded into one data: URL module.
export async function moduleURL(name, base = '') {
  let source = await readFile(new URL('../web/js/' + base + name, import.meta.url), 'utf8');
  const paths = [...source.matchAll(/from\s+"\.\/([^"\n]+)"/g)];
  for (const path of paths) {
    const childBase = (base + name).replace(/[^/]*$/, '');
    source = source.replace(path[0], 'from ' + JSON.stringify(await moduleURL(path[1], childBase)));
  }
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
