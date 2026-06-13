// HTML for the login screen and the admin panel.
// Theme: arctic / aurora. Brand title 「白极狐」, banner 「北极欢迎你」.

const STYLE = `
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

const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';

export function loginPage(error = '', base = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>白极狐 · 登录</title><style>${STYLE}</style></head>
<body><div class="aurora"></div>
<div class="center"><div class="card login-box">
  <div class="brand" style="justify-content:center">
    <div class="logo">🦊</div>
    <div><h1>白极狐</h1><div class="sub">Arctic Fox · Cloudflare 代理面板</div></div>
  </div>
  <div class="banner">北 极 欢 迎 你</div>
  ${error ? `<div style="color:var(--err);text-align:center;margin-top:10px">${error}</div>` : ''}
  <form method="POST" action="${base}/login">
    <label>登录密码</label>
    <input type="password" name="password" placeholder="请输入操作面板密码" required autofocus>
    <div class="row" style="margin-top:16px">
      <button type="submit" style="flex:1">登录</button>
      <button type="button" class="btn ghost" onclick="genUUID()">生成 UUID</button>
    </div>
  </form>
  <label style="margin-top:14px">UUID（变量，用于节点）</label>
  <div class="row">
    <input id="uuid" placeholder="点击「生成 UUID」自动生成" readonly>
    <button type="button" class="btn ghost sm" onclick="copyUUID()">复制</button>
  </div>
  <div class="muted" style="font-size:12px;margin-top:8px">变量 = UUID + 绑定域名。把生成的 UUID 设置到部署平台的 <code>UUID</code> 环境变量后即可生成节点。</div>
  <div class="foot">© 白极狐 · 北极欢迎你</div>
</div></div>
<div class="toast" id="toast"></div>
<script>
function uuidv4(){return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));}
function genUUID(){document.getElementById('uuid').value=uuidv4();toast('已生成 UUID');}
function copyUUID(){const v=document.getElementById('uuid').value;if(!v)return toast('请先生成');navigator.clipboard.writeText(v);toast('已复制');}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1500);}
</script>
</body></html>`;
}

export function panelPage({ uuid, host, passwordBackend, base = '' }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>白极狐 · 操作面板</title><style>${STYLE}</style>
<script src="${QR_CDN}"></script></head>
<body><div class="aurora"></div>
<div class="wrap">
  <div class="row" style="justify-content:space-between;align-items:center">
    <div class="brand"><div class="logo">🦊</div>
      <div><h1>白极狐</h1><div class="banner" style="text-align:left;margin:2px 0 0">北 极 欢 迎 你</div></div>
    </div>
    <a class="btn ghost sm" href="${base}/logout">退出登录</a>
  </div>

  <div class="card">
    <div class="kv">
      <div>当前 UUID</div><div><code id="curUuid">${uuid}</code> <button class="btn ghost sm" onclick="copyText('${uuid}')">复制</button></div>
      <div>绑定域名</div><div><code>${host}</code></div>
      <div>密码存储</div><div>${passwordBackend}</div>
      <div>订阅链接</div><div id="subLinks"></div>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" data-pane="nodes" onclick="tab(this)">节点 (VLESS/TUIC)</div>
    <div class="tab" data-pane="wg" onclick="tab(this)">WireGuard (WARP)</div>
    <div class="tab" data-pane="custom" onclick="tab(this)">自定义节点模板</div>
    <div class="tab" data-pane="docs" onclick="tab(this)">配置说明</div>
    <div class="tab" data-pane="settings" onclick="tab(this)">设置</div>
  </div>

  <div class="pane active" id="pane-nodes">
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:end">
        <div><label>UUID（变量）</label><input id="inUuid" value="${uuid}"></div>
        <div style="width:120px"><label>节点数量</label><input id="inCount" type="number" value="10" min="1" max="50"></div>
        <button onclick="loadNodes()">生成节点</button>
        <button class="btn ghost" onclick="testAll()">测试全部连通/延迟</button>
      </div>
      <div id="nodeList"></div>
    </div>
  </div>

  <div class="pane" id="pane-wg">
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:end">
        <div style="flex:1"><label>WARP UDP 端点（调用 CF 的 UDP）</label>
          <select id="wgEndpoint"></select></div>
        <button onclick="genWarp()">生成 WireGuard 节点</button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:8px">通过 Cloudflare WARP（基于 WireGuard 的 UDP 服务）实时注册账号并生成可用节点。客户端：WireGuard 官方 / NekoBox / sing-box / Hiddify。</div>
      <div id="wgResult"></div>
    </div>
  </div>

  <div class="pane" id="pane-custom">
    <div class="card" id="tplBox"><div class="muted">加载模板中…</div></div>
  </div>

  <div class="pane" id="pane-docs">
    <div class="card" id="docsBox"></div>
  </div>

  <div class="pane" id="pane-settings">
    <div class="card">
      <h3 style="margin-top:0">修改登录密码</h3>
      <label>新密码</label><input id="newPw" type="password" placeholder="新的面板登录密码">
      <button style="margin-top:12px" onclick="changePw()">保存密码（${passwordBackend}）</button>
      <div class="muted" style="font-size:12px;margin-top:8px">密码按 D1 → KV → 环境变量 的优先级读取。若使用 D1/KV 可在此直接修改。</div>
    </div>
  </div>

  <div class="foot">© 白极狐 · 北极欢迎你 · Cloudflare 节点服务器</div>
</div>

<div class="card" style="position:fixed;right:24px;bottom:24px;display:none" id="qrCard">
  <div class="row" style="justify-content:space-between"><b>节点二维码</b><span class="btn ghost sm" onclick="closeQr()">关闭</span></div>
  <div class="qr" id="qr" style="margin-top:8px"></div>
</div>
<div class="toast" id="toast"></div>

<script>
const HOST=${JSON.stringify(host)};
const BASE=${JSON.stringify(base)};
function tab(el){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));el.classList.add('active');
document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
document.getElementById('pane-'+el.dataset.pane).classList.add('active');}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1500);}
function copyText(v){navigator.clipboard.writeText(v);toast('已复制');}
function uuidVal(){return document.getElementById('inUuid').value.trim();}

