// src/vless.js
import { connect } from "cloudflare:sockets";
function isValidUUID(uuid) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof uuid === "string" && re.test(uuid);
}
async function vlessOverWSHandler(request, userID, proxyIP) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  webSocket.accept();
  let address = "";
  const log = (info, event) => {
    console.log(`[${address}] ${info}`, event || "");
  };
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);
  const remoteSocketWrapper = { value: null };
  let udpStreamWrite = null;
  let isDns = false;
  readableWebSocketStream.pipeTo(
    new WritableStream({
      async write(chunk) {
        if (isDns && udpStreamWrite) {
          return udpStreamWrite(chunk);
        }
        if (remoteSocketWrapper.value) {
          const writer = remoteSocketWrapper.value.writable.getWriter();
          await writer.write(chunk);
          writer.releaseLock();
          return;
        }
        const {
          hasError,
          message,
          portRemote = 443,
          addressRemote = "",
          rawDataIndex,
          vlessVersion = new Uint8Array([0, 0]),
          isUDP
        } = processVlessHeader(chunk, userID);
        address = addressRemote;
        if (hasError) {
          throw new Error(message);
        }
        if (isUDP) {
          if (portRemote === 53) {
            isDns = true;
          } else {
            throw new Error("UDP proxy is only enabled for DNS (port 53)");
          }
        }
        const vlessResponseHeader = new Uint8Array([vlessVersion[0], 0]);
        const rawClientData = chunk.slice(rawDataIndex);
        if (isDns) {
          const { write } = await handleUDPOutBound(webSocket, vlessResponseHeader, log);
          udpStreamWrite = write;
          udpStreamWrite(rawClientData);
          return;
        }
        handleTCPOutBound(
          remoteSocketWrapper,
          addressRemote,
          portRemote,
          rawClientData,
          webSocket,
          vlessResponseHeader,
          log,
          proxyIP
        );
      },
      close() {
        log("readableWebSocketStream is closed");
      },
      abort(reason) {
        log("readableWebSocketStream aborted", JSON.stringify(reason));
      }
    })
  ).catch((err) => {
    log("readableWebSocketStream pipeTo error", err);
  });
  return new Response(null, { status: 101, webSocket: client });
}
async function handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, webSocket, vlessResponseHeader, log, proxyIP) {
  async function connectAndWrite(address, port) {
    const tcpSocket2 = connect({ hostname: address, port });
    remoteSocket.value = tcpSocket2;
    log(`connected to ${address}:${port}`);
    const writer = tcpSocket2.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();
    return tcpSocket2;
  }
  async function retry() {
    const tcpSocket2 = await connectAndWrite(proxyIP || addressRemote, portRemote);
    tcpSocket2.closed.catch((error) => log("retry tcpSocket closed error", error)).finally(() => safeCloseWebSocket(webSocket));
    remoteSocketToWS(tcpSocket2, webSocket, vlessResponseHeader, null, log);
  }
  const tcpSocket = await connectAndWrite(addressRemote, portRemote);
  remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, retry, log);
}
function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) return;
        controller.enqueue(event.data);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) return;
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer error");
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },
    cancel(reason) {
      if (readableStreamCancel) return;
      log(`readableStream was canceled, reason ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    }
  });
  return stream;
}
function processVlessHeader(vlessBuffer, userID) {
  if (vlessBuffer.byteLength < 24) {
    return { hasError: true, message: "invalid data" };
  }
  const version = new Uint8Array(vlessBuffer.slice(0, 1));
  let isValidUser = false;
  let isUDP = false;
  const slicedUUID = stringify(new Uint8Array(vlessBuffer.slice(1, 17)));
  isValidUser = slicedUUID === userID;
  if (!isValidUser) {
    return { hasError: true, message: "invalid user" };
  }
  const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
  const command = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (command === 1) {
    isUDP = false;
  } else if (command === 2) {
    isUDP = true;
  } else {
    return { hasError: true, message: `command ${command} is not supported, only 01-tcp,02-udp` };
  }
  const portIndex = 18 + optLength + 1;
  const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1));
  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";
  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(
        vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
      ).join(".");
      break;
    case 2:
      addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(
        vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
      );
      break;
    case 3: {
      addressLength = 16;
      const dataView = new DataView(
        vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
      );
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    }
    default:
      return { hasError: true, message: `invalid addressType: ${addressType}` };
  }
  if (!addressValue) {
    return { hasError: true, message: `addressValue is empty, addressType is ${addressType}` };
  }
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType,
    portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    vlessVersion: version,
    isUDP
  };
}
async function remoteSocketToWS(remoteSocket, webSocket, vlessResponseHeader, retry, log) {
  let hasIncomingData = false;
  let header = vlessResponseHeader;
  await remoteSocket.readable.pipeTo(
    new WritableStream({
      async write(chunk) {
        hasIncomingData = true;
        if (webSocket.readyState !== WS_READY_STATE_OPEN) {
          throw new Error("webSocket is not open");
        }
        if (header) {
          webSocket.send(await new Blob([header, chunk]).arrayBuffer());
          header = null;
        } else {
          webSocket.send(chunk);
        }
      },
      close() {
        log(`remoteConnection readable closed, hasIncomingData=${hasIncomingData}`);
      },
      abort(reason) {
        console.error("remoteConnection readable abort", reason);
      }
    })
  ).catch((error) => {
    console.error("remoteSocketToWS error", error.stack || error);
    safeCloseWebSocket(webSocket);
  });
  if (hasIncomingData === false && retry) {
    log("retry");
    retry();
  }
}
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) return { earlyData: void 0, error: null };
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arrayBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arrayBuffer.buffer, error: null };
  } catch (error) {
    return { earlyData: void 0, error };
  }
}
var WS_READY_STATE_OPEN = 1;
var WS_READY_STATE_CLOSING = 2;
function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}
function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset);
  if (!isValidUUID(uuid)) {
    throw TypeError("Stringified UUID is invalid");
  }
  return uuid;
}
async function handleUDPOutBound(webSocket, vlessResponseHeader, log) {
  let isVlessHeaderSent = false;
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      for (let index = 0; index < chunk.byteLength; ) {
        const lengthBuffer = chunk.slice(index, index + 2);
        const udpPacketLength = new DataView(lengthBuffer).getUint16(0);
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPacketLength));
        index = index + 2 + udpPacketLength;
        controller.enqueue(udpData);
      }
    }
  });
  transformStream.readable.pipeTo(
    new WritableStream({
      async write(chunk) {
        const resp = await fetch("https://1.1.1.1/dns-query", {
          method: "POST",
          headers: { "content-type": "application/dns-message" },
          body: chunk
        });
        const dnsQueryResult = await resp.arrayBuffer();
        const udpSize = dnsQueryResult.byteLength;
        const udpSizeBuffer = new Uint8Array([udpSize >> 8 & 255, udpSize & 255]);
        if (webSocket.readyState === WS_READY_STATE_OPEN) {
          log(`DoH success, length ${udpSize}`);
          if (isVlessHeaderSent) {
            webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
          } else {
            webSocket.send(
              await new Blob([vlessResponseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer()
            );
            isVlessHeaderSent = true;
          }
        }
      }
    })
  ).catch((error) => log("dns udp error", error));
  const writer = transformStream.writable.getWriter();
  return {
    write(chunk) {
      writer.write(chunk);
    }
  };
}

// src/nodes.js
var DEFAULT_PREFERRED = [
  { addr: "icook.hk", note: "CF\u4F18\u9009" },
  { addr: "time.is", note: "CF\u4F18\u9009" },
  { addr: "cf.090227.xyz", note: "\u4F18\u9009\u57DF\u540D" },
  { addr: "visa.com.sg", note: "\u4F18\u9009\u57DF\u540D" },
  { addr: "cdn.anycast.eu.org", note: "\u4F18\u9009\u57DF\u540D" },
  { addr: "www.visa.com.tw", note: "\u4F18\u9009\u57DF\u540D" },
  { addr: "japan.com", note: "\u4F18\u9009\u57DF\u540D" },
  { addr: "www.wto.org", note: "\u4F18\u9009\u57DF\u540D" },
  { addr: "fbi.gov", note: "\u4F18\u9009\u57DF\u540D" },
  { addr: "www.csgo.com", note: "\u4F18\u9009\u57DF\u540D" }
];
var TLS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];
var WS_PATH = "/?ed=2560";
function parsePreferred(envValue) {
  if (!envValue) return DEFAULT_PREFERRED;
  const items = String(envValue).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const [addr, note] = s.split("#");
    return { addr: addr.trim(), note: (note || "\u81EA\u5B9A\u4E49").trim() };
  });
  return items.length ? items : DEFAULT_PREFERRED;
}
function vlessLink({ uuid, address, port, host, name }) {
  const params = new URLSearchParams({
    encryption: "none",
    security: "tls",
    sni: host,
    fp: "randomized",
    alpn: "h2,http/1.1",
    type: "ws",
    host,
    path: WS_PATH
  });
  return `vless://${uuid}@${address}:${port}?${params.toString()}#${encodeURIComponent(name)}`;
}
function tuicLink({ uuid, password, address, port, host, name }) {
  const params = new URLSearchParams({
    congestion_control: "bbr",
    alpn: "h3",
    sni: host,
    udp_relay_mode: "native",
    allow_insecure: "1"
  });
  return `tuic://${uuid}:${password}@${address}:${port}?${params.toString()}#${encodeURIComponent(name)}`;
}
function buildNodes(cfg) {
  const uuid = cfg.uuid;
  const host = cfg.host;
  const password = cfg.password || uuid;
  const count = cfg.count || 10;
  const preferred = parsePreferred(cfg.preferred);
  const vless = [];
  for (let i = 0; i < count; i++) {
    const p = preferred[i % preferred.length];
    const port = TLS_PORTS[i % TLS_PORTS.length];
    const name = `\u767D\u6781\u72D0-VLESS-${String(i + 1).padStart(2, "0")}-${p.note}`;
    vless.push({
      type: "vless",
      name,
      address: p.addr,
      port,
      link: vlessLink({ uuid, address: p.addr, port, host, name })
    });
  }
  const tuic = [];
  for (let i = 0; i < count; i++) {
    const p = preferred[i % preferred.length];
    const port = TLS_PORTS[i % TLS_PORTS.length];
    const name = `\u767D\u6781\u72D0-TUIC-${String(i + 1).padStart(2, "0")}-${p.note}`;
    tuic.push({
      type: "tuic",
      name,
      address: p.addr,
      port,
      link: tuicLink({ uuid, password, address: p.addr, port, host, name })
    });
  }
  return { vless, tuic };
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}
function buildSubscription(cfg, kind = "vless") {
  const { vless, tuic } = buildNodes(cfg);
  let list = [];
  if (kind === "vless") list = vless;
  else if (kind === "tuic") list = tuic;
  else list = [...vless, ...tuic];
  const text = list.map((n) => n.link).join("\n");
  return b64encode(text);
}
function nodeTemplates({ uuid, host, password }) {
  const pw = password || uuid;
  return [
    {
      id: "vless-ws-tls",
      title: "VLESS + WS + TLS\uFF08\u63A8\u8350\uFF09",
      desc: "Cloudflare \u4E0A\u771F\u6B63\u53EF\u7528\u7684\u4E3B\u529B\u8282\u70B9\u3002address \u53EF\u66FF\u6362\u4E3A\u4F18\u9009 IP/\u57DF\u540D\uFF0Csni/host \u5FC5\u987B\u4E3A\u4F60\u7684\u90E8\u7F72\u57DF\u540D\u3002",
      example: vlessLink({ uuid, address: host, port: 443, host, name: "\u767D\u6781\u72D0-\u81EA\u5B9A\u4E49VLESS" })
    },
    {
      id: "vless-ws-tls-cdn",
      title: "VLESS + WS + TLS\uFF08\u4F18\u9009IP\uFF09",
      desc: "\u628A address \u6362\u6210\u4F18\u9009 IP\uFF08\u5982 104.16.0.0 \u6BB5\uFF09\u4EE5\u63D0\u5347\u56FD\u5185\u8FDE\u901A\u6027\u4E0E\u901F\u5EA6\u3002",
      example: vlessLink({ uuid, address: "104.16.0.0", port: 443, host, name: "\u767D\u6781\u72D0-\u4F18\u9009IP" })
    },
    {
      id: "tuic-v5",
      title: "TUIC v5\uFF08\u8F85\u52A9\uFF09",
      desc: "\u9700\u8981\u652F\u6301 QUIC \u7684\u540E\u7AEF\uFF08CF Workers \u4E0D\u652F\u6301 QUIC \u5165\u7AD9\uFF09\u3002\u5BA2\u6237\u7AEF\u63A8\u8350 sing-box / v2rayN(Xray-core \u4E0D\u652F\u6301\uFF0C\u9700 sing-box \u5185\u6838)\u3002",
      example: tuicLink({ uuid, password: pw, address: host, port: 443, host, name: "\u767D\u6781\u72D0-\u81EA\u5B9A\u4E49TUIC" })
    }
  ];
}

// src/auth.js
var COOKIE_NAME = "bjh_session";
var DEFAULT_PASSWORD = "admin";
async function resolvePassword(env) {
  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind("password").first();
      if (row && row.value) return String(row.value);
    } catch {
    }
  }
  if (env.KV && typeof env.KV.get === "function") {
    try {
      const v = await env.KV.get("password");
      if (v) return v;
    } catch {
    }
  }
  return env.PASSWORD || DEFAULT_PASSWORD;
}
async function savePassword(env, password) {
  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)"
      ).run();
      await env.DB.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind("password", password).run();
      return "D1";
    } catch {
    }
  }
  if (env.KV && typeof env.KV.put === "function") {
    try {
      await env.KV.put("password", password);
      return "KV";
    } catch {
    }
  }
  return null;
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function tokenSecret(env, password) {
  return `${env.UUID || ""}:${password}:bjh`;
}
async function createToken(env, password, ttl = 7 * 24 * 3600 * 1e3) {
  const exp = Date.now() + ttl;
  const payload = `${exp}`;
  const sig = await hmac(tokenSecret(env, password), payload);
  return `${payload}.${sig}`;
}
async function verifyToken(env, token) {
  if (!token || !token.includes(".")) return false;
  const password = await resolvePassword(env);
  const [payload, sig] = token.split(".");
  const exp = Number(payload);
  if (!exp || exp < Date.now()) return false;
  const expected = await hmac(tokenSecret(env, password), payload);
  return timingSafeEqual(sig, expected);
}
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
function getCookie(request, name = COOKIE_NAME) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
function sessionCookie(token, maxAgeSec = 7 * 24 * 3600) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}
function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
async function isAuthed(request, env) {
  const token = getCookie(request);
  return verifyToken(env, token);
}

