// Serves the chat archive out of a PRIVATE R2 bucket behind a password prompt.
// Bucket layout: index.html, your export .json, and its *_Files media folder, all as plain files.
//
// Setup: bind the bucket as BUCKET, and add a secret named SITE_PASSWORD (see README).
// If you'd rather gate it with Cloudflare Access, set the plain variable ACCESS_ONLY=1 and skip the password.

const MIME = {
  html: 'text/html; charset=utf-8', json: 'application/json', js: 'text/javascript', css: 'text/css',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', opus: 'audio/ogg', aac: 'audio/aac',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
};
const te = new TextEncoder();

async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([a, b].map(async s => new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s)))));
  return crypto.subtle.timingSafeEqual(ha, hb);
}
const unauthorized = () => new Response('Password required', {
  status: 401,
  headers: {'WWW-Authenticate': 'Basic realm="Chat archive", charset="UTF-8"', 'Cache-Control': 'no-store'},
});

export default {
  async fetch(request, env) {
    if (!env.SITE_PASSWORD && env.ACCESS_ONLY !== '1') {
      return new Response('Not configured yet: add the SITE_PASSWORD secret (see README).', {status: 503});
    }
    if (env.SITE_PASSWORD) {
      const h = request.headers.get('Authorization') || '';
      let ok = false;
      if (h.startsWith('Basic ')) {
        try {
          const dec = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), c => c.charCodeAt(0)));
          ok = await safeEqual(dec.slice(dec.indexOf(':') + 1), env.SITE_PASSWORD); // username can be anything
        } catch (e) { ok = false; }
      }
      if (!ok) return unauthorized();
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', {status: 405});

    const url = new URL(request.url);
    let key;
    try { key = decodeURIComponent(url.pathname.slice(1)); } catch (e) { return new Response('Bad request', {status: 400}); }

    // The viewer calls this to find your export's .json file(s) at the top level of the bucket.
    if (key === '__list') {
      const names = []; let cursor;
      do {
        const l = await env.BUCKET.list({delimiter: '/', cursor});
        for (const o of l.objects) if (/\.json$/i.test(o.key)) names.push(o.key);
        cursor = l.truncated ? l.cursor : undefined;
      } while (cursor);
      return new Response(JSON.stringify(names), {headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
    }

    if (!key || key.endsWith('/')) key += 'index.html';

    let obj;
    try { obj = await env.BUCKET.get(key, {onlyIf: request.headers, range: request.headers}); }
    catch (e) { return new Response('Range not satisfiable', {status: 416}); }
    if (!obj) return new Response('Not found', {status: 404});

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('accept-ranges', 'bytes');
    const ext = key.split('.').pop().toLowerCase();
    const ct = headers.get('content-type');
    if ((!ct || ct === 'application/octet-stream') && MIME[ext]) headers.set('content-type', MIME[ext]);
    headers.set('cache-control', /^(html|json)$/.test(ext) ? 'private, max-age=0, must-revalidate' : 'private, max-age=86400');
    headers.set('x-robots-tag', 'noindex, nofollow');
    headers.set('x-content-type-options', 'nosniff');

    if (!('body' in obj)) {
      const notModified = request.headers.has('if-none-match') || request.headers.has('if-modified-since');
      return new Response(null, {status: notModified ? 304 : 412, headers});
    }

    let status = 200;
    if (request.headers.has('range') && obj.range) {
      const r = obj.range, size = obj.size;
      let start, end;
      if (r.suffix !== undefined) { start = Math.max(0, size - r.suffix); end = size - 1; }
      else { start = r.offset ?? 0; end = r.length !== undefined ? start + r.length - 1 : size - 1; }
      headers.set('content-range', `bytes ${start}-${end}/${size}`);
      headers.set('content-length', String(end - start + 1));
      status = 206;
    }
    return new Response(request.method === 'HEAD' ? null : obj.body, {status, headers});
  },
};