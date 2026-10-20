import { readFile } from 'node:fs/promises';
export async function moduleURL(name) {
  let source = await readFile(new URL('../web/js/' + name, import.meta.url), 'utf8');
  const paths = [...source.matchAll(/from\s+"\.\/([^"\n]+)"/g)];
  for (const path of paths) source = source.replace(path[0], 'from ' + JSON.stringify(await moduleURL(path[1])));
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
