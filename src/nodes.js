// Node + subscription generation. Given a UUID and a bound domain, this builds
// VLESS (primary) and TUIC (auxiliary) nodes, subscription links and templates.

// Cloudflare-friendly "preferred" addresses. The SNI / Host header always points
// at your own Worker/Pages domain, while the connection address can be any
// Cloudflare anycast endpoint. Users can override via the PREFERRED_IPS env var.
export const DEFAULT_PREFERRED = [
  { addr: 'icook.hk', note: 'CF优选' },
  { addr: 'time.is', note: 'CF优选' },
  { addr: 'cf.090227.xyz', note: '优选域名' },
  { addr: 'visa.com.sg', note: '优选域名' },
  { addr: 'cdn.anycast.eu.org', note: '优选域名' },
  { addr: 'www.visa.com.tw', note: '优选域名' },
  { addr: 'japan.com', note: '优选域名' },
  { addr: 'www.wto.org', note: '优选域名' },
  { addr: 'fbi.gov', note: '优选域名' },
  { addr: 'www.csgo.com', note: '优选域名' },
];

// TLS-capable ports proxied by Cloudflare.
export const TLS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];
// Plain HTTP ports proxied by Cloudflare (only usable when host is not TLS-only).
export const HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];

const DEFAULT_WS_PATH = '/?ed=2560';

function normalizeWsPath(p) {
  if (!p) return DEFAULT_WS_PATH;
  let path = p.startsWith('/') ? p : `/${p}`;
  if (!path.includes('?')) path += '?ed=2560';
  return path;
}

function parsePreferred(envValue) {
  if (!envValue) return DEFAULT_PREFERRED;
  const items = String(envValue)
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [addr, note] = s.split('#');
      return { addr: addr.trim(), note: (note || '自定义').trim() };
    });
  return items.length ? items : DEFAULT_PREFERRED;
}

/**
 * Build a single VLESS-over-WS-TLS share link.
 */
export function vlessLink({ uuid, address, port, host, name, wsPath }) {
  const params = new URLSearchParams({
    encryption: 'none',
    security: 'tls',
    sni: host,
    fp: 'randomized',
    alpn: 'h2,http/1.1',
    type: 'ws',
    host,
    path: wsPath || DEFAULT_WS_PATH,
  });
  return `vless://${uuid}@${address}:${port}?${params.toString()}#${encodeURIComponent(name)}`;
}

/**
 * Build a single TUIC share link. TUIC is auxiliary: it needs a QUIC-capable
 * backend (see README) – the link itself is valid for clients like sing-box.
 */
export function tuicLink({ uuid, password, address, port, host, name }) {
  const params = new URLSearchParams({
    congestion_control: 'bbr',
    alpn: 'h3',
    sni: host,
    udp_relay_mode: 'native',
    allow_insecure: '1',
  });
  return `tuic://${uuid}:${password}@${address}:${port}?${params.toString()}#${encodeURIComponent(name)}`;
}

/**
 * Generate up to `count` nodes for the given config.
 * @param {{uuid:string, host:string, password?:string, preferred?:string, count?:number}} cfg
 */
export function buildNodes(cfg) {
  const uuid = cfg.uuid;
  const host = cfg.host;
  const password = cfg.password || uuid;
  const count = cfg.count || 10;
  const preferred = parsePreferred(cfg.preferred);
  const wsPath = normalizeWsPath(cfg.wsPath);

  const vless = [];
  for (let i = 0; i < count; i++) {
    const p = preferred[i % preferred.length];
    const port = TLS_PORTS[i % TLS_PORTS.length];
    const name = `白极狐-VLESS-${String(i + 1).padStart(2, '0')}-${p.note}`;
    vless.push({
      type: 'vless',
      name,
      address: p.addr,
      port,
      link: vlessLink({ uuid, address: p.addr, port, host, name, wsPath }),
    });
  }

  const tuic = [];
  for (let i = 0; i < count; i++) {
    const p = preferred[i % preferred.length];
    const port = TLS_PORTS[i % TLS_PORTS.length];
    const name = `白极狐-TUIC-${String(i + 1).padStart(2, '0')}-${p.note}`;
    tuic.push({
      type: 'tuic',
      name,
      address: p.addr,
      port,
      link: tuicLink({ uuid, password, address: p.addr, port, host, name }),
    });
  }

  return { vless, tuic };
}

function b64encode(str) {
  // UTF-8 safe base64 for subscription bodies.
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

/**
 * Produce a base64 subscription body containing `count` nodes.
 * @param {'vless'|'tuic'|'all'} kind
 */
export function buildSubscription(cfg, kind = 'vless') {
  const { vless, tuic } = buildNodes(cfg);
  let list = [];
  if (kind === 'vless') list = vless;
  else if (kind === 'tuic') list = tuic;
  else list = [...vless, ...tuic];
  const text = list.map((n) => n.link).join('\n');
  return b64encode(text);
}

// Reusable node templates the panel exposes for "custom nodes".
export function nodeTemplates({ uuid, host, password }) {
  const pw = password || uuid;
  return [
    {
      id: 'vless-ws-tls',
      title: 'VLESS + WS + TLS（推荐）',
      desc: 'Cloudflare 上真正可用的主力节点。address 可替换为优选 IP/域名，sni/host 必须为你的部署域名。',
      example: vlessLink({ uuid, address: host, port: 443, host, name: '白极狐-自定义VLESS' }),
    },
    {
      id: 'vless-ws-tls-cdn',
      title: 'VLESS + WS + TLS（优选IP）',
      desc: '把 address 换成优选 IP（如 104.16.0.0 段）以提升国内连通性与速度。',
      example: vlessLink({ uuid, address: '104.16.0.0', port: 443, host, name: '白极狐-优选IP' }),
    },
    {
      id: 'tuic-v5',
      title: 'TUIC v5（辅助）',
      desc: '需要支持 QUIC 的后端（CF Workers 不支持 QUIC 入站）。客户端推荐 sing-box / v2rayN(Xray-core 不支持，需 sing-box 内核)。',
      example: tuicLink({ uuid, password: pw, address: host, port: 443, host, name: '白极狐-自定义TUIC' }),
    },
  ];
}
