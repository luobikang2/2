// WireGuard nodes via Cloudflare WARP.
// WARP is Cloudflare's WireGuard-based UDP service, so this is the way to use
// "CF's UDP" for a real, working WireGuard node. We generate an X25519 keypair,
// register a WARP account through Cloudflare's API, and emit a .conf, a sing-box
// outbound and a wireguard:// share link.

// Official Cloudflare WARP peer public key (constant).
export const WARP_PEER_PUBKEY = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=';

// Preferred WARP UDP endpoints (host:port). The first is the API default.
export const WARP_ENDPOINTS = [
  'engage.cloudflareclient.com:2408',
  '162.159.192.1:2408',
  '162.159.193.10:2408',
  '188.114.96.1:2408',
  '188.114.97.1:2408',
];

function toB64(bytes) {
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

function fromB64(b64) {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Generate an X25519 keypair. Returns WireGuard-format base64 strings.
 * The 32-byte raw private scalar is the trailing 32 bytes of the PKCS8 export.
 */
async function generateKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const rawPriv = pkcs8.slice(pkcs8.length - 32);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { privateKey: toB64(rawPriv), publicKey: toB64(rawPub) };
}

/**
 * Register a Cloudflare WARP account for the given public key.
 */
async function registerWarp(publicKeyB64) {
  const res = await fetch('https://api.cloudflareclient.com/v0a2158/reg', {
    method: 'POST',
    headers: {
      'CF-Client-Version': 'a-6.11-2223',
      'User-Agent': 'okhttp/3.12.1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      key: publicKeyB64,
      install_id: '',
      fcm_token: '',
      tos: new Date().toISOString(),
      model: 'PC',
      serial_number: '',
      locale: 'en_US',
    }),
  });
  if (!res.ok) {
    throw new Error(`WARP 注册失败: HTTP ${res.status}`);
  }
  return res.json();
}

/** reserved[] for sing-box etc. is the 3 bytes of base64-decoded client_id. */
function reservedFromClientId(clientId) {
  try {
    const bytes = fromB64(clientId);
    return [bytes[0], bytes[1], bytes[2]];
  } catch {
    return [0, 0, 0];
  }
}

function wgConf({ privateKey, v4, v6, peerPub, endpoint }) {
  return `[Interface]
PrivateKey = ${privateKey}
Address = ${v4}/32, ${v6}/128
DNS = 1.1.1.1, 2606:4700:4700::1111
MTU = 1280

[Peer]
PublicKey = ${peerPub}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${endpoint}
`;
}

function singboxOutbound({ privateKey, v4, v6, peerPub, endpoint, reserved, name }) {
  const [host, port] = endpoint.split(':');
  return JSON.stringify(
    {
      type: 'wireguard',
      tag: name,
      server: host,
      server_port: Number(port),
      local_address: [`${v4}/32`, `${v6}/128`],
      private_key: privateKey,
      peer_public_key: peerPub,
      reserved,
      mtu: 1280,
    },
    null,
    2,
  );
}

function wgLink({ privateKey, v4, v6, peerPub, endpoint, reserved, name }) {
  const [host, port] = endpoint.split(':');
  const params = new URLSearchParams({
    address: `${v4}/32,${v6}/128`,
    publickey: peerPub,
    reserved: reserved.join(','),
    mtu: '1280',
  });
  return `wireguard://${encodeURIComponent(privateKey)}@${host}:${port}/?${params.toString()}#${encodeURIComponent(name)}`;
}

/**
 * Generate a full WireGuard (WARP) node bundle.
 * @param {{endpoint?:string, name?:string}} opts
 */
export async function generateWarpNode(opts = {}) {
  const endpoint =
    opts.endpoint && WARP_ENDPOINTS.includes(opts.endpoint) ? opts.endpoint : WARP_ENDPOINTS[0];
  const name = opts.name || '白极狐-WireGuard-WARP';

  const { privateKey, publicKey } = await generateKeyPair();
  const reg = await registerWarp(publicKey);
  const iface = reg.config && reg.config.interface;
  const v4 = iface && iface.addresses && iface.addresses.v4;
  const v6 = iface && iface.addresses && iface.addresses.v6;
  const clientId = reg.config && reg.config.client_id;
  const peerPub =
    (reg.config && reg.config.peers && reg.config.peers[0] && reg.config.peers[0].public_key) ||
    WARP_PEER_PUBKEY;
  if (!v4 || !v6) throw new Error('WARP 注册返回数据异常');
  const reserved = reservedFromClientId(clientId);

  const fields = { privateKey, publicKey, v4, v6, peerPub, endpoint, reserved, name };
  return {
    ...fields,
    conf: wgConf(fields),
    singbox: singboxOutbound(fields),
    link: wgLink(fields),
    endpoints: WARP_ENDPOINTS,
  };
}
