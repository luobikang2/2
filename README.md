# 🦊 白极狐 · Cloudflare 代理面板（VLESS / TUIC）

> 卷首语：**北极欢迎你**

基于 **Cloudflare**（及同类边缘平台）把节点服务器搭起来，实现可用的代理 / VPN：中国大陆可借**优选 IP/域名**访问 Google 等外网。带**登录面板**、**一键生成订阅与二维码**、**节点连通/延迟测试**、**自定义节点模板**与**精简配置说明**。

- **VLESS（主力）**：VLESS + WebSocket + TLS，在 Cloudflare Workers/Pages 上**真正可用**。
- **TUIC（辅助）**：生成标准 TUIC 链接，兼容 sing-box 等客户端。
  > ⚠️ TUIC 基于 QUIC/UDP，**Cloudflare Workers/Pages 不支持 QUIC 入站**，TUIC 节点需配合支持 QUIC 的后端（自建/VPS，见 Docker 部署）。订阅中提供 TUIC 链接是为了多协议客户端兼容。
- **WireGuard（WARP，调用 CF 的 UDP）**：面板一键注册 Cloudflare WARP（基于 WireGuard 的 UDP 服务）账号，生成**真实可用**的 `.conf` / sing-box / `wireguard://` 节点与二维码。
- **抗探测/防侦测**：可隐藏面板路径、未授权访问反代到正常网站伪装、自定义 WS 路径、节点指纹随机化。

---

## ✨ 功能

- 登录界面：标题「白极狐」、卷首「北极欢迎你」，**可一键生成 UUID**，密码登录。
- 密码存储：**D1 → KV → 环境变量** 优先级，支持面板在线改密（D1/KV）。
- 变量 = **UUID + 绑定域名**；设置 UUID 后**自动生成 VLESS + TUIC 订阅链接、节点、二维码**。
- 一条订阅链接**生成 10 个节点**（可调 1–50），覆盖多优选 IP/域名 + 多端口，兼容各种设备。
- 自定义节点模板（VLESS/优选IP/TUIC）。
- 各类节点**最精简正确配置说明**。
- **节点连通 + 延迟测试**（服务端用 `cloudflare:sockets` 真实 TCP 探测）。
- 部署方式：**Pages 部署 / Git 拉取部署 / 上传文件部署 / 多平台 / Docker**。

---

## 🚀 快速部署

### 变量（环境变量）说明

| 变量 | 必填 | 说明 |
|---|---|---|
| `UUID` | ✅ | 节点用户 ID（变量核心）。登录页可一键生成 |
| `PASSWORD` | ✅* | 面板登录密码（使用 D1/KV 时可由数据库管理） |
| `DOMAIN` | 否 | 绑定域名，留空自动用访问域名（`*.pages.dev`/`*.workers.dev`/自定义域） |
| `PROXYIP` | 否 | 落地反代 IP，直连失败时回退 |
| `PREFERRED_IPS` | 否 | 优选 IP/域名，逗号或换行分隔，可写 `addr#备注` |
| `TUIC_PASSWORD` | 否 | TUIC 密码，留空用 UUID |
| `ADMIN_PATH` | 否 | 隐藏面板到私密路径（如 `/mysecret`），根路径不再暴露面板（抗探测） |
| `FAKE_WEBSITE` | 否 | 未授权/普通访问反代到的正常网站，伪装防主动探测（如 `https://example.com`） |
| `WS_PATH` | 否 | 仅该路径接受 VLESS WebSocket，其它路径走伪装 |

### 方式一：Pages 部署（Git 拉取部署，推荐）

1. Fork / 导入本仓库到你的 GitHub。
2. Cloudflare 控制台 → **Workers & Pages → 创建 → Pages → 连接到 Git**，选择本仓库。
3. 构建设置：
   - 构建命令：`npm run build`
   - 构建输出目录：`/`（根目录，产物为 `_worker.js`）
4. **设置 → 环境变量**：填入 `UUID`、`PASSWORD`（及可选项）。
5. 部署完成后访问 `https://<your>.pages.dev` 登录。

### 方式二：上传文件部署（无需 Git）

1. 本地执行 `npm install && npm run build`，得到根目录 `_worker.js`（或 `dist/worker.js`）。
2. **Pages**：创建 Pages 项目 → 选择「直接上传」→ 上传含 `_worker.js` 的文件夹。
   **Workers**：创建 Worker → 编辑代码 → 粘贴 `dist/worker.js` 内容 → 部署。
3. 在项目「设置 → 变量」里配置 `UUID`、`PASSWORD` 等。

> 仓库已内置构建好的 `_worker.js` 与 `dist/worker.js`，可直接上传，无需本地构建。

### 方式三：Wrangler CLI 部署（Workers）

```bash
npm install
# 编辑 wrangler.toml 里的 UUID/PASSWORD（及可选 D1/KV）
npx wrangler deploy
```

### 方式四：Docker 部署（自建 VPS 作为节点服务器）

```bash
# 1) docker compose
cp docker-compose.yml docker-compose.local.yml   # 按需修改变量
docker compose up -d --build

# 2) 或纯 docker
docker build -t baijihu .
docker run -d --name baijihu -p 8787:8787 \
  -e UUID=你的UUID -e PASSWORD=你的密码 \
  -e DOMAIN=你的域名 baijihu
```

