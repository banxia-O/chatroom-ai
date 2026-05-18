# 部署指南

## 目标拓扑

```
Browser ──HTTPS/WSS──> Nginx (443) ──HTTP/WS──> Node (PM2, 127.0.0.1:3000) ──> SQLite
                                  ──静态──> /srv/banxia/frontend/dist
```

单机部署，约 1GB RAM 的 VPS 已够用（PRD 验收目标 100 历史 + 5 WS + 10 msg/s）。

## 1. 服务器准备（Ubuntu 22.04+）

```bash
# 基础
sudo apt update && sudo apt install -y curl git build-essential sqlite3 nginx

# Node 22 LTS（nvm 装到 root，或换 nodesource）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm alias default 22

# PM2
npm i -g pm2
```

## 2. 拉代码 + 配置 env

```bash
sudo mkdir -p /srv/banxia
sudo chown $USER /srv/banxia
cd /srv/banxia
git clone <your-repo-url> .

npm install
cp backend/.env.example backend/.env

# 生成 64+ 字符 JWT_SECRET
SECRET=$(openssl rand -hex 48)
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${SECRET}/" backend/.env

# 跑一次 migrate（首次启动也会自动迁移）
npm run migrate
```

## 3. 构建前端

```bash
npm --workspace frontend run build
# 产物在 /srv/banxia/frontend/dist
```

## 4. 启动后端（PM2）

```bash
cd /srv/banxia
mkdir -p logs
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup        # 跟随提示再跑一次它打印出来的 sudo 命令
```

查看：

```bash
pm2 status
pm2 logs banxia-backend
curl http://127.0.0.1:3000/healthz
```

## 5. Nginx 反代

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/banxia
sudo nano /etc/nginx/sites-available/banxia   # 改 server_name / 证书路径
sudo ln -sf /etc/nginx/sites-available/banxia /etc/nginx/sites-enabled/banxia
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Let's Encrypt（HTTPS）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d md-banxia.cn
# certbot 会自动改 Nginx 配置插入证书路径；如果不希望它改，用 certonly + webroot：
#   sudo mkdir -p /var/www/certbot
#   sudo certbot certonly --webroot -w /var/www/certbot -d md-banxia.cn
```

renewal 自动续期由 systemd timer 提供：`systemctl status certbot.timer`。

## 7. 定时备份

```bash
crontab -e
# 每天凌晨 3:15 备份；保留 14 天
15 3 * * * /srv/banxia/deploy/backup-sqlite.sh >> /srv/banxia/logs/backup.log 2>&1
```

恢复：`gunzip -c /srv/banxia/backups/chatroom-XXX.db.gz > /srv/banxia/backend/data/chatroom.db && pm2 reload banxia-backend`。

## 8. 冒烟与验收

```bash
# REST 端到端
BASE=https://md-banxia.cn bash deploy/test-api.sh

# WS 握手 + 心跳
wscat -c wss://md-banxia.cn/ws -s "bearer,$(curl -s -X POST https://md-banxia.cn/api/login \
  -H 'content-type: application/json' \
  -d '{"username":"yourname","password":"yourpw"}' | jq -r .token)"

# MCP tools/list
curl -sS https://md-banxia.cn/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

## 9. 上线后日常运维

| 操作 | 命令 |
|---|---|
| 看后端实时日志 | `pm2 logs banxia-backend` |
| 看 Nginx 错误 | `tail -f /var/log/nginx/banxia.error.log` |
| 重启后端（零停机） | `pm2 reload banxia-backend` |
| 升级代码 | `git pull && npm install && npm --workspace frontend run build && pm2 reload banxia-backend && sudo systemctl reload nginx` |
| 查看数据库 | `sqlite3 backend/data/chatroom.db ".tables"` |
| 手动备份 | `bash deploy/backup-sqlite.sh` |
| 轮换 JWT_SECRET | 改 `backend/.env` → `pm2 reload banxia-backend`（所有人需重新登录） |

## 10. 性能 & 容量

- 单进程 + WAL：单机大约稳跑 50 个并发 WS、20 msg/s 长时无问题
- SQLite WAL 自动 checkpoint；如果写入特别频繁，可手工 `PRAGMA wal_checkpoint(TRUNCATE);`
- 横向扩展：当前架构 hub / 限流都在内存，需要先迁 Redis 才能多实例（v0.3+）

## 11. 排错

- **WS 握手失败 401**：Subprotocol 必须 `bearer,<jwt>`；浏览器允许的 fallback 是 `?token=` 但 Nginx 不剥参数
- **WS 60s 自动断**：Nginx 默认 `proxy_read_timeout=60s`；本配置已拉到 3600s
- **SQLite "database is locked"**：检查是否有多个 PM2 实例 — 必须 `instances: 1`
- **前端刷新 404**：检查 `try_files $uri $uri/ /index.html;`
- **MCP SSE 截断**：检查 `proxy_buffering off;` 是否生效