function subUrls(uuid){
  const base=location.origin+'/sub/'+uuid;
  return {vless:base+'?type=vless',tuic:base+'?type=tuic',all:base+'?type=all'};
}
function renderSub(){
  const u=subUrls(document.getElementById('curUuid').textContent);
  document.getElementById('subLinks').innerHTML=
    ['vless','tuic','all'].map(k=>'<button class="btn ghost sm" onclick="copyText(\\''+u[k]+'\\')">'+k.toUpperCase()+' 订阅</button>').join(' ');
}

async function loadNodes(){
  const uuid=uuidVal();const count=document.getElementById('inCount').value;
  document.getElementById('curUuid').textContent=uuid;renderSub();
  const r=await fetch(BASE+'/api/nodes?uuid='+encodeURIComponent(uuid)+'&count='+count);
  const data=await r.json();
  const all=[...data.vless,...data.tuic];
  document.getElementById('nodeList').innerHTML=all.map((n,i)=>nodeHtml(n,i)).join('');
  window.__nodes=all;
}
function nodeHtml(n,i){
  const cls=n.type==='vless'?'v':'t';
  return '<div class="node"><div class="top">'+
    '<div><span class="pill '+cls+'">'+n.type.toUpperCase()+'</span> <b>'+n.name+'</b><div class="muted" style="font-size:12px">'+n.address+':'+n.port+'</div></div>'+
    '<div class="row"><span class="lat" id="lat'+i+'">—</span>'+
    '<button class="btn ghost sm" onclick="testOne('+i+')">测速</button>'+
    '<button class="btn ghost sm" onclick="copyText(window.__nodes['+i+'].link)">复制</button>'+
    '<button class="btn ghost sm" onclick="showQr('+i+')">二维码</button></div>'+
    '</div><div class="lk">'+n.link+'</div></div>';
}
async function testOne(i){
  const n=window.__nodes[i];const el=document.getElementById('lat'+i);el.textContent='测试中…';
  try{
    const r=await fetch(BASE+'/api/test?target='+encodeURIComponent(n.address+':'+n.port));
    const d=await r.json();
    el.textContent=d.ok?(d.latency+' ms'):'失败';
    el.style.color=d.ok?(d.latency<300?'var(--ok)':'var(--warn)'):'var(--err)';
  }catch(e){el.textContent='失败';el.style.color='var(--err)';}
}
async function testAll(){if(!window.__nodes)await loadNodes();for(let i=0;i<window.__nodes.length;i++){await testOne(i);}toast('测试完成');}

function showQr(i){const n=window.__nodes[i];document.getElementById('qrCard').style.display='block';
  const box=document.getElementById('qr');box.innerHTML='';new QRCode(box,{text:n.link,width:200,height:200});}
function closeQr(){document.getElementById('qrCard').style.display='none';}