// src/html.js
var STYLE = `
:root{--bg:#0a0f1f;--bg2:#0e1733;--card:rgba(255,255,255,.06);--line:rgba(255,255,255,.12);
--txt:#eaf2ff;--muted:#9fb3d1;--accent:#5ad1ff;--accent2:#8a7bff;--ok:#36d399;--warn:#fbbd23;--err:#f87272;}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
color:var(--txt);background:radial-gradient(1200px 600px at 20% -10%,#13235a 0,transparent 60%),
radial-gradient(1000px 500px at 90% 0,#1b2e6e 0,transparent 55%),linear-gradient(180deg,var(--bg),var(--bg2));min-height:100vh}
a{color:var(--accent)}
.aurora{position:fixed;inset:0;pointer-events:none;background:
linear-gradient(120deg,transparent 30%,rgba(90,209,255,.08) 50%,transparent 70%),
linear-gradient(60deg,transparent 40%,rgba(138,123,255,.08) 55%,transparent 75%);filter:blur(20px)}
.wrap{position:relative;max-width:1080px;margin:0 auto;padding:24px}
.brand{display:flex;align-items:center;gap:14px}
.logo{width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,var(--accent),var(--accent2));
display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 8px 30px rgba(90,209,255,.35)}
h1{font-size:30px;margin:0;letter-spacing:2px}
.sub{color:var(--muted);margin-top:4px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;backdrop-filter:blur(8px);margin-top:18px}
.row{display:flex;gap:12px;flex-wrap:wrap}
label{display:block;font-size:13px;color:var(--muted);margin:10px 0 6px}
input,select,textarea{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--line);
background:rgba(0,0,0,.25);color:var(--txt);font-size:14px;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--accent)}
button,.btn{cursor:pointer;border:none;border-radius:12px;padding:12px 18px;font-size:14px;font-weight:600;
background:linear-gradient(135deg,var(--accent),var(--accent2));color:#05122b;transition:.15s}
button:hover,.btn:hover{transform:translateY(-1px);filter:brightness(1.05)}
.btn.ghost{background:transparent;border:1px solid var(--line);color:var(--txt)}
.btn.sm{padding:7px 12px;font-size:12px}
.muted{color:var(--muted)}
.center{display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-box{width:380px;max-width:92vw}
.banner{font-size:15px;color:var(--accent);letter-spacing:6px;text-align:center;margin:6px 0 2px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 0}
.tab{padding:9px 14px;border-radius:10px;border:1px solid var(--line);cursor:pointer;font-size:13px;color:var(--muted)}
.tab.active{background:rgba(90,209,255,.15);color:var(--txt);border-color:var(--accent)}
.pane{display:none;margin-top:14px}
.pane.active{display:block}
.node{border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:10px;background:rgba(0,0,0,.18)}
.node .top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.node .lk{font-family:monospace;font-size:11px;color:var(--muted);word-break:break-all;margin-top:8px;
max-height:54px;overflow:auto}
.pill{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
.pill.v{color:var(--accent);border-color:var(--accent)}
.pill.t{color:var(--accent2);border-color:var(--accent2)}
.lat{font-size:12px;min-width:64px;text-align:right}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.qr{background:#fff;padding:8px;border-radius:10px;width:max-content}
.kv{display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:13px}
.kv div:nth-child(odd){color:var(--muted)}
code{background:rgba(0,0,0,.35);padding:2px 6px;border-radius:6px;font-size:12px}
pre{background:rgba(0,0,0,.35);padding:12px;border-radius:10px;overflow:auto;font-size:12px}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#0c1a3a;border:1px solid var(--line);
padding:10px 16px;border-radius:10px;opacity:0;transition:.2s;pointer-events:none}
.toast.show{opacity:1}
.foot{color:var(--muted);text-align:center;margin:26px 0;font-size:12px}
`;
var QR_CDN = "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js";
function loginPage(error = "") {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u767D\u6781\u72D0 \xB7 \u767B\u5F55</title><style>${STYLE}</style></head>
<body><div class="aurora"></div>
<div class="center"><div class="card login-box">
  <div class="brand" style="justify-content:center">
    <div class="logo">\u{1F98A}</div>
    <div><h1>\u767D\u6781\u72D0</h1><div class="sub">Arctic Fox \xB7 Cloudflare \u4EE3\u7406\u9762\u677F</div></div>
  </div>
  <div class="banner">\u5317 \u6781 \u6B22 \u8FCE \u4F60</div>
  ${error ? `<div style="color:var(--err);text-align:center;margin-top:10px">${error}</div>` : ""}
  <form method="POST" action="/login">
    <label>\u767B\u5F55\u5BC6\u7801</label>
    <input type="password" name="password" placeholder="\u8BF7\u8F93\u5165\u64CD\u4F5C\u9762\u677F\u5BC6\u7801" required autofocus>
    <div class="row" style="margin-top:16px">
      <button type="submit" style="flex:1">\u767B\u5F55</button>
      <button type="button" class="btn ghost" onclick="genUUID()">\u751F\u6210 UUID</button>
    </div>
  </form>
  <label style="margin-top:14px">UUID\uFF08\u53D8\u91CF\uFF0C\u7528\u4E8E\u8282\u70B9\uFF09</label>
  <div class="row">
    <input id="uuid" placeholder="\u70B9\u51FB\u300C\u751F\u6210 UUID\u300D\u81EA\u52A8\u751F\u6210" readonly>
    <button type="button" class="btn ghost sm" onclick="copyUUID()">\u590D\u5236</button>
  </div>
  <div class="muted" style="font-size:12px;margin-top:8px">\u53D8\u91CF = UUID + \u7ED1\u5B9A\u57DF\u540D\u3002\u628A\u751F\u6210\u7684 UUID \u8BBE\u7F6E\u5230\u90E8\u7F72\u5E73\u53F0\u7684 <code>UUID</code> \u73AF\u5883\u53D8\u91CF\u540E\u5373\u53EF\u751F\u6210\u8282\u70B9\u3002</div>
  <div class="foot">\xA9 \u767D\u6781\u72D0 \xB7 \u5317\u6781\u6B22\u8FCE\u4F60</div>
</div></div>
<div class="toast" id="toast"></div>
<script>
function uuidv4(){return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));}
function genUUID(){document.getElementById('uuid').value=uuidv4();toast('\u5DF2\u751F\u6210 UUID');}
function copyUUID(){const v=document.getElementById('uuid').value;if(!v)return toast('\u8BF7\u5148\u751F\u6210');navigator.clipboard.writeText(v);toast('\u5DF2\u590D\u5236');}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1500);}
</script>
</body></html>`;
}
function panelPage({ uuid, host, passwordBackend }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u767D\u6781\u72D0 \xB7 \u64CD\u4F5C\u9762\u677F</title><style>${STYLE}</style>
<script src="${QR_CDN}"></script></head>
<body><div class="aurora"></div>
<div class="wrap">
  <div class="row" style="justify-content:space-between;align-items:center">
    <div class="brand"><div class="logo">\u{1F98A}</div>
      <div><h1>\u767D\u6781\u72D0</h1><div class="banner" style="text-align:left;margin:2px 0 0">\u5317 \u6781 \u6B22 \u8FCE \u4F60</div></div>
    </div>
    <a class="btn ghost sm" href="/logout">\u9000\u51FA\u767B\u5F55</a>
  </div>

  <div class="card">
    <div class="kv">
      <div>\u5F53\u524D UUID</div><div><code id="curUuid">${uuid}</code> <button class="btn ghost sm" onclick="copyText('${uuid}')">\u590D\u5236</button></div>
      <div>\u7ED1\u5B9A\u57DF\u540D</div><div><code>${host}</code></div>
      <div>\u5BC6\u7801\u5B58\u50A8</div><div>${passwordBackend}</div>
      <div>\u8BA2\u9605\u94FE\u63A5</div><div id="subLinks"></div>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" data-pane="nodes" onclick="tab(this)">\u8282\u70B9 (VLESS/TUIC)</div>
    <div class="tab" data-pane="custom" onclick="tab(this)">\u81EA\u5B9A\u4E49\u8282\u70B9\u6A21\u677F</div>
    <div class="tab" data-pane="docs" onclick="tab(this)">\u914D\u7F6E\u8BF4\u660E</div>
    <div class="tab" data-pane="settings" onclick="tab(this)">\u8BBE\u7F6E</div>
  </div>

  <div class="pane active" id="pane-nodes">
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:end">
        <div><label>UUID\uFF08\u53D8\u91CF\uFF09</label><input id="inUuid" value="${uuid}"></div>
        <div style="width:120px"><label>\u8282\u70B9\u6570\u91CF</label><input id="inCount" type="number" value="10" min="1" max="50"></div>
        <button onclick="loadNodes()">\u751F\u6210\u8282\u70B9</button>
        <button class="btn ghost" onclick="testAll()">\u6D4B\u8BD5\u5168\u90E8\u8FDE\u901A/\u5EF6\u8FDF</button>
      </div>
      <div id="nodeList"></div>
    </div>
  </div>

  <div class="pane" id="pane-custom">
    <div class="card" id="tplBox"><div class="muted">\u52A0\u8F7D\u6A21\u677F\u4E2D\u2026</div></div>
  </div>

  <div class="pane" id="pane-docs">
    <div class="card" id="docsBox"></div>
  </div>

  <div class="pane" id="pane-settings">
    <div class="card">
      <h3 style="margin-top:0">\u4FEE\u6539\u767B\u5F55\u5BC6\u7801</h3>
      <label>\u65B0\u5BC6\u7801</label><input id="newPw" type="password" placeholder="\u65B0\u7684\u9762\u677F\u767B\u5F55\u5BC6\u7801">
      <button style="margin-top:12px" onclick="changePw()">\u4FDD\u5B58\u5BC6\u7801\uFF08${passwordBackend}\uFF09</button>
      <div class="muted" style="font-size:12px;margin-top:8px">\u5BC6\u7801\u6309 D1 \u2192 KV \u2192 \u73AF\u5883\u53D8\u91CF \u7684\u4F18\u5148\u7EA7\u8BFB\u53D6\u3002\u82E5\u4F7F\u7528 D1/KV \u53EF\u5728\u6B64\u76F4\u63A5\u4FEE\u6539\u3002</div>
    </div>
  </div>

  <div class="foot">\xA9 \u767D\u6781\u72D0 \xB7 \u5317\u6781\u6B22\u8FCE\u4F60 \xB7 Cloudflare \u8282\u70B9\u670D\u52A1\u5668</div>
</div>

<div class="card" style="position:fixed;right:24px;bottom:24px;display:none" id="qrCard">
  <div class="row" style="justify-content:space-between"><b>\u8282\u70B9\u4E8C\u7EF4\u7801</b><span class="btn ghost sm" onclick="closeQr()">\u5173\u95ED</span></div>
  <div class="qr" id="qr" style="margin-top:8px"></div>
</div>
<div class="toast" id="toast"></div>

<script>
const HOST=${JSON.stringify(host)};
function tab(el){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));el.classList.add('active');
document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
document.getElementById('pane-'+el.dataset.pane).classList.add('active');}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1500);}
function copyText(v){navigator.clipboard.writeText(v);toast('\u5DF2\u590D\u5236');}
function uuidVal(){return document.getElementById('inUuid').value.trim();}

function subUrls(uuid){
  const base=location.origin+'/sub/'+uuid;
  return {vless:base+'?type=vless',tuic:base+'?type=tuic',all:base+'?type=all'};
}
function renderSub(){
  const u=subUrls(document.getElementById('curUuid').textContent);
  document.getElementById('subLinks').innerHTML=
    ['vless','tuic','all'].map(k=>'<button class="btn ghost sm" onclick="copyText(\\''+u[k]+'\\')">'+k.toUpperCase()+' \u8BA2\u9605</button>').join(' ');
}

async function loadNodes(){
  const uuid=uuidVal();const count=document.getElementById('inCount').value;
  document.getElementById('curUuid').textContent=uuid;renderSub();
  const r=await fetch('/api/nodes?uuid='+encodeURIComponent(uuid)+'&count='+count);
  const data=await r.json();
  const all=[...data.vless,...data.tuic];
  document.getElementById('nodeList').innerHTML=all.map((n,i)=>nodeHtml(n,i)).join('');
  window.__nodes=all;
}
function nodeHtml(n,i){
  const cls=n.type==='vless'?'v':'t';
  return '<div class="node"><div class="top">'+
    '<div><span class="pill '+cls+'">'+n.type.toUpperCase()+'</span> <b>'+n.name+'</b><div class="muted" style="font-size:12px">'+n.address+':'+n.port+'</div></div>'+
    '<div class="row"><span class="lat" id="lat'+i+'">\u2014</span>'+
    '<button class="btn ghost sm" onclick="testOne('+i+')">\u6D4B\u901F</button>'+
    '<button class="btn ghost sm" onclick="copyText(window.__nodes['+i+'].link)">\u590D\u5236</button>'+
    '<button class="btn ghost sm" onclick="showQr('+i+')">\u4E8C\u7EF4\u7801</button></div>'+
    '</div><div class="lk">'+n.link+'</div></div>';
}
async function testOne(i){
  const n=window.__nodes[i];const el=document.getElementById('lat'+i);el.textContent='\u6D4B\u8BD5\u4E2D\u2026';
  try{
    const r=await fetch('/api/test?target='+encodeURIComponent(n.address+':'+n.port));
    const d=await r.json();
    el.textContent=d.ok?(d.latency+' ms'):'\u5931\u8D25';
    el.style.color=d.ok?(d.latency<300?'var(--ok)':'var(--warn)'):'var(--err)';
  }catch(e){el.textContent='\u5931\u8D25';el.style.color='var(--err)';}
}
async function testAll(){if(!window.__nodes)await loadNodes();for(let i=0;i<window.__nodes.length;i++){await testOne(i);}toast('\u6D4B\u8BD5\u5B8C\u6210');}

function showQr(i){const n=window.__nodes[i];document.getElementById('qrCard').style.display='block';
  const box=document.getElementById('qr');box.innerHTML='';new QRCode(box,{text:n.link,width:200,height:200});}
function closeQr(){document.getElementById('qrCard').style.display='none';}

async function loadTemplates(){
  const r=await fetch('/api/templates?uuid='+encodeURIComponent(uuidVal()));
  const tpls=await r.json();
  document.getElementById('tplBox').innerHTML=tpls.map(t=>
    '<div class="node"><div class="top"><b>'+t.title+'</b><button class="btn ghost sm" onclick="copyText(\\''+t.example.replace(/'/g,"\\\\'")+'\\')">\u590D\u5236\u6A21\u677F</button></div>'+
    '<div class="muted" style="font-size:12px;margin-top:6px">'+t.desc+'</div>'+
    '<div class="lk">'+t.example+'</div></div>').join('');
}

const DOCS=\`<h3 style="margin-top:0">\u5404\u7C7B\u8282\u70B9\u6700\u7CBE\u7B80\u6B63\u786E\u914D\u7F6E\u8BF4\u660E</h3>
<div class="kv"><div>\u5BA2\u6237\u7AEF</div><div>\u63A8\u8350\uFF1Av2rayN / NekoBox / sing-box / Shadowrocket / Clash Meta</div></div>
<h4>\u2460 VLESS + WS + TLS\uFF08\u4E3B\u529B\uFF0CCF \u771F\u6B63\u53EF\u7528\uFF09</h4>
<pre>\u5730\u5740(address): \u4F60\u7684\u90E8\u7F72\u57DF\u540D \u6216 CF\u4F18\u9009IP/\u57DF\u540D
\u7AEF\u53E3(port): 443 / 2053 / 2083 / 2087 / 2096 (TLS)
\u7528\u6237ID(id): \u4F60\u7684 UUID
\u4F20\u8F93(network): ws
\u8DEF\u5F84(path): /?ed=2560
TLS: \u5F00\u542F   SNI/Host: \u4F60\u7684\u90E8\u7F72\u57DF\u540D(*.pages.dev / *.workers.dev / \u81EA\u5B9A\u4E49\u57DF)
\u6307\u7EB9(fp): randomized   allowInsecure: \u5173\u95ED</pre>
<div class="muted">\u56FD\u5185\u8FDE\u4E0D\u4E0A\u65F6\uFF0C\u628A address \u6362\u6210\u300C\u4F18\u9009 IP/\u57DF\u540D\u300D\uFF0CSNI \u4E0E Host \u4ECD\u4FDD\u6301\u4F60\u7684\u90E8\u7F72\u57DF\u540D\u3002</div>
<h4>\u2461 TUIC v5\uFF08\u8F85\u52A9\uFF09</h4>
<pre>\u5730\u5740: \u652F\u6301 QUIC \u7684\u540E\u7AEF\u5730\u5740   \u7AEF\u53E3: 443
UUID: \u4F60\u7684 UUID   password: \u4F60\u7684 UUID(\u6216\u81EA\u5B9A\u4E49)
alpn: h3   congestion_control: bbr   udp_relay_mode: native
\u5185\u6838: \u5FC5\u987B\u4F7F\u7528 sing-box\uFF08Xray \u4E0D\u652F\u6301 TUIC\uFF09</pre>
<div class="muted">\u26A0\uFE0F Cloudflare Workers/Pages \u4E0D\u652F\u6301 QUIC \u5165\u7AD9\uFF0CTUIC \u8282\u70B9\u9700\u914D\u5408\u81EA\u5EFA/\u7B2C\u4E09\u65B9 QUIC \u540E\u7AEF\uFF1B\u8BA2\u9605\u91CC\u63D0\u4F9B TUIC \u94FE\u63A5\u4EE5\u4FBF\u517C\u5BB9\u591A\u534F\u8BAE\u5BA2\u6237\u7AEF\u3002</div>
<h4>\u2462 \u56FD\u5185\u8BBF\u95EE Google \u7B49\u5916\u7F51</h4>
<pre>1) \u90E8\u7F72\u672C\u9879\u76EE\u5230 Cloudflare\uFF08Pages/Workers\uFF09
2) \u8BBE\u7F6E UUID \u73AF\u5883\u53D8\u91CF\uFF1B\u5982\u6709\u81EA\u5B9A\u4E49\u57DF\u540D\u89E3\u6790\u5230 CF \u66F4\u7A33
3) \u5BFC\u5165\u300CVLESS \u8BA2\u9605\u300D\u5230\u5BA2\u6237\u7AEF\uFF0C\u9009\u5EF6\u8FDF\u4F4E\u7684\u8282\u70B9
4) \u82E5\u9ED8\u8BA4 IP \u88AB\u5899\uFF0C\u4F7F\u7528\u4F18\u9009 IP/\u57DF\u540D + \u4F18\u9009\u7AEF\u53E3</pre>\`;
document.getElementById('docsBox').innerHTML=DOCS;

async function changePw(){
  const pw=document.getElementById('newPw').value;if(!pw)return toast('\u8BF7\u8F93\u5165\u65B0\u5BC6\u7801');
  const r=await fetch('/api/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw})});
  const d=await r.json();toast(d.ok?('\u5DF2\u4FDD\u5B58\u5230 '+d.backend):(d.error||'\u4FDD\u5B58\u5931\u8D25'));
}

loadNodes();loadTemplates();renderSub();
</script>
</body></html>`;
}

