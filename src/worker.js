// This proxy is intended for Cloudflare Workers' public fetch(), with no VPC bindings.
const MAX_URL_LENGTH = 6000;
const MAX_REDIRECTS = 4;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const EPUB_TYPES = new Set([
  'application/epub+zip', 'application/zip', 'application/x-zip-compressed',
  'application/octet-stream', 'binary/octet-stream', 'application/download',
  'application/x-download',
]);

class ProxyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validateTarget(value, requestUrl, allowedHosts = '') {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
    throw new ProxyError('链接过长。');
  }
  let target;
  try { target = new URL(value); } catch { throw new ProxyError('请输入有效的 EPUB 链接。'); }
  if (target.protocol !== 'https:' || target.username || target.password || target.port) {
    throw new ProxyError('仅支持不含用户名、密码及自定义端口的 HTTPS 链接。');
  }
  const host = target.hostname.toLowerCase().replace(/\.$/, '');
  // Reject every IP literal (including URL-normalized hexadecimal/octal IPv4),
  // single-label/internal hostnames, and recursion through this Worker.
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') ||
      !/^[a-z0-9.-]+$/.test(host) || host.split('.').some(part => !part || part.startsWith('-') || part.endsWith('-')) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(host) ||
      host === new URL(requestUrl).hostname.toLowerCase().replace(/\.$/, '') ||
      host === 'epub.thanejoss.com') {
    throw new ProxyError('请使用公网 EPUB 文件地址。');
  }
  const allowlist = allowedHosts.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (allowlist.length && !allowlist.includes(host)) throw new ProxyError('此文件来源未被允许。', 403);
  target.hostname = host;
  target.hash = '';
  return target;
}

export function decodeToken(token) {
  if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length > 8000) throw new ProxyError('无效的阅读链接。');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)),
    );
  } catch { throw new ProxyError('无效的阅读链接。'); }
}

// Keep numeric range arithmetic exact; the proxy only supports one byte range.
function parseRange(value) {
  if (value === null) return null;
  const match = value.length <= 80 && /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new ProxyError('不支持此 Range 请求。', 416);
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if ([start, end].some(number => number !== null && !Number.isSafeInteger(number)) ||
      (start === null ? end === 0 : end !== null && end < start)) {
    throw new ProxyError('不支持此 Range 请求。', 416);
  }
  return { start, end };
}

function validatePartialResponse(headers, range) {
  const invalid = () => new ProxyError('来源网站返回了无效的分段数据。', 502);
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get('Content-Range') || '');
  if (!range || !match) throw invalid();
  const [start, end, total] = match.slice(1).map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || start > end || end >= total) throw invalid();
  const requestedStart = range.start === null ? Math.max(0, total - range.end) : range.start;
  const requestedEnd = range.start === null || range.end === null ? total - 1 : Math.min(range.end, total - 1);
  // RFC 9110 permits a server to return a subset of the requested data.
  if (start < requestedStart || end > requestedEnd) throw invalid();
  const length = end - start + 1;
  const contentLength = headers.get('Content-Length');
  if (contentLength !== null &&
      (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)) || Number(contentLength) !== length)) {
    throw invalid();
  }
  return { start, end, total, length };
}

function responseHeaders() {
  return new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
}

function errorResponse(error, method) {
  const headers = responseHeaders();
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  if (error.status === 405) headers.set('Allow', 'GET, HEAD');
  return new Response(method === 'HEAD' ? null : error.message, { status: error.status, headers });
}

