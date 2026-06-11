// Anti-detection helpers.
// To resist active probing, requests that are not proxy/subscription/admin
// traffic can be transparently reverse-proxied to a real website (FAKE_WEBSITE),
// so the deployment looks like an ordinary site. If no FAKE_WEBSITE is set we
// return a benign, generic page instead of revealing anything.

const DEFAULT_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>Welcome to nginx!</title><style>body{width:35em;margin:0 auto;
font-family:Tahoma,Verdana,Arial,sans-serif}</style></head><body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>
<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p></body></html>`;

/**
 * Produce a camouflage response for non-sensitive requests.
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {URL} url
 */
export async function camouflage(request, env, url) {
  const target = env.FAKE_WEBSITE;
  if (target) {
    try {
      const base = target.startsWith('http') ? target : `https://${target}`;
      const upstream = new URL(base);
      const proxied = new URL(url.pathname + url.search, upstream.origin);
      const res = await fetch(proxied.toString(), {
        method: request.method,
        headers: filterHeaders(request.headers, upstream.host),
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow',
      });
      const headers = new Headers(res.headers);
      headers.delete('content-security-policy');
      headers.delete('content-security-policy-report-only');
      // fetch() already decoded the body; drop stale encoding/length headers.
      headers.delete('content-encoding');
      headers.delete('content-length');
      return new Response(res.body, { status: res.status, headers });
    } catch {
      // fall through to default page
    }
  }
  return new Response(DEFAULT_PAGE, {
    status: 200,
    headers: { 'content-type': 'text/html;charset=utf-8', server: 'nginx' },
  });
}

function filterHeaders(headers, host) {
  const out = new Headers();
  for (const [k, v] of headers) {
    const lk = k.toLowerCase();
    if (lk === 'host' || lk === 'cf-connecting-ip' || lk.startsWith('cf-')) continue;
    out.set(k, v);
  }
  out.set('host', host);
  return out;
}
