# PRD v0.2 Review 报告

**审阅对象**：`chatroom-prd-v02.md`
**日期**：2026-05-18
**结论**：PRD 整体清晰、可落地，但有 14 处需要在动工前补齐决策。下方逐条列出问题、建议方案与影响范围。

---

## 缺口与建议一览

| # | 类别 | 问题 | 建议方案 |
|---|---|---|---|
| 1 | API | 第七节"API 端点"列表缺少 PRD 正文提到的「修改房间密码」「自愿退出房间」 | 补 `PATCH /api/rooms/:id/password`、`POST /api/rooms/:id/leave` |
| 2 | MCP | 工具集缺少「退出房间」「列出我的房间」 | 新增 `chat_leave_room`、`chat_list_rooms`，让 Agent 不必回退到 REST |
| 3 | 协议 | WebSocket 消息协议完全未定义 | 采用「请求/响应 + 广播」双轨；客户端发 `client_msg_id` 做幂等。详见 `docs/ws-protocol.md` |
| 4 | 在线状态悖论 | Agent 走 MCP 是无状态短调用、不持有 WS → 在 PRD 当前定义下 Agent 永远显示 offline | online 判定改为 `WS 在场 OR last_seen_at < 90s`；任何 MCP 工具调用都刷 `users.last_seen_at` |
| 5 | 安全 | WS 用 `?token=` 在 URL、MCP 同样 | WS 改 `Sec-WebSocket-Protocol: bearer,<token>`；MCP 用 `Authorization: Bearer`；`?token=` 仅作浏览器 fallback |
| 6 | 协议矛盾 | 第八节末同时说"MCP 也可暴露 register/login"——但 PRD 第 3.4 已经把它们列为 MCP 工具 | 明确二者并存：`chat_register` / `chat_login` 是允许匿名调用的工具；其余工具要求 Bearer |
| 7 | @提及 | 用 nickname 还是 username？昵称可重复时如何唯一定位？ | 用 `@<username>`（唯一），渲染时显示 nickname；输入框做 @ 自动补全 |
| 8 | 安全 | "支持基本 Markdown 渲染"未指定库与 XSS 策略 | 前端 `markdown-it` + `DOMPurify` 白名单；服务端只存原文；CSP 禁 inline script |
| 9 | 技术栈 | PRD 写 MCP "SSE endpoint"，但 2026 年 Streamable HTTP 已是标准 | 采用 Streamable HTTP transport，向后仍可挂 SSE 兜底 |
| 10 | 限流 | 除 `join_attempts` 外，登录、注册、发消息均无限流 | 登录 `ip+username` 5/min、注册 ip 10/h、发消息 uid 10/10s、WS 连接 uid 5/min；内存滑窗即可 |
| 11 | 业务空白 | 房主退出 / 删账号后房间归属未定义 | 房主 `leave`：若仍有成员→自动转给最早加入者；只剩房主→自动删除房间；删账号 v0.2 不实现 |
| 12 | 业务空白 | 被踢用户能否重新加入？ | 写入 `room_bans` 表；再加入返回 `BANNED`；解禁端点放 v0.3 |
| 13 | 持久层 | SQLite 并发未提 | `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`；读-改-写一律 `db.transaction()` |
| 14 | 运维 | JWT secret 管理、轮换策略缺失 | env 注入 `JWT_SECRET`（≥64 字符），启动校验长度；轮换 = 改 env + 重启 |

补充约定：

- **前端选型**（PRD 第 4.1 二选一）：**Vue 3 + Vite + Pinia + TypeScript**
- **后端语言**：纯 JavaScript ESM（`"type":"module"`）+ `// @ts-check` + jsconfig 轻量类型检查
- **消息分页方向**：服务端 `id < before_id ORDER BY id DESC LIMIT n`，**返回按 id 升序**，附 `has_more`

---

## 数据模型增补

在 PRD schema 之外追加：

```sql
-- users
last_seen_at DATETIME
updated_at DATETIME

-- rooms
updated_at DATETIME
deleted_at DATETIME             -- 软删，避免外键悬挂

-- room_members
role TEXT DEFAULT 'member'      -- 'owner'|'member'，便于房主转让

-- messages
type TEXT DEFAULT 'text'        -- 'text'|'system'
client_msg_id TEXT              -- 幂等键
mentioned_user_ids TEXT         -- JSON 数组

CREATE UNIQUE INDEX idx_messages_client_id
  ON messages(room_id, user_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

CREATE INDEX idx_room_members_user ON room_members(user_id);

-- 新表：踢人黑名单
CREATE TABLE room_bans (
  room_id INTEGER REFERENCES rooms(id),
  user_id INTEGER REFERENCES users(id),
  banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id)
);
```

---

## 关键风险（提前处理）

1. **MCP SDK 版本漂移**：锁 exact 版本到 `package.json`，README 标注。
2. **better-sqlite3 native 编译**：`.nvmrc` 锁 Node 20 LTS；部署脚本兜底 `npm rebuild better-sqlite3`。
3. **JWT 在 localStorage + Markdown XSS**：DOMPurify 白名单 + CSP 禁 inline script 缺一不可，否则 token 会被偷光。
4. **Nginx WS 默认 60s 超时**：必须 `proxy_read_timeout 3600s` + server 25s 心跳。
5. **删除房间与在线成员竞态**：先 `db.transaction` 写删除，再事务外广播 `room_deleted` 并清 hub；事务里不要做 broadcast。

---

## 不变更项（PRD 原样保留）

- 验收标准 8 条
- 里程碑 M0–M6 节拍
- 房间号 6 位字母数字（实际改为 base32 去歧义字符 0/O/1/I）
- 默认 `max_members=20`
- 错 5 次锁 30 分钟（按 user_id+room_id 维度）
- 不做 AI 推理 / 不做 prompt 管理 / 不公开广播

---

详细的实施规划见 [`implementation-plan-v0.2.md`](./implementation-plan-v0.2.md)。
