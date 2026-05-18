# 实施规划 v0.2

基于 [`prd-review-v0.2.md`](./prd-review-v0.2.md) 的决策，给出从零到上线的工程拆解。预算约 1 周（PRD M0–M6）。

---

## 仓库结构

单仓库（monorepo），用 npm workspaces。

```
chatroom-ai/
├── README.md / LICENSE / chatroom-prd-v02.md
├── .gitignore / .nvmrc                       # node 20 LTS
├── package.json                              # workspaces: ["backend","frontend"]
├── ecosystem.config.cjs                      # PM2
├── deploy/
│   ├── nginx.conf.example                    # /api /ws /mcp /chat 反代
│   ├── backup-sqlite.sh                      # 定时备份
│   └── README.md                             # 部署步骤
├── docs/
│   ├── prd-review-v0.2.md
│   ├── implementation-plan-v0.2.md           # 本文
│   ├── api.md                                # REST 详表
│   ├── ws-protocol.md
│   └── mcp-tools.md
│
├── backend/                                  # ESM JavaScript
│   ├── package.json                          # "type":"module"
│   ├── jsconfig.json                         # checkJs: true
│   ├── .env.example
│   ├── src/
│   │   ├── server.js                         # 入口
│   │   ├── config.js                         # env 集中
│   │   ├── logger.js                         # pino
│   │   ├── db/
│   │   │   ├── index.js                      # better-sqlite3 单例 + PRAGMA
│   │   │   ├── migrate.js
│   │   │   └── migrations/001_init.sql
│   │   ├── auth/{jwt,password,middleware}.js
│   │   ├── routes/{index,auth,me,room,message}.routes.js
│   │   ├── ws/{server,hub,handlers,broadcaster}.js
│   │   ├── mcp/
│   │   │   ├── server.js                     # @modelcontextprotocol/sdk
│   │   │   ├── transport.js                  # Streamable HTTP
│   │   │   └── tools/                        # 9 个工具，一文件一个
│   │   ├── services/{user,room,message,membership,join-attempt,presence}.service.js
│   │   └── utils/{room-code,rate-limit,mention,validate,errors}.js
│   ├── data/                                 # 运行时 .db（gitignore）
│   └── test/                                 # vitest
│
└── frontend/                                 # Vue 3 + TS
    ├── package.json / tsconfig.json / vite.config.ts
    ├── index.html
    └── src/
        ├── main.ts / App.vue / router.ts
        ├── api/{client,auth,rooms,messages}.ts
        ├── ws/client.ts                      # 重连 + 心跳 + 订阅
        ├── stores/{auth,rooms,messages,presence}.ts
        ├── views/{Login,Register,RoomList,Chat,Profile}View.vue
        ├── components/
        │   ├── MessageBubble.vue / MessageList.vue
        │   ├── ChatInput.vue                 # @ 自动补全
        │   ├── MemberPanel.vue
        │   └── {Create,Join}RoomDialog.vue
        ├── utils/{markdown,mention,time}.ts
        └── styles/{tokens,global}.css
```

---

## 后端关键模块职责

| 文件 | 职责 |
|---|---|
| `src/server.js` | load env → migrate → 建 express → 挂 routes → 建 http → 挂 ws.upgrade → 挂 mcp → listen |
| `src/db/index.js` | `new Database(path)`；`PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000` |
| `src/auth/middleware.js` | `requireAuth` 中间件；`extractToken` 支持 `Authorization: Bearer` 与 cookie；WS upgrade 用 Subprotocol 提取 token |
| `src/ws/hub.js` | `userConns: Map<uid, Set<WS>>`、`roomMembersOnline: Map<rid, Set<uid>>`；导出 `addConn / removeConn / onlineInRoom / sendToUser / broadcastRoom` |
| `src/ws/broadcaster.js` | 业务统一出口：`emitMessageCreated / emitMemberJoined / emitMemberLeft / emitMemberKicked / emitRoomDeleted / emitPresenceChanged` |
| `src/services/room.service.js` | createRoom / joinRoom（含失败计数 + 黑名单）/ leaveRoom（含房主转让）/ kick / deleteRoom / updatePassword / listMyRooms / getRoomDetail |
| `src/services/message.service.js` | sendMessage（事务：写库 + 解析 mention；广播在事务外）/ listMessages(before_id, limit) |
| `src/services/join-attempt.service.js` | recordFailure / reset / isLocked / getRemainingMinutes（原子 upsert） |
| `src/services/presence.service.js` | `touch(uid)` 节流 30s 写 `last_seen_at`；`isOnline(uid)` = `hub.in OR last_seen_at < 90s` |
| `src/utils/rate-limit.js` | `limit(key, max, windowMs)`；用于 login / register / send / ws connect |

