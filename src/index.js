// Entry point / HTTP router for both Cloudflare Workers and Pages.
// - WebSocket upgrade  -> VLESS proxy core (carries real traffic)
// - HTTP routes        -> login page, admin panel, subscription, JSON APIs
import { vlessOverWSHandler, isValidUUID } from './vless.js';
import { buildNodes, buildSubscription, nodeTemplates } from './nodes.js';
import {
  resolvePassword,
  savePassword,
  createToken,
  isAuthed,
  sessionCookie,
  clearCookie,
} from './auth.js';
import { loginPage, panelPage } from './html.js';

const DEFAULT_UUID = '86c50e3a-5b87-49dd-bd20-03c7f2735e40';

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json;charset=utf-8' },
    ...init,
  });
}

function html(body, init = {}) {
  return new Response(body, {
    headers: { 'content-type': 'text/html;charset=utf-8' },
    ...init,
  });
}

function passwordBackendLabel(env) {
  if (env.DB) return 'D1 数据库';
  if (env.KV) return 'KV 命名空间';
  return '环境变量 (PASSWORD)';
}

async function handleFetch(request, env) {
  const userID = (env.UUID && isValidUUID(env.UUID) ? env.UUID : DEFAULT_UUID).toLowerCase();
  const proxyIP = env.PROXYIP || '';

  // 1) VLESS over WebSocket — the actual proxy traffic.
  if (request.headers.get('Upgrade') === 'websocket') {
    return vlessOverWSHandler(request, userID, proxyIP);
  }

  const url = new URL(request.url);
  const host = env.DOMAIN || url.hostname;
  const path = url.pathname;

  // 2) Public subscription: /sub/{uuid}?type=vless|tuic|all&count=10
  if (path.startsWith('/sub/')) {
    const subUuid = path.slice('/sub/'.length).split('/')[0];
    if (!isValidUUID(subUuid)) return new Response('invalid uuid', { status: 400 });
    const type = url.searchParams.get('type') || 'vless';
    const count = Math.min(Number(url.searchParams.get('count')) || 10, 50);
    const body = buildSubscription(
      { uuid: subUuid, host, password: env.TUIC_PASSWORD || subUuid, preferred: env.PREFERRED_IPS, count },
      type,
    );
    return new Response(body, {
      headers: {
        'content-type': 'text/plain;charset=utf-8',
        'profile-update-interval': '6',
        'subscription-userinfo': 'upload=0; download=0; total=0',
      },
    });
  }

  // 3) Login
  if (path === '/login' && request.method === 'POST') {
    const form = await request.formData();
    const password = String(form.get('password') || '');
    const real = await resolvePassword(env);
    if (password && password === real) {
      const token = await createToken(env, real);
      return html(panelRedirect(), {
        status: 302,
        headers: { Location: '/', 'Set-Cookie': sessionCookie(token) },
      });
    }
    return html(loginPage('密码错误，请重试'), { status: 401 });
  }

  if (path === '/logout') {
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Set-Cookie': clearCookie() },
    });
  }

  // 4) Authenticated JSON APIs
  if (path.startsWith('/api/')) {
    if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, { status: 401 });

    if (path === '/api/nodes') {
      const uuid = url.searchParams.get('uuid') || userID;
      if (!isValidUUID(uuid)) return json({ error: 'invalid uuid' }, { status: 400 });
      const count = Math.min(Number(url.searchParams.get('count')) || 10, 50);
      return json(
        buildNodes({ uuid, host, password: env.TUIC_PASSWORD || uuid, preferred: env.PREFERRED_IPS, count }),
      );
    }

    if (path === '/api/templates') {
      const uuid = url.searchParams.get('uuid') || userID;
      return json(nodeTemplates({ uuid, host, password: env.TUIC_PASSWORD || uuid }));
    }

    if (path === '/api/test') {
      const target = url.searchParams.get('target') || '';
      return json(await tcpLatencyTest(target));
    }

    if (path === '/api/password' && request.method === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      if (!password) return json({ error: '密码不能为空' }, { status: 400 });
      const backend = await savePassword(env, password);
      if (!backend) {
        return json({ error: '当前未绑定 D1/KV，无法在线修改；请改用 PASSWORD 环境变量' }, { status: 400 });
      }
      return json({ ok: true, backend });
    }

    return json({ error: 'not found' }, { status: 404 });
  }

  // 5) Root: panel if authed, else login
  if (path === '/') {
    if (await isAuthed(request, env)) {
      return html(panelPage({ uuid: userID, host, passwordBackend: passwordBackendLabel(env) }));
    }
    return html(loginPage());
  }

  return new Response('Not Found', { status: 404 });
}

function panelRedirect() {
  return '<!doctype html><meta http-equiv="refresh" content="0;url=/">跳转中…';
}

/**
 * Server-side TCP connectivity + latency test using cloudflare:sockets.
 * @param {string} target "host:port"
 */
async function tcpLatencyTest(target) {
  const [host, portStr] = target.split(':');
  const port = Number(portStr) || 443;
  if (!host) return { ok: false, error: 'invalid target' };
  try {
    const { connect } = await import('cloudflare:sockets');
    const start = Date.now();
    const socket = connect({ hostname: host, port });
    await socket.opened;
    const latency = Date.now() - start;
    await socket.close();
    return { ok: true, latency, host, port };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), host, port };
  }
}

export default {
  async fetch(request, env) {
    try {
      return await handleFetch(request, env);
    } catch (err) {
      return new Response('Error: ' + (err && err.stack ? err.stack : err), { status: 500 });
    }
  },
};
