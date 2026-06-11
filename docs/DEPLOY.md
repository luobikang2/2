# 部署详解

## 一、Cloudflare Pages（Git 拉取部署）

1. 把本仓库导入你的 GitHub。
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git。
3. Build settings：
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `/`
4. 部署后到 Settings → Environment variables 添加：
   - `UUID`（必填）
   - `PASSWORD`（必填，或绑定 D1/KV 由数据库管理）
   - 可选：`DOMAIN` / `PROXYIP` / `PREFERRED_IPS` / `TUIC_PASSWORD`

> Pages 高级模式会把根目录的 `_worker.js` 作为 Worker 运行。本仓库的 `npm run build` 会生成单文件 `_worker.js`。

## 二、Pages / Workers 上传文件部署

- 本仓库已内置构建产物：
  - `_worker.js`（Pages 上传 / 高级模式）
  - `dist/worker.js`（Workers 控制台粘贴）
- Pages「直接上传」：新建 Pages 项目 → Upload assets → 上传一个**包含 `_worker.js` 的文件夹**。
- Workers：新建 Worker → Quick edit → 粘贴 `dist/worker.js` 全部内容 → Save and Deploy。
- 之后在项目 Settings → Variables 配置变量。

## 三、Wrangler CLI（Workers）

```bash
npm install
npx wrangler login
# 编辑 wrangler.toml：UUID/PASSWORD，及可选 D1/KV、自定义域 routes
npx wrangler deploy
```

### 绑定自定义域名（Workers）

`wrangler.toml`：

```toml
routes = [
  { pattern = "vpn.example.com", custom_domain = true }
]
```

## 四、D1 数据库（在线管理密码）

```bash
npx wrangler d1 create baijihu
# 把输出的 database_id 填入 wrangler.toml 的 [[d1_databases]]，binding = "DB"
npx wrangler d1 execute baijihu --command "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);"
npx wrangler d1 execute baijihu --command "INSERT INTO settings (key,value) VALUES ('password','你的密码') ON CONFLICT(key) DO UPDATE SET value=excluded.value;"
```

绑定 D1 后，面板「设置 → 修改登录密码」可在线改密。

## 五、KV 命名空间（在线管理密码，备选）

```bash
npx wrangler kv namespace create KV
# 把 id 填入 wrangler.toml 的 [[kv_namespaces]]，binding = "KV"
npx wrangler kv key put --binding=KV password "你的密码"
```

读取优先级：**D1 → KV → 环境变量 `PASSWORD`**。

## 六、Docker / VPS（作为节点服务器）

```bash
docker compose up -d --build
# 或
docker build -t baijihu .
docker run -d --name baijihu -p 8787:8787 \
  -e UUID=你的UUID -e PASSWORD=你的密码 -e DOMAIN=你的域名 baijihu
```

容器内是 Cloudflare 官方运行时 workerd（wrangler 驱动），支持出站 TCP 与 WebSocket。
建议前置 Nginx/Caddy 反代并签发 TLS 证书，再把 VLESS 节点的 `address/SNI/Host` 指向你的域名。

Caddy 示例：

```caddyfile
vpn.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

## 七、其他平台

任意支持 Node + 出站 TCP 的容器平台（如 Fly.io、Railway、Render、自建 K8s）均可用本 Dockerfile 部署；
平台需放通 WebSocket。变量通过平台的环境变量面板配置。

## 常见问题

- **登录不进去**：确认 `PASSWORD` 已设置；若绑定 D1/KV，确认其中已写入 `password`。默认密码为 `admin`，请尽快修改。
- **节点连不上**：更换 `PREFERRED_IPS` 优选 IP/域名，或更换 TLS 端口；必要时设置 `PROXYIP`。
- **TUIC 不通**：CF 不支持 QUIC 入站，TUIC 需 QUIC 后端（VPS/自建）。
