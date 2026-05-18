# WebSocket 协议契约

## 连接

- URL：`wss://md-banxia.cn/ws`
- 鉴权：`Sec-WebSocket-Protocol: bearer,<jwt>`
  - 服务端必须把同样的 subprotocol 回到 `Sec-WebSocket-Protocol` 响应头，否则浏览器握手失败
  - 浏览器 fallback：`?token=<jwt>` 仅作过渡，服务端记录 deprecation 日志
- 编码：JSON 文本帧
- 心跳：客户端每 25s 发 `ping`；服务端 60s 无 ping 关闭连接
- Nginx：`proxy_read_timeout 3600s; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`

## 帧格式

```ts
{
  "type": string,
  "data": object,
  "id"?: string    // 客户端给请求帧带 id，服务端在 ack/error 帧回带
}
```

请求-响应类型：服务端回 `<type>:ack` 或 `<type>:error`。
广播类型：服务端主动推，无 `id`。

---

## client → server

| type | data | 说明 |
|---|---|---|
| `subscribe` | `{ room_id }` | 订阅某房间事件。必须是成员，可多房间并存 |
| `unsubscribe` | `{ room_id }` | 取消订阅（仅前端切走视图时调用，不代表退房） |
| `send` | `{ room_id, content, client_msg_id }` | 发消息；服务端用 `client_msg_id` 幂等去重 |
| `typing` | `{ room_id, is_typing }` | 节流广播（可选） |
| `ping` | `{}` | 心跳 |

---

## server → client

### 连接生命周期

| type | data |
|---|---|
| `ready` | `{ user_id, server_time }` 连接建立后立即下发 |
| `pong` | `{ server_time }` 响应 ping |
| `error` | `{ code, message }` 协议层错误（未鉴权 / 帧格式错） |

### 请求响应

| type | data |
|---|---|
| `subscribe:ack` | `{ room_id, online_user_ids }` |
| `subscribe:error` | `{ room_id, code, message }` |
| `send:ack` | `{ client_msg_id, message_id, created_at }` |
| `send:error` | `{ client_msg_id, code, message }` |

### 房间广播

| type | data |
|---|---|
| `message` | `{ room_id, message: { id, user_id, nickname, avatar, content, type, mentioned_user_ids, created_at } }` |
| `member_joined` | `{ room_id, user: { id, username, nickname, avatar } }` |
| `member_left` | `{ room_id, user_id }` |
| `member_kicked` | `{ room_id, user_id, by }` |
| `room_deleted` | `{ room_id }` |
| `room_updated` | `{ room_id, changes: ["name"\|"password"\|"max_members"] }` |
| `presence` | `{ room_id, user_id, online }` |

---

## 幂等与可靠性

- 客户端发 `send` 必带 `client_msg_id`（建议 ULID 或 `uuidv4`）
- 服务端入库前查 `(room_id, user_id, client_msg_id)` 唯一索引，重复直接返回原 message_id
- 客户端断线重连后，对未收到 `send:ack` 的消息重发（同 `client_msg_id`）

## 错误码

- 协议层：`UNAUTHENTICATED` / `BAD_FRAME` / `RATE_LIMITED`
- 业务层（在 `subscribe:error` / `send:error` 中）：`NOT_MEMBER` / `ROOM_DELETED` / `RATE_LIMITED`

## 在线状态判定

- 进入：WS 连接建立 → `hub.addConn(uid, conn)` → 该用户在所有已订阅房间广播 `presence{online:true}`
- 离开：WS 关闭 → `hub.removeConn(uid, conn)` → 若该 uid 无其余连接 → 90s 内不广播 offline（避免抖动）；超时仍未恢复 → 广播 `presence{online:false}`
- Agent：MCP 任意工具调用刷 `users.last_seen_at`；查询时 online = `hub.has(uid) OR last_seen_at < 90s`
