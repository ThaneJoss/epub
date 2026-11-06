import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyBook } from '../src/worker.js';

const zip = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);
const token = Buffer.from('https://cdn.example.org/book.epub').toString('base64url');
const request = (range, method = 'GET') => new Request('https://epub.thanejoss.com/books/' + token + '.epub', {
  method, headers: range === null ? {} : { Range: range },
});
const response = (body, contentRange, contentLength) => new Response(body, {
  status: 206,
  headers: {
    'Content-Type': 'application/epub+zip',
    ...(contentRange === null ? {} : { 'Content-Range': contentRange }),
    ...(contentLength === undefined ? {} : { 'Content-Length': contentLength }),
  },
});

test('rejects reversed, zero-suffix and unsafe request ranges before fetching', async () => {
  for (const range of ['bytes=7-4', 'bytes=-0', 'bytes=9007199254740992-', 'bytes=0-9007199254740992', 'bytes=-9007199254740992', 'bytes=-']) {
    const result = await proxyBook(request(range), {}, () => assert.fail('invalid range reached upstream'));
    assert.equal(result.status, 416, range);
  }
});

test('rejects impossible, malformed and unsolicited partial responses', async () => {
  for (const contentRange of ['bytes 9-1/8', 'bytes 4-7/4', 'bytes 0-0/0', 'bytes 4-7/*',
    'bytes 4-7/9007199254740992', 'bytes 9007199254740992-9007199254740993/9007199254740994', null]) {
    const result = await proxyBook(request('bytes=4-7'), {}, async () => response(zip.subarray(4), contentRange));
    assert.equal(result.status, 502, String(contentRange));
  }
  const unsolicited = await proxyBook(request(null), {}, async () => response(zip, 'bytes 0-7/8'));
  assert.equal(unsolicited.status, 502);
});

test('partial response must stay inside the requested bounded, open or suffix range', async () => {
  for (const [range, contentRange] of [
    ['bytes=4-5', 'bytes 4-7/8'], ['bytes=4-', 'bytes 3-7/8'],
    ['bytes=-2', 'bytes 4-7/8'], ['bytes=8-', 'bytes 4-7/8'],
  ]) {
    const result = await proxyBook(request(range), {}, async () => response(zip.subarray(4), contentRange));
    assert.equal(result.status, 502, range + ' / ' + contentRange);
  }
});

test('supports bounded, open, suffix, clamped and subset responses', async () => {
  for (const [range, start, end] of [
    ['bytes=0-3', 0, 3], ['bytes=0-0', 0, 0], ['bytes=4-', 4, 7],
    ['bytes=-4', 4, 7], ['bytes=-99', 0, 7], ['bytes=4-99', 4, 7],
    ['bytes=0-7', 4, 7], ['bytes=4-', 5, 6], ['bytes=-4', 5, 6],
  ]) {
    const body = zip.subarray(start, end + 1);
    const result = await proxyBook(request(range), {}, async () => response(body, 'bytes ' + start + '-' + end + '/8', String(body.length)));
    assert.equal(result.status, 206, range);
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), body, range);
  }
});

test('partial Content-Length must equal the declared interval', async () => {
  for (const length of ['3', '5', '-1', '4.0', '9007199254740992']) {
    const result = await proxyBook(request('bytes=4-7'), {}, async () => response(zip.subarray(4), 'bytes 4-7/8', length));
    assert.equal(result.status, 502, length);
  }
  const head = await proxyBook(request('bytes=4-7', 'HEAD'), {}, async () => response(null, 'bytes 4-7/8', '4'));
  assert.equal(head.status, 206);
  assert.equal(head.body, null);
  assert.equal(head.headers.get('Content-Length'), '4');
});

test('rejects truncated and excess partial bodies without trusting Content-Length', async () => {
  for (const body of [new Uint8Array(3), new Uint8Array(5)]) {
    for (const length of [undefined, '4']) {
      let signal;
      const result = await proxyBook(request('bytes=4-7'), {}, async (_, options) => {
        signal = options.signal;
        return response(body, 'bytes 4-7/8', length);
      });
      assert.equal(result.status, 206);
      await assert.rejects(result.arrayBuffer(), /range length mismatch/);
      assert.ok(signal.aborted);
    }
  }
});

test('counts ZIP-prefix chunks toward the actual partial response length', async () => {
  for (const [body, contentRange] of [
    [zip.subarray(0, 2), 'bytes 0-3/8'], [zip, 'bytes 0-3/8'],
  ]) {
    const result = await proxyBook(request('bytes=0-3'), {}, async () => response(body, contentRange));
    assert.equal(result.status, 502);
  }
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(zip.subarray(0, 1));
      controller.enqueue(zip.subarray(1, 3));
      controller.enqueue(zip.subarray(3));
      controller.close();
    },
  });
  const result = await proxyBook(request('bytes=0-7'), {}, async () => response(body, 'bytes 0-7/8'));
  assert.equal(result.status, 206);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), zip);
});

test('range header errors cancel upstream bodies without changing full-response fallback', async () => {
  let canceled = false;
  let signal;
  const result = await proxyBook(request('bytes=4-7'), {}, async (_, options) => {
    signal = options.signal;
    return response(new ReadableStream({
      start(controller) { controller.enqueue(zip); },
      cancel() { canceled = true; },
    }), 'bytes 9-1/8');
  });
  assert.equal(result.status, 502);
  assert.ok(canceled);
  assert.ok(signal.aborted);
  const full = await proxyBook(request('bytes=4-7'), {}, async () => new Response(zip));
  assert.equal(full.status, 200);
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), zip);
});
