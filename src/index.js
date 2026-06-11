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
import { generateWarpNode, WARP_ENDPOINTS } from './warp.js';
import { camouflage } from './camouflage.js';

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
  const wsPath = env.WS_PATH || '';
  // Admin panel base path. Default '' = served at root. Set ADMIN_PATH=/secret
  // to hide the panel behind an unguessable path (anti-detection).
  const adminBase = (env.ADMIN_PATH || '').replace(/\/+$/, '');

  const url = new URL(request.url);
  const host = env.DOMAIN || url.hostname;
  const path = url.pathname;

  // 1) VLESS over WebSocket — the actual proxy traffic.
  if (request.headers.get('Upgrade') === 'websocket') {
    if (wsPath && !path.startsWith(wsPath.split('?')[0])) {
      return camouflage(request, env, url);
    }
    return vlessOverWSHandler(request, userID, proxyIP);
  }

  // 2) Public subscription: /sub/{uuid}?type=vless|tuic|all&count=10
  if (path.startsWith('/sub/')) {
    const subUuid = path.slice('/sub/'.length).split('/')[0];
    if (!isValidUUID(subUuid)) return new Response('invalid uuid', { status: 400 });
    const type = url.searchParams.get('type') || 'vless';
    const count = Math.min(Number(url.searchParams.get('count')) || 10, 50);
    const body = buildSubscription(
      {
        uuid: subUuid,
        host,
        password: env.TUIC_PASSWORD || subUuid,
        preferred: env.PREFERRED_IPS,
        wsPath,
        count,
      },
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

  // 3) Admin area (login page, panel, APIs). When ADMIN_PATH is set, everything
  //    is served under that prefix and any other request is camouflaged.
  if (adminBase && path.startsWith(adminBase)) {
    return handleAdmin(request, env, url, path.slice(adminBase.length) || '/', adminBase, {
      userID,
      host,
      wsPath,
    });
  }
  if (!adminBase) {
    const adminResp = await handleAdmin(request, env, url, path, '', { userID, host, wsPath });
    if (adminResp) return adminResp;
  }

  // 4) Everything else: camouflage (reverse-proxy a real site or benign page).
  return camouflage(request, env, url);
}

/**
 * Handle admin routes. `route` is the path relative to the admin base.
 * Returns null (only when adminBase is empty) if the route is not an admin route,
 * so the caller can fall back to camouflage.
 */
async function handleAdmin(request, env, url, route, base, ctx) {
  const { userID, host, wsPath } = ctx;

  if (route === '/login' && request.method === 'POST') {
    const form = await request.formData();
    const password = String(form.get('password') || '');
    const real = await resolvePassword(env);
    if (password && password === real) {
      const token = await createToken(env, real);
      return html(redirectTo(base + '/'), {
        status: 302,
        headers: { Location: base + '/', 'Set-Cookie': sessionCookie(token) },
      });
    }
    return html(loginPage('密码错误，请重试', base), { status: 401 });
  }

  if (route === '/logout') {
    return new Response(null, {
      status: 302,
      headers: { Location: base + '/', 'Set-Cookie': clearCookie() },
    });
  }

  if (route.startsWith('/api/')) {
    if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, { status: 401 });

    if (route === '/api/nodes') {
      const uuid = url.searchParams.get('uuid') || userID;
      if (!isValidUUID(uuid)) return json({ error: 'invalid uuid' }, { status: 400 });
      const count = Math.min(Number(url.searchParams.get('count')) || 10, 50);
      return json(
        buildNodes({
          uuid,
          host,
          password: env.TUIC_PASSWORD || uuid,
          preferred: env.PREFERRED_IPS,
          wsPath,
          count,
        }),
      );
    }

    if (route === '/api/templates') {
      const uuid = url.searchParams.get('uuid') || userID;
      return json(nodeTemplates({ uuid, host, password: env.TUIC_PASSWORD || uuid }));
    }

    if (route === '/api/test') {
      const target = url.searchParams.get('target') || '';
      return json(await tcpLatencyTest(target));
    }

    if (route === '/api/warp') {
      try {
        const endpoint = url.searchParams.get('endpoint') || WARP_ENDPOINTS[0];
        const node = await generateWarpNode({ endpoint });
        return json({ ok: true, ...node });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, { status: 502 });
      }
    }

    if (route === '/api/password' && request.method === 'POST') {
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

  if (route === '/' || route === '') {
    if (await isAuthed(request, env)) {
      return html(panelPage({ uuid: userID, host, passwordBackend: passwordBackendLabel(env), base }));
    }
    return html(loginPage('', base));
  }

  // Unknown admin route. With a hidden base, camouflage it; at root, let caller fall back.
  return base ? camouflage(request, env, url) : null;
}

function redirectTo(loc) {
  return `<!doctype html><meta http-equiv="refresh" content="0;url=${loc}">跳转中…`;
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