---

## 里程碑

每阶段给出交付物 + 验证方法。

### M0（0.5d）项目骨架

- npm workspaces；`.nvmrc`；后端 `/healthz`；db 自动 migrate
- 验证：`npm run dev`；`curl /healthz`；`sqlite3 .tables` 见 6 表

### M1（2d）用户 + 房间 REST

- 注册 / 登录 / me；创建房间（6 位 base32 code 去歧义字符）
- join 含失败计数 + 锁定（错 5 次 → `ROOM_LOCKED`）
- list / detail / delete / kick / 改密码 / leave（含房主转让）
- 登录 + 注册限流
- 验证：`deploy/test-api.sh` curl 套件 + vitest service 层单测

### M2（1d）WebSocket 实时

- upgrade 通过 Subprotocol 鉴权
- hub + subscribe / unsubscribe
- send 路径（写库 → 广播）+ `client_msg_id` 幂等
- presence（join/leave）
- 历史消息 GET 翻页（`before_id` 升序返回 + `has_more`）
- 验证：两个 `wscat` 互发；同 `client_msg_id` 重发只入库一次

### M3（1d）MCP Server

- 装 `@modelcontextprotocol/sdk` Streamable HTTP
- 9 个工具（含补的 `chat_leave_room` / `chat_list_rooms`）
- MCP 调用刷 `last_seen_at`
- 验证：MCP Inspector 列工具 → register → login → create → join → send → 浏览器端 WS 收到消息

### M4（2d）前端

- Vite + Vue + Router + Pinia + 深色暖色主题 tokens
- 登录 / 注册；房间列表 + 创建 / 加入弹窗
- 聊天页：消息列表 + 输入 + Markdown 渲染 + @ 高亮
- WS client 重连 + 心跳
- 成员面板 + online 圆点 + 房主踢人按钮
- 移动端抽屉式侧栏

### M5（1d）联调与部署

- Nginx 反代 `/api /ws /mcp /chat`（`proxy_read_timeout 3600s`）
- PM2 ecosystem + 日志切割
- SQLite cron 备份
- Let's Encrypt（SSL Labs ≥ A）

### M6（0.5d）Agent 接入验证

- 墨星/墨衍 agent 配 MCP URL + Bearer
- 端到端剧本：注册 → 建房 → 邀请人类加入 → 对话 → 翻历史
- 性能：100 历史 + 5 WS + 10 msg/s 延迟 < 500ms
- 逐条勾选 PRD 第十节 8 项验收

---

## 关键风险

见 `prd-review-v0.2.md` 末节。最值得提前处理：

1. **MCP SDK 版本锁定**：exact pin
2. **better-sqlite3 native 编译**：`.nvmrc` + 部署脚本 `npm rebuild`
3. **JWT + Markdown XSS**：DOMPurify + CSP 缺一不可
4. **Nginx WS 超时**：`proxy_read_timeout 3600s` + 25s 心跳
5. **删除房间事务**：先事务写库，再事务外广播

---

## 关键文件（M0–M3 需新建）

- `backend/src/server.js`
- `backend/src/db/migrations/001_init.sql`
- `backend/src/ws/hub.js`
- `backend/src/ws/broadcaster.js`
- `backend/src/mcp/server.js`
- `backend/src/services/room.service.js`
- `backend/src/services/message.service.js`
- `backend/src/services/join-attempt.service.js`
- `frontend/src/ws/client.ts`
- `frontend/src/views/ChatView.vue`
- `deploy/nginx.conf.example`
- `ecosystem.config.cjs`
