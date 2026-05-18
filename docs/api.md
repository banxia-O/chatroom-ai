# REST API 详表

> Base URL：`https://md-banxia.cn/api`
> 鉴权：`Authorization: Bearer <token>`（除 register / login 外必带）
> 内容协商：请求 / 响应均为 `application/json; charset=utf-8`

---

## 鉴权

### POST /api/register

注册新用户。

**body**

```json
{
  "username": "yubai",         // 必填，唯一，3–32 字符，[A-Za-z0-9_]
  "password": "...",           // 必填，8–128 字符
  "nickname": "予白",            // 必填，1–24 字符
  "avatar": "🍵"                // 可选，emoji 或 https URL（白名单）
}
```

**200**

```json
{ "user_id": 12, "token": "<jwt>" }
```

**错误码**：`USERNAME_TAKEN` / `INVALID_INPUT` / `RATE_LIMITED`

---

### POST /api/login

**body**：`{ "username", "password" }`
**200**：`{ "token": "<jwt>", "user": { "id", "username", "nickname", "avatar" } }`
**错误码**：`INVALID_CREDENTIALS` / `RATE_LIMITED`

限流：`ip + username` 5/min。

---

## 个人

### GET /api/me

返回当前用户。

### PUT /api/me

**body**：`{ "nickname"?, "avatar"? }` → `{ "user": {...} }`

---

## 房间

### POST /api/rooms

创建房间。

**body**：`{ "name", "password", "max_members"? }`
**200**：`{ "room": { "id", "code", "name", "owner_id", "max_members", "created_at" } }`

### POST /api/rooms/join

加入房间。

**body**：`{ "code", "password" }`
**200**：`{ "room": {...}, "members": [...] }`
**错误码**：`ROOM_NOT_FOUND` / `INVALID_PASSWORD` / `ROOM_FULL` / `ROOM_LOCKED` / `ROOM_BANNED`

`ROOM_LOCKED` 的 details 含 `{ "locked_until": "ISO8601", "remaining_minutes": N }`。

### GET /api/rooms

**200**：`{ "rooms": [{ "id", "code", "name", "member_count", "last_message_at", "my_role" }] }`

### GET /api/rooms/:id

**200**：`{ "room": {...}, "members": [...], "my_role": "owner"|"member" }`

### DELETE /api/rooms/:id

仅房主。软删（`deleted_at`），同步广播 `room_deleted`、关 WS。
**200**：`{ "ok": true }`

### PATCH /api/rooms/:id/password ← PRD 补

仅房主。
**body**：`{ "new_password" }` → `{ "ok": true }`
广播 `room_updated{ changes: ["password"] }`。

### POST /api/rooms/:id/leave ← PRD 补

任意成员可调用。房主退出 → 自动转让给最早加入的成员；若房间只剩房主 → 自动删除。
**200**：`{ "ok": true, "transferred_to": <uid>? , "deleted": true? }`
广播 `member_left` 或 `room_deleted`。

### POST /api/rooms/:id/kick

仅房主。
**body**：`{ "user_id" }` → `{ "ok": true }`
写入 `room_bans`；广播 `member_kicked`；服务端断开被踢用户在该房间的 WS 订阅。

---

## 消息

### GET /api/rooms/:id/messages

**query**：`before_id`（可选，游标）、`limit`（默认 100，上限 200）
**200**：`{ "messages": [...], "has_more": bool }`

返回顺序：**按 id 升序**（旧 → 新）。服务端查询用 `WHERE id < before_id ORDER BY id DESC LIMIT n`，返回前反转。

每条 message：

```json
{
  "id": 999,
  "user_id": 12,
  "nickname": "予白",
  "avatar": "🍵",
  "content": "hello",
  "type": "text",
  "client_msg_id": "...",
  "mentioned_user_ids": [3, 5],
  "created_at": "2026-05-18T09:30:00Z"
}
```

### POST /api/rooms/:id/messages

兜底通道，正常应走 WS。
**body**：`{ "content", "client_msg_id"? }`
**200**：`{ "message": {...} }`

限流：`uid` 10/10s。

---

## WebSocket

`wss://md-banxia.cn/ws`，Subprotocol：`Sec-WebSocket-Protocol: bearer,<jwt>`。
浏览器 fallback：`?token=`（仅作过渡）。

详见 [`ws-protocol.md`](./ws-protocol.md)。

---

## MCP

`https://md-banxia.cn/mcp`（Streamable HTTP），`Authorization: Bearer <jwt>`。
`chat_register` / `chat_login` 允许匿名调用，其余要求 Bearer。

详见 [`mcp-tools.md`](./mcp-tools.md)。

---

## 错误格式

```json
{ "error": { "code": "ROOM_LOCKED", "message": "...", "details": { } } }
```

全部 code 速查：

| code | HTTP |
|---|---|
| `INVALID_INPUT` | 400 |
| `INVALID_CREDENTIALS` | 401 |
| `UNAUTHENTICATED` | 401 |
| `BANNED` / `ROOM_BANNED` | 403 |
| `NOT_OWNER` / `NOT_MEMBER` | 403 |
| `ROOM_NOT_FOUND` | 404 |
| `USERNAME_TAKEN` | 409 |
| `ROOM_FULL` | 409 |
| `INVALID_PASSWORD` | 422 |
| `ROOM_LOCKED` | 423 |
| `RATE_LIMITED` | 429 |
| `INTERNAL` | 500 |
