import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'dist');
const output = resolve(root, 'dist-pages');
await stat(resolve(source, 'index.html'));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await cp(source, resolve(output, 'aoe1'), { recursive: true });
for (const destination of [output, resolve(output, 'aoe1')]) {
  await cp(resolve(root, 'LICENSE'), resolve(destination, 'LICENSE'));
  await cp(resolve(root, 'docs/ASSETS.md'), resolve(destination, 'ASSETS.md'));
}
console.log('Packaged GitHub Pages artifact at dist-pages/ and dist-pages/aoe1/.');

if (process.argv.includes('--serve')) {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
    '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      let path = resolve(output, `.${pathname}`);
      if (path !== output && !path.startsWith(`${output}${sep}`)) { response.writeHead(403).end('Forbidden'); return; }
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      const bytes = await readFile(path);
      response.writeHead(200, { 'Content-Type': path.endsWith('/LICENSE') ? 'text/plain; charset=utf-8' : types[extname(path)] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); }
  });
  server.listen(4173, '127.0.0.1', () => console.log('Production Pages artifact: http://127.0.0.1:4173/aoe1/'));
}