const WARP_ENDPOINTS=['engage.cloudflareclient.com:2408','162.159.192.1:2408','162.159.193.10:2408','188.114.96.1:2408','188.114.97.1:2408'];
document.getElementById('wgEndpoint').innerHTML=WARP_ENDPOINTS.map(e=>'<option>'+e+'</option>').join('');
async function genWarp(){
  const ep=document.getElementById('wgEndpoint').value;const box=document.getElementById('wgResult');
  box.innerHTML='<div class="muted" style="margin-top:10px">正在注册 WARP 账号并生成…</div>';
  try{
    const r=await fetch(BASE+'/api/warp?endpoint='+encodeURIComponent(ep));const d=await r.json();
    if(!d.ok){box.innerHTML='<div style="color:var(--err);margin-top:10px">生成失败：'+(d.error||'')+'</div>';return;}
    window.__wg=d;
    box.innerHTML=
      '<div class="node" style="margin-top:12px"><div class="top"><b>WireGuard 配置 (.conf)</b>'+
      '<div class="row"><button class="btn ghost sm" onclick="copyText(window.__wg.conf)">复制conf</button>'+
      '<button class="btn ghost sm" onclick="copyText(window.__wg.link)">复制链接</button>'+
      '<button class="btn ghost sm" onclick="wgQr()">二维码</button></div></div>'+
      '<pre>'+d.conf+'</pre></div>'+
      '<div class="node"><div class="top"><b>sing-box outbound</b><button class="btn ghost sm" onclick="copyText(window.__wg.singbox)">复制</button></div><pre>'+d.singbox+'</pre></div>'+
      '<div class="node"><b>wireguard:// 链接</b><div class="lk">'+d.link+'</div></div>';
    toast('已生成 WireGuard 节点');
  }catch(e){box.innerHTML='<div style="color:var(--err)">请求失败</div>';}
}
function wgQr(){document.getElementById('qrCard').style.display='block';
  const box=document.getElementById('qr');box.innerHTML='';new QRCode(box,{text:window.__wg.conf,width:220,height:220});}

async function loadTemplates(){
  const r=await fetch(BASE+'/api/templates?uuid='+encodeURIComponent(uuidVal()));
  const tpls=await r.json();
  document.getElementById('tplBox').innerHTML=tpls.map(t=>
    '<div class="node"><div class="top"><b>'+t.title+'</b><button class="btn ghost sm" onclick="copyText(\\''+t.example.replace(/'/g,"\\\\'")+'\\')">复制模板</button></div>'+
    '<div class="muted" style="font-size:12px;margin-top:6px">'+t.desc+'</div>'+
    '<div class="lk">'+t.example+'</div></div>').join('');
}

const DOCS=\`<h3 style="margin-top:0">各类节点最精简正确配置说明</h3>
<div class="kv"><div>客户端</div><div>推荐：v2rayN / NekoBox / sing-box / Shadowrocket / Clash Meta</div></div>
<h4>① VLESS + WS + TLS（主力，CF 真正可用）</h4>
<pre>地址(address): 你的部署域名 或 CF优选IP/域名
端口(port): 443 / 2053 / 2083 / 2087 / 2096 (TLS)
用户ID(id): 你的 UUID
传输(network): ws
路径(path): /?ed=2560
TLS: 开启   SNI/Host: 你的部署域名(*.pages.dev / *.workers.dev / 自定义域)
指纹(fp): randomized   allowInsecure: 关闭</pre>
<div class="muted">国内连不上时，把 address 换成「优选 IP/域名」，SNI 与 Host 仍保持你的部署域名。</div>
<h4>② TUIC v5（辅助）</h4>
<pre>地址: 支持 QUIC 的后端地址   端口: 443
UUID: 你的 UUID   password: 你的 UUID(或自定义)
alpn: h3   congestion_control: bbr   udp_relay_mode: native
内核: 必须使用 sing-box（Xray 不支持 TUIC）</pre>
<div class="muted">⚠️ Cloudflare Workers/Pages 不支持 QUIC 入站，TUIC 节点需配合自建/第三方 QUIC 后端；订阅里提供 TUIC 链接以便兼容多协议客户端。</div>
<h4>③ WireGuard（WARP，调用 CF 的 UDP）</h4>
<pre>在「WireGuard (WARP)」标签点「生成」→ 得到 .conf / sing-box / wireguard:// 链接
客户端: WireGuard 官方App / NekoBox / sing-box / Hiddify
端点(Endpoint): engage.cloudflareclient.com:2408 或 162.159.192.1:2408 (CF 的 UDP)
MTU: 1280   AllowedIPs: 0.0.0.0/0, ::/0   DNS: 1.1.1.1
WARP 为基于 WireGuard 的 UDP 服务，节点真实可用；如需解锁更多可叠加 WARP+。</pre>
<h4>④ 抗探测/防侦测</h4>
<pre>ADMIN_PATH=/你的私密路径   隐藏登录面板，根路径不暴露
FAKE_WEBSITE=https://example.com   未授权访问反代到正常网站(防主动探测)
WS_PATH=/你的ws路径   仅该路径接受 WS，其它伪装
节点指纹 fp=randomized；建议用自定义域名 + 优选IP</pre>
<h4>⑤ 国内访问 Google 等外网</h4>
<pre>1) 部署本项目到 Cloudflare（Pages/Workers）
2) 设置 UUID 环境变量；如有自定义域名解析到 CF 更稳
3) 导入「VLESS 订阅」到客户端，选延迟低的节点
4) 若默认 IP 被墙，使用优选 IP/域名 + 优选端口</pre>\`;
document.getElementById('docsBox').innerHTML=DOCS;

async function changePw(){
  const pw=document.getElementById('newPw').value;if(!pw)return toast('请输入新密码');
  const r=await fetch(BASE+'/api/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw})});
  const d=await r.json();toast(d.ok?('已保存到 '+d.backend):(d.error||'保存失败'));
}

loadNodes();loadTemplates();renderSub();
</script>
</body></html>`;
}