容器使用 Cloudflare 官方运行时 **workerd**（由 wrangler 驱动），因此 `cloudflare:sockets` 与 WebSocket 同样可用——配合反代（Nginx/Caddy）加 TLS 即可作为节点服务器。

详见 [docs/DEPLOY.md](docs/DEPLOY.md)（含 D1/KV 绑定、自定义域名、各平台部署）。

---

## 🔑 使用

1. 打开部署地址 → 登录页可**一键生成 UUID**（复制后填到平台 `UUID` 变量）。
2. 输入 `PASSWORD` 登录操作面板。
3. 面板中：
   - 复制 **VLESS / TUIC / 全部** 订阅链接（`/sub/<uuid>?type=vless|tuic|all`）。
   - 一键生成 **10 个节点**，查看二维码、复制链接、**测速**。
   - 「自定义节点模板」生成各类节点模板。
   - 「配置说明」查看各客户端最精简正确配置。

### 订阅地址格式

```
https://<域名>/sub/<UUID>?type=vless      # 10 个 VLESS 节点（主力）
https://<域名>/sub/<UUID>?type=tuic       # 10 个 TUIC 节点（辅助）
https://<域名>/sub/<UUID>?type=all        # VLESS + TUIC 全部
&count=20                                  # 自定义数量（1–50）
```

---

## 🌐 国内访问 Google 等外网

1. 部署到 Cloudflare（Pages/Workers），设置 `UUID`。
2. 推荐解析**自定义域名**到 CF，更稳。
3. 客户端（v2rayN / NekoBox / sing-box / Shadowrocket / Clash Meta）导入 **VLESS 订阅**，选低延迟节点。
4. 默认 IP 被墙时：在 `PREFERRED_IPS` 配置**优选 IP/域名 + 优选端口**（TLS：443/2053/2083/2087/2096）。

---

## 🔒 WireGuard（WARP · 调用 CF 的 UDP）

WARP 是 Cloudflare 基于 **WireGuard** 的 UDP 服务，这是在 CF 生态里**真正能用 UDP** 的方式（Workers 自身不能直接开 UDP 入站）。

1. 登录面板 → 「WireGuard (WARP)」标签。
2. 选择 WARP UDP 端点（默认 `engage.cloudflareclient.com:2408`，亦可选 `162.159.192.1:2408` 等 CF 优选）。
3. 点「生成 WireGuard 节点」：后台实时注册 WARP 账号，生成：
   - 标准 `.conf`（WireGuard 官方 App / NekoBox 直接导入）
   - sing-box `wireguard` outbound JSON
   - `wireguard://` 分享链接 + 二维码
4. 客户端导入即可使用。需要更强解锁能力可叠加 WARP+。

> 关键参数：`MTU=1280`，`AllowedIPs=0.0.0.0/0, ::/0`，`DNS=1.1.1.1`，Peer 公钥为官方 WARP 公钥。

## 🛡️ 抗探测 / 防侦测

针对部署代理被「主动探测」识别的风险，提供多层伪装（全部可选，按需开启）：

| 措施 | 变量 | 效果 |
|---|---|---|
| 隐藏面板 | `ADMIN_PATH=/你的私密路径` | 登录面板只在该路径可达，根路径不暴露任何面板特征 |
| 伪装回落 | `FAKE_WEBSITE=https://正常站点` | 未授权 / 普通浏览器 / 扫描器访问时，**透明反代到正常网站**，看起来就是个普通站 |
| WS 路径收敛 | `WS_PATH=/你的隧道路径` | 仅该路径接受 VLESS WebSocket，其它一律走伪装 |
| 指纹随机化 | 默认 | 节点 `fp=randomized`，建议配合自定义域名 + 优选 IP |

推荐组合：`ADMIN_PATH` + `FAKE_WEBSITE` + `WS_PATH` 同时开启，外部探测只能看到一个正常网站。

## 🧩 平台兼容性

| 平台 / 方式 | 面板·订阅·WireGuard | VLESS 代理内核 |
|---|---|---|
| Cloudflare Workers | ✅ | ✅ |
| Cloudflare Pages | ✅ | ✅ |
| Docker / VPS（workerd） | ✅ | ✅ |
| 任意 Node 容器平台（Fly/Railway/Render，用本 Dockerfile） | ✅ | ✅（workerd 运行时） |
| Deno Deploy / Vercel Edge / Netlify Edge | ✅（面板/订阅/WireGuard） | ⚠️ 受限（VLESS 内核依赖 `cloudflare:sockets`，仅 CF/workerd 提供） |

> VLESS 代理内核需要运行时提供出站 TCP socket（`cloudflare:sockets`），因此在 Cloudflare 或基于 workerd 的环境（含本仓库 Docker 镜像）下可用；面板、订阅生成、WireGuard(WARP) 与配置说明则平台无关。

## 🛠️ 本地开发

```bash
npm install
npm run dev        # wrangler dev（workerd 本地运行，支持真实出站）
npm run build      # 生成 _worker.js / dist/worker.js
npm run lint
```

## 免责声明

本项目仅供学习与研究网络技术、保护合法通信隐私之用。请遵守所在地区法律法规，勿用于非法用途。
