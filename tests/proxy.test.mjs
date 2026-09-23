import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeToken, proxyBook, validateTarget } from '../src/worker.js';

const site = 'https://epub.thanejoss.com';
const remote = 'https://cdn.example.org/book.epub?signature=a%2Bb';
const token = value => Buffer.from(value).toString('base64url');
const request = (value = remote, options = {}) => new Request(`${site}/books/${token(value)}.epub`, options);
const zip = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);

test('UTF-8 URLs and signed query strings survive token encoding', () => {
  const url = 'https://cdn.example.org/书.epub?token=a+b/%25';
  assert.equal(decodeToken(token(url)), url);
  assert.equal(validateTarget(remote, site).href, remote);
  assert.throws(() => decodeToken('!bad!'));
});

test('rejects non-HTTPS, credentials, IP literals, internal names and self-proxying', async () => {
  for (const value of ['http://cdn.example.org/a.epub', 'https://a:b@cdn.example.org/a.epub', 'https://cdn.example.org:8443/a.epub',
    'https://127.0.0.1/a.epub', 'https://2130706433/a.epub', 'https://0x7f000001/a.epub', 'https://[::1]/a.epub',
    'https://[::ffff:127.0.0.1]/a.epub', 'https://localhost./a.epub', 'https://metadata.google.internal/a.epub',
    'https://intranet/a.epub', 'https://epub.thanejoss.com/a.epub']) {
    let fetched = false;
    const response = await proxyBook(request(value), {}, async () => { fetched = true; });
    assert.equal(response.status, 400, value);
    assert.equal(fetched, false, value);
  }
});

test('redirects are revalidated before fetching', async () => {
  const seen = [];
  const response = await proxyBook(request(), {}, async url => {
    seen.push(url);
    return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/admin' } });
  });
  assert.equal(response.status, 400);
  assert.equal(seen.length, 1);
});

test('relative redirects retain Range and never forward credentials', async () => {
  const calls = [];
  const response = await proxyBook(request(remote, { headers: { Range: 'bytes=4-7', Cookie: 'secret=yes', Authorization: 'Bearer secret', 'If-Range': '"v1"' } }), {}, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { Location: '/final.epub' } });
    return new Response(zip.subarray(4), { status: 206, headers: { 'Content-Type': 'application/epub+zip', 'Content-Range': 'bytes 4-7/8', 'Content-Length': '4', 'Accept-Ranges': 'bytes', ETag: '"v1"', 'Set-Cookie': 'bad=yes' } });
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 4-7/8');
  assert.equal(response.headers.get('Content-Length'), '4');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), zip.subarray(4));
  assert.equal(calls[1].url, 'https://cdn.example.org/final.epub');
  for (const call of calls) {
    assert.equal(call.options.headers.get('Range'), 'bytes=4-7');
    assert.equal(call.options.headers.get('If-Range'), '"v1"');
    assert.equal(call.options.headers.get('Cookie'), null);
    assert.equal(call.options.headers.get('Authorization'), null);
    assert.equal(call.options.redirect, 'manual');
  }
});

test('upstream that ignores Range can return a full ZIP without buffering', async () => {
  const response = await proxyBook(request(remote, { headers: { Range: 'bytes=0-3' } }), {}, async () => new Response(zip));
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), zip);
});

test('single-byte Range probes return 206', async () => {
  const response = await proxyBook(request(remote, { headers: { Range: 'bytes=0-0' } }), {}, async () => new Response(zip.subarray(0, 1), { status: 206, headers: { 'Content-Range': 'bytes 0-0/8' } }));
  assert.equal(response.status, 206);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), zip.subarray(0, 1));
});

test('HEAD, 304 and 416 preserve HTTP semantics', async () => {
  const head = await proxyBook(request(remote, { method: 'HEAD' }), {}, async (_, options) => {
    assert.equal(options.method, 'HEAD');
    return new Response(null, { headers: { 'Content-Type': 'application/epub+zip', 'Content-Length': '42', 'Accept-Ranges': 'bytes' } });
  });
  assert.equal(head.body, null);
  assert.equal(head.headers.get('Content-Length'), '42');
  for (const status of [304, 416]) {
    const response = await proxyBook(request(), {}, async () => new Response(null, { status, headers: { 'Content-Range': 'bytes */8' } }));
    assert.equal(response.status, status);
    assert.equal(response.body, null);
  }
});

test('rejects HTML/error pages, spoofed MIME, malformed tokens and multiple ranges', async () => {
  const html = await proxyBook(request(), {}, async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }));
  assert.equal(html.status, 415);
  const spoofed = await proxyBook(request(), {}, async () => new Response('<html>not a book</html>', { headers: { 'Content-Type': 'application/epub+zip' } }));
  assert.equal(spoofed.status, 415);
  const malformed = await proxyBook(new Request(`${site}/books/!!.epub`));
  assert.equal(malformed.status, 404);
  const range = await proxyBook(request(remote, { headers: { Range: 'bytes=0-3,8-9' } }), {}, () => assert.fail());
  assert.equal(range.status, 416);
});

test('size limits apply to full files, range totals and streams without a length', async () => {
  const env = { MAX_EPUB_MB: '1' };
  const large = await proxyBook(request(), env, async () => new Response(zip, { headers: { 'Content-Length': '1048577' } }));
  assert.equal(large.status, 413);
  const range = await proxyBook(request(remote, { headers: { Range: 'bytes=-4' } }), env, async () => new Response(zip.subarray(4), { status: 206, headers: { 'Content-Range': 'bytes 1048573-1048576/1048577' } }));
  assert.equal(range.status, 413);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(zip); controller.enqueue(new Uint8Array(1048576)); controller.close(); } });
  const chunked = await proxyBook(request(), env, async () => new Response(stream));
  assert.equal(chunked.status, 200);
  await assert.rejects(chunked.arrayBuffer(), /size limit/);
});

test('aborts the upstream when the browser cancels', async () => {
  let canceled = false;
  let signal;
  const response = await proxyBook(request(), {}, async (_, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(zip); }, cancel() { canceled = true; } }));
  });
  await response.body.cancel();
  assert.ok(signal.aborted);
  assert.ok(canceled);
});

test('allowlist also checks redirected hosts; methods and cross-site requests are blocked', async () => {
  const denied = await proxyBook(request(), { ALLOWED_HOSTS: 'books.example.org' }, () => assert.fail());
  assert.equal(denied.status, 403);
  const redirect = await proxyBook(request(), { ALLOWED_HOSTS: 'cdn.example.org' }, async () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example.org/book.epub' } }));
  assert.equal(redirect.status, 403);
  const post = await proxyBook(request(remote, { method: 'POST' }), {}, () => assert.fail());
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  const cross = await proxyBook(request(remote, { headers: { Origin: 'https://other.example.org' } }), {}, () => assert.fail());
  assert.equal(cross.status, 403);
});

test('redirect loops and upstream failures produce useful errors', async () => {
  let calls = 0;
  const loop = await proxyBook(request(), {}, async () => { calls++; return new Response(null, { status: 302, headers: { Location: remote } }); });
  assert.equal(loop.status, 502);
  assert.equal(calls, 5);
  const missing = await proxyBook(request(), {}, async () => new Response('not found', { status: 404 }));
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /找不到/);
});
