// Local browser-test adapter. Production still runs src/worker.js on Workers.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { proxyBook } from '../src/worker.js';
import { makeEpub } from './fixture.mjs';

const bytes = makeEpub();
const root = resolve('dist');
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain' };
const assetHeaders = Object.fromEntries((await readFile('dist/_headers', 'utf8')).split('\n').filter(line => line.startsWith('  ')).map(line => {
  const separator = line.indexOf(':');
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
}));

async function fixtureFetch(url, options) {
  if (new URL(url).hostname !== 'fixtures.example.org') throw new Error('Unknown test upstream');
  if (new URL(url).pathname === '/missing.epub') return new Response(null, { status: 404 });
  if (new URL(url).pathname === '/html') return new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } });
  const headers = new Headers({ 'Content-Type': 'application/epub+zip', 'Accept-Ranges': 'bytes', 'Content-Length': String(bytes.length), ETag: '"fixture-v1"' });
  let body = bytes;
  let status = 200;
  const match = options.headers.get('Range')?.match(/^bytes=(\d*)-(\d*)$/);
  if (match) {
    const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (start >= bytes.length || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
    body = bytes.slice(start, end + 1);
    headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
    headers.set('Content-Length', String(body.length));
    status = 206;
  }
  return new Response(options.method === 'HEAD' ? null : body, { status, headers });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:8788');
    if (url.pathname.startsWith('/books/')) {
      const result = await proxyBook(new Request(url, { method: req.method, headers: req.headers }), {}, fixtureFetch);
      res.writeHead(result.status, Object.fromEntries(result.headers));
      if (result.body) {
        const stream = Readable.fromWeb(result.body);
        res.on('close', () => stream.destroy());
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      } else res.end();
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!path.startsWith(root + '/')) { res.writeHead(404).end(); return; }
    try {
      let data = await readFile(path);
      const headers = { ...assetHeaders, 'Content-Type': types[path.split('.').pop()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
      let status = 200;
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
        headers['Content-Range'] = `bytes ${start}-${end}/${data.length}`;
        data = data.subarray(start, end + 1);
        status = 206;
      }
      headers['Content-Length'] = String(data.length);
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404, { ...assetHeaders, 'Content-Type': 'text/html' }).end(await readFile('dist/404.html')); }
  } catch (error) { console.error(error); res.writeHead(500).end(); }
}).listen(8788, '127.0.0.1', () => console.log('Browser test server: http://127.0.0.1:8788'));