export async function proxyBook(request, env = {}, fetcher = fetch) {
  let upstream;
  let reader;
  let timer;
  let controller;
  let onAbort;
  const cleanup = () => {
    clearTimeout(timer);
    if (onAbort) request.signal.removeEventListener('abort', onAbort);
  };
  try {
    if (!['GET', 'HEAD'].includes(request.method)) throw new ProxyError('仅支持 GET 和 HEAD。', 405);
    const incoming = new URL(request.url);
    const origin = request.headers.get('Origin');
    if ((origin && origin !== incoming.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      throw new ProxyError('请从本站打开阅读链接。', 403);
    }
    const match = /^\/books\/([A-Za-z0-9_-]+)\.epub$/.exec(incoming.pathname);
    if (!match) throw new ProxyError('文件不存在。', 404);
    const allowedHosts = env.ALLOWED_HOSTS || '';
    let target = validateTarget(decodeToken(match[1]), request.url, allowedHosts);
    const range = request.headers.get('Range');
    const requestedRange = parseRange(range);
    const headers = new Headers({ 'Accept': 'application/epub+zip, application/zip, application/octet-stream', 'Accept-Encoding': 'identity' });
    for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    // Never forward cookies, authorization, client IPs, origin or referrer.
    controller = new AbortController();
    onAbort = () => controller.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) controller.abort();
    timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    for (let redirects = 0; ; redirects++) {
      upstream = await fetcher(target.href, {
        method: request.method, headers, redirect: 'manual', signal: controller.signal,
      });
      if (!REDIRECTS.has(upstream.status)) break;
      const location = upstream.headers.get('Location');
      await upstream.body?.cancel();
      if (!location || redirects >= MAX_REDIRECTS) throw new ProxyError('文件重定向过多或地址无效。', 502);
      target = validateTarget(new URL(location, target).href, request.url, allowedHosts);
    }
    const outputHeaders = responseHeaders();
    for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
      if (upstream.headers.has(name)) outputHeaders.set(name, upstream.headers.get(name));
    }
    if ([304, 416].includes(upstream.status)) {
      await upstream.body?.cancel();
      cleanup();
      outputHeaders.delete('Content-Length');
      return new Response(null, { status: upstream.status, headers: outputHeaders });
    }
    if (![200, 206].includes(upstream.status)) {
      const message = upstream.status === 404 ? '找不到此 EPUB 文件，请检查链接。'
        : [401, 403].includes(upstream.status) ? '来源网站拒绝访问，请使用可公开下载的文件直链。'
        : `来源网站暂时无法提供文件（HTTP ${upstream.status}）。`;
      throw new ProxyError(message, [401, 403, 404].includes(upstream.status) ? upstream.status : 502);
    }
    const type = (upstream.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (type && !EPUB_TYPES.has(type)) throw new ProxyError('链接返回的不是 EPUB 文件，请使用文件直链。', 415);
    if (upstream.headers.has('Content-Encoding') && upstream.headers.get('Content-Encoding') !== 'identity') {
      throw new ProxyError('来源网站使用了不支持的文件压缩传输。', 502);
    }
    const partial = upstream.status === 206 ? validatePartialResponse(upstream.headers, requestedRange) : null;
    const configuredLimit = Number(env.MAX_EPUB_MB || 100);
    const maxBytes = (Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 100) * 1024 * 1024;
    const total = upstream.headers.get('Content-Range')?.match(/\/(\d+)$/)?.[1];
    if (Number(upstream.headers.get('Content-Length')) > maxBytes || Number(total) > maxBytes) {
      throw new ProxyError(`文件过大，当前上限为 ${maxBytes / 1024 / 1024} MB。`, 413);
    }
    outputHeaders.set('Content-Type', 'application/epub+zip');
    outputHeaders.set('Content-Disposition', 'inline; filename="book.epub"');
    if (request.method === 'HEAD') {
      await upstream.body?.cancel();
      cleanup();
      return new Response(null, { status: upstream.status, headers: outputHeaders });
    }
    if (!upstream.body) throw new ProxyError('文件内容为空。', 502);
    reader = upstream.body.getReader();
    // Only hold the first few bytes/chunks. Never buffer an entire EPUB.
    let prefix = [];
    let received = 0;
    if (upstream.status === 200 || partial?.start === 0) {
      const signatureLength = partial ? Math.min(4, partial.length) : 4;
      while (received < signatureLength) {
        const result = await reader.read();
        if (result.done) {
          if (partial && received !== partial.length) throw new ProxyError('来源网站返回的分段长度不一致。', 502);
          break;
        }
        prefix.push(result.value);
        received += result.value.byteLength;
        if (received > maxBytes) throw new ProxyError('文件超过大小限制。', 413);
        if (partial && received > partial.length) throw new ProxyError('来源网站返回的分段长度不一致。', 502);
      }
      const signature = prefix.flatMap(chunk => Array.from(chunk.subarray(0, signatureLength))).slice(0, signatureLength);
      if (signature.join(',') !== [80, 75, 3, 4].slice(0, signatureLength).join(',')) throw new ProxyError('文件不是有效的 EPUB / ZIP。', 415);
    }
    const stream = new ReadableStream({
      async pull(streamController) {
        try {
          if (prefix.length) { streamController.enqueue(prefix.shift()); return; }
          const { done, value } = await reader.read();
          if (done) {
            if (partial && received !== partial.length) throw new Error('EPUB range length mismatch');
            cleanup();
            streamController.close();
            return;
          }
          received += value.byteLength;
          if (received > maxBytes) throw new Error('EPUB size limit exceeded');
          if (partial && received > partial.length) throw new Error('EPUB range length mismatch');
          streamController.enqueue(value);
        } catch (error) {
          cleanup();
          controller.abort();
          await reader.cancel().catch(() => {});
          streamController.error(error);
        }
      },
      async cancel(reason) {
        cleanup();
        controller.abort();
        await reader.cancel(reason).catch(() => {});
      },
    });
    return new Response(stream, { status: upstream.status, headers: outputHeaders });
  } catch (error) {
    cleanup();
    controller?.abort();
    if (reader) await reader.cancel().catch(() => {});
    else await upstream?.body?.cancel().catch(() => {});
    return errorResponse(error instanceof ProxyError ? error
      : new ProxyError(error.name === 'AbortError' ? '下载超时，请稍后重试。' : '无法连接文件来源，请检查链接后重试。', 502), request.method);
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/books/')) return proxyBook(request, env);
    return env.ASSETS.fetch(request);
  },
};
