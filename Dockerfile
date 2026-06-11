# 白极狐 · Docker 部署
# 使用 Cloudflare 官方运行时 workerd（由 wrangler 驱动），因此 cloudflare:sockets
# 与 WebSocket 在容器内同样可用——可把任意 VPS 当作节点服务器自建 VPN。
FROM node:22-bookworm-slim

WORKDIR /app

# 仅先拷贝依赖清单以利用缓存
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .

# 通过环境变量配置（见 README）：UUID / PASSWORD / DOMAIN / PROXYIP / PREFERRED_IPS / TUIC_PASSWORD
ENV UUID="86c50e3a-5b87-49dd-bd20-03c7f2735e40" \
    PASSWORD="admin" \
    PORT=8787

EXPOSE 8787

# wrangler dev 使用 workerd 本地运行，支持出站 TCP（cloudflare:sockets）
CMD ["sh", "-c", "npx wrangler dev --ip 0.0.0.0 --port ${PORT} \
  --var UUID:${UUID} --var PASSWORD:${PASSWORD} \
  ${DOMAIN:+--var DOMAIN:${DOMAIN}} \
  ${PROXYIP:+--var PROXYIP:${PROXYIP}} \
  ${PREFERRED_IPS:+--var PREFERRED_IPS:${PREFERRED_IPS}} \
  ${TUIC_PASSWORD:+--var TUIC_PASSWORD:${TUIC_PASSWORD}} \
  ${ADMIN_PATH:+--var ADMIN_PATH:${ADMIN_PATH}} \
  ${FAKE_WEBSITE:+--var FAKE_WEBSITE:${FAKE_WEBSITE}} \
  ${WS_PATH:+--var WS_PATH:${WS_PATH}}"]
