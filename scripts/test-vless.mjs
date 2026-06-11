// Ad-hoc end-to-end check: speak VLESS over WS to the local worker and fetch
// http://example.com through it. Not part of the build; used for verification.
const UUID = process.argv[2] || '86c50e3a-5b87-49dd-bd20-03c7f2735e40';
const WORKER = process.argv[3] || 'ws://127.0.0.1:8787/';
const TARGET_HOST = 'example.com';
const TARGET_PORT = 80;

function uuidToBytes(uuid) {
  return Uint8Array.from(uuid.replace(/-/g, '').match(/.{2}/g).map((h) => parseInt(h, 16)));
}

function buildHeader() {
  const host = new TextEncoder().encode(TARGET_HOST);
  const buf = [];
  buf.push(0); // version
  buf.push(...uuidToBytes(UUID)); // 16 bytes
  buf.push(0); // optLength
  buf.push(1); // command TCP
  buf.push((TARGET_PORT >> 8) & 0xff, TARGET_PORT & 0xff); // port
  buf.push(2); // addr type domain
  buf.push(host.length);
  buf.push(...host);
  return Uint8Array.from(buf);
}

const ws = new WebSocket(WORKER);
ws.binaryType = 'arraybuffer';
let got = new Uint8Array(0);

ws.onopen = () => {
  const header = buildHeader();
  const req = new TextEncoder().encode(
    `GET / HTTP/1.1\r\nHost: ${TARGET_HOST}\r\nConnection: close\r\n\r\n`,
  );
  const payload = new Uint8Array(header.length + req.length);
  payload.set(header, 0);
  payload.set(req, header.length);
  ws.send(payload);
};

ws.onmessage = (ev) => {
  const chunk = new Uint8Array(ev.data);
  const merged = new Uint8Array(got.length + chunk.length);
  merged.set(got, 0);
  merged.set(chunk, got.length);
  got = merged;
};

ws.onclose = () => finish();
ws.onerror = (e) => {
  console.error('WS error', e.message || e);
  process.exit(2);
};

function finish() {
  // strip 2-byte VLESS response header
  const body = new TextDecoder().decode(got.slice(2));
  if (/HTTP\/1\.1 \d{3}/.test(body)) {
    console.log('VLESS proxy OK. Upstream response head:\n' + body.split('\r\n').slice(0, 6).join('\n'));
    process.exit(0);
  }
  console.error('No valid HTTP response via VLESS. Got bytes:', got.length);
  console.error(body.slice(0, 200));
  process.exit(1);
}

setTimeout(() => finish(), 8000);