// src/index.js
var DEFAULT_UUID = "86c50e3a-5b87-49dd-bd20-03c7f2735e40";
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json;charset=utf-8" },
    ...init
  });
}
function html(body, init = {}) {
  return new Response(body, {
    headers: { "content-type": "text/html;charset=utf-8" },
    ...init
  });
}
function passwordBackendLabel(env) {
  if (env.DB) return "D1 \u6570\u636E\u5E93";
  if (env.KV) return "KV \u547D\u540D\u7A7A\u95F4";
  return "\u73AF\u5883\u53D8\u91CF (PASSWORD)";
}
async function handleFetch(request, env) {
  const userID = (env.UUID && isValidUUID(env.UUID) ? env.UUID : DEFAULT_UUID).toLowerCase();
  const proxyIP = env.PROXYIP || "";
  if (request.headers.get("Upgrade") === "websocket") {
    return vlessOverWSHandler(request, userID, proxyIP);
  }
  const url = new URL(request.url);
  const host = env.DOMAIN || url.hostname;
  const path = url.pathname;
  if (path.startsWith("/sub/")) {
    const subUuid = path.slice("/sub/".length).split("/")[0];
    if (!isValidUUID(subUuid)) return new Response("invalid uuid", { status: 400 });
    const type = url.searchParams.get("type") || "vless";
    const count = Math.min(Number(url.searchParams.get("count")) || 10, 50);
    const body = buildSubscription(
      { uuid: subUuid, host, password: env.TUIC_PASSWORD || subUuid, preferred: env.PREFERRED_IPS, count },
      type
    );
    return new Response(body, {
      headers: {
        "content-type": "text/plain;charset=utf-8",
        "profile-update-interval": "6",
        "subscription-userinfo": "upload=0; download=0; total=0"
      }
    });
  }
  if (path === "/login" && request.method === "POST") {
    const form = await request.formData();
    const password = String(form.get("password") || "");
    const real = await resolvePassword(env);
    if (password && password === real) {
      const token = await createToken(env, real);
      return html(panelRedirect(), {
        status: 302,
        headers: { Location: "/", "Set-Cookie": sessionCookie(token) }
      });
    }
    return html(loginPage("\u5BC6\u7801\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5"), { status: 401 });
  }
  if (path === "/logout") {
    return new Response(null, {
      status: 302,
      headers: { Location: "/", "Set-Cookie": clearCookie() }
    });
  }
  if (path.startsWith("/api/")) {
    if (!await isAuthed(request, env)) return json({ error: "unauthorized" }, { status: 401 });
    if (path === "/api/nodes") {
      const uuid = url.searchParams.get("uuid") || userID;
      if (!isValidUUID(uuid)) return json({ error: "invalid uuid" }, { status: 400 });
      const count = Math.min(Number(url.searchParams.get("count")) || 10, 50);
      return json(
        buildNodes({ uuid, host, password: env.TUIC_PASSWORD || uuid, preferred: env.PREFERRED_IPS, count })
      );
    }
    if (path === "/api/templates") {
      const uuid = url.searchParams.get("uuid") || userID;
      return json(nodeTemplates({ uuid, host, password: env.TUIC_PASSWORD || uuid }));
    }
    if (path === "/api/test") {
      const target = url.searchParams.get("target") || "";
      return json(await tcpLatencyTest(target));
    }
    if (path === "/api/password" && request.method === "POST") {
      const { password } = await request.json().catch(() => ({}));
      if (!password) return json({ error: "\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A" }, { status: 400 });
      const backend = await savePassword(env, password);
      if (!backend) {
        return json({ error: "\u5F53\u524D\u672A\u7ED1\u5B9A D1/KV\uFF0C\u65E0\u6CD5\u5728\u7EBF\u4FEE\u6539\uFF1B\u8BF7\u6539\u7528 PASSWORD \u73AF\u5883\u53D8\u91CF" }, { status: 400 });
      }
      return json({ ok: true, backend });
    }
    return json({ error: "not found" }, { status: 404 });
  }
  if (path === "/") {
    if (await isAuthed(request, env)) {
      return html(panelPage({ uuid: userID, host, passwordBackend: passwordBackendLabel(env) }));
    }
    return html(loginPage());
  }
  return new Response("Not Found", { status: 404 });
}
function panelRedirect() {
  return '<!doctype html><meta http-equiv="refresh" content="0;url=/">\u8DF3\u8F6C\u4E2D\u2026';
}
async function tcpLatencyTest(target) {
  const [host, portStr] = target.split(":");
  const port = Number(portStr) || 443;
  if (!host) return { ok: false, error: "invalid target" };
  try {
    const { connect: connect2 } = await import("cloudflare:sockets");
    const start = Date.now();
    const socket = connect2({ hostname: host, port });
    await socket.opened;
    const latency = Date.now() - start;
    await socket.close();
    return { ok: true, latency, host, port };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), host, port };
  }
}
var index_default = {
  async fetch(request, env) {
    try {
      return await handleFetch(request, env);
    } catch (err) {
      return new Response("Error: " + (err && err.stack ? err.stack : err), { status: 500 });
    }
  }
};
export {
  index_default as default
};
