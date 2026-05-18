import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocket } from 'ws';
import { buildHttpServer } from '../src/server.js';
import { app, resetDb, teardown, registerAndLogin, auth } from './helpers.js';
import { hub } from '../src/ws/hub.js';
import { config } from '../src/config.js';

let server;
let port;
let mcpUrl;
let wsUrl;

beforeAll(async () => {
  server = buildHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  mcpUrl = `http://127.0.0.1:${port}/mcp`;
  wsUrl = `ws://127.0.0.1:${port}${config.ws.path}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  teardown();
});

beforeEach(() => {
  resetDb();
  hub.reset();
});

/**
 * 建立 MCP client。token 缺省 = 匿名（仅 register/login 能用）。
 */
async function connectMcp(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: headers ? { headers } : undefined,
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

/**
 * 解析 tool 返回的 structuredContent（或 JSON text 兜底）。
 */
function unwrap(result) {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.[0]?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return null;
}

// ---------- tests ----------

describe('mcp: 协议', () => {
  it('tools/list 返回 9 个工具', async () => {
    const { client } = await connectMcp();
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'chat_create_room',
        'chat_join_room',
        'chat_leave_room',
        'chat_list_rooms',
        'chat_login',
        'chat_members',
        'chat_read',
        'chat_register',
        'chat_send',
      ].sort(),
    );
    await client.close();
  });
});

describe('mcp: 鉴权', () => {
  it('chat_register 匿名可用', async () => {
    const { client } = await connectMcp();
    const r = await client.callTool({
      name: 'chat_register',
      arguments: {
        username: 'alice_mcp',
        password: 'hello1234',
        nickname: 'AliceM',
        avatar: '🍵',
      },
    });
    const data = unwrap(r);
    expect(r.isError).toBeFalsy();
    expect(typeof data.token).toBe('string');
    expect(typeof data.user_id).toBe('number');
    await client.close();
  });

  it('chat_login 拿 token，错密码 → INVALID_CREDENTIALS isError', async () => {
    await registerAndLogin('bob');
    const { client } = await connectMcp();
    const ok = await client.callTool({
      name: 'chat_login',
      arguments: { username: 'bob', password: 'password123' },
    });
    expect(ok.isError).toBeFalsy();
    expect(typeof unwrap(ok).token).toBe('string');

    const bad = await client.callTool({
      name: 'chat_login',
      arguments: { username: 'bob', password: 'wrongpass' },
    });
    expect(bad.isError).toBe(true);
    expect(unwrap(bad).error.code).toBe('INVALID_CREDENTIALS');
    await client.close();
  });

  it('chat_send 匿名 → UNAUTHENTICATED isError', async () => {
    const { client } = await connectMcp();
    const r = await client.callTool({
      name: 'chat_send',
      arguments: { room_id: 1, content: 'hi' },
    });
    expect(r.isError).toBe(true);
    expect(unwrap(r).error.code).toBe('UNAUTHENTICATED');
    await client.close();
  });

  it('chat_send 错 token → UNAUTHENTICATED isError', async () => {
    const { client } = await connectMcp('not-a-real-jwt');
    const r = await client.callTool({
      name: 'chat_send',
      arguments: { room_id: 1, content: 'hi' },
    });
    expect(r.isError).toBe(true);
    expect(unwrap(r).error.code).toBe('UNAUTHENTICATED');
    await client.close();
  });
});

describe('mcp: 房间', () => {
  it('chat_create_room → chat_join_room → chat_list_rooms', async () => {
    const { token: aToken, user: aUser } = await registerAndLogin('alice');
    const { token: bToken } = await registerAndLogin('bob');

    const a = await connectMcp(aToken);
    const create = await a.client.callTool({
      name: 'chat_create_room',
      arguments: { name: 'mcp-room', password: 'right1234' },
    });
    const created = unwrap(create);
    expect(typeof created.room_id).toBe('number');
    expect(created.code).toMatch(/^[A-Z2-9]{6}$/);

    const b = await connectMcp(bToken);
    const join = await b.client.callTool({
      name: 'chat_join_room',
      arguments: { code: created.code, password: 'right1234' },
    });
    const joined = unwrap(join);
    expect(joined.room_id).toBe(created.room_id);
    expect(joined.members.some((m) => m.user_id === aUser.id)).toBe(true);

    const list = await b.client.callTool({
      name: 'chat_list_rooms',
      arguments: {},
    });
    expect(unwrap(list).rooms.length).toBe(1);

    await a.client.close();
    await b.client.close();
  });

  it('chat_join_room 错密码 → INVALID_PASSWORD isError', async () => {
    const { token: aToken } = await registerAndLogin('alice');
    const a = await connectMcp(aToken);
    const c = await a.client.callTool({
      name: 'chat_create_room',
      arguments: { name: 'r', password: 'right1234' },
    });
    const code = unwrap(c).code;
    await a.client.close();

    const { token: bToken } = await registerAndLogin('bob');
    const b = await connectMcp(bToken);
    const r = await b.client.callTool({
      name: 'chat_join_room',
      arguments: { code, password: 'wrongpass' },
    });
    expect(r.isError).toBe(true);
    expect(unwrap(r).error.code).toBe('INVALID_PASSWORD');
    await b.client.close();
  });

  it('chat_leave_room 房主退出 → 房间被自动删除', async () => {
    const { token: aToken } = await registerAndLogin('alice');
    const a = await connectMcp(aToken);
    const created = unwrap(
      await a.client.callTool({
        name: 'chat_create_room',
        arguments: { name: 'r', password: 'right1234' },
      }),
    );
    const leave = await a.client.callTool({
      name: 'chat_leave_room',
      arguments: { room_id: created.room_id },
    });
    expect(unwrap(leave).deleted).toBe(true);
    await a.client.close();
  });
});

describe('mcp: 消息', () => {
  async function setupRoom() {
    const { token: aToken, user: aUser } = await registerAndLogin('alice');
    const a = await connectMcp(aToken);
    const created = unwrap(
      await a.client.callTool({
        name: 'chat_create_room',
        arguments: { name: 'r', password: 'right1234' },
      }),
    );
    const { token: bToken, user: bUser } = await registerAndLogin('bob');
    const b = await connectMcp(bToken);
    await b.client.callTool({
      name: 'chat_join_room',
      arguments: { code: created.code, password: 'right1234' },
    });
    return { a, aUser, b, bUser, roomId: created.room_id };
  }

  it('chat_send → chat_read 拿到消息（升序 + has_more）', async () => {
    const { a, b, roomId } = await setupRoom();
    for (let i = 1; i <= 3; i++) {
      await a.client.callTool({
        name: 'chat_send',
        arguments: { room_id: roomId, content: `m${i}` },
      });
    }
    const read = await b.client.callTool({
      name: 'chat_read',
      arguments: { room_id: roomId, limit: 100 },
    });
    const data = unwrap(read);
    expect(data.messages.map((m) => m.content)).toEqual(['m1', 'm2', 'm3']);
    expect(data.has_more).toBe(false);
    await a.client.close();
    await b.client.close();
  });

  it('chat_send 相同 client_msg_id 幂等', async () => {
    const { a, roomId } = await setupRoom();
    const r1 = unwrap(
      await a.client.callTool({
        name: 'chat_send',
        arguments: { room_id: roomId, content: 'x', client_msg_id: 'cm-1' },
      }),
    );
    const r2 = unwrap(
      await a.client.callTool({
        name: 'chat_send',
        arguments: { room_id: roomId, content: 'x (retry)', client_msg_id: 'cm-1' },
      }),
    );
    expect(r2.message_id).toBe(r1.message_id);
    await a.client.close();
  });

  it('MCP chat_send → 房内 WS 订阅者收到 message 广播', async () => {
    const { a, aUser, b, roomId } = await setupRoom();

    // 用 setupRoom 里 helpers 已登录的 bob 的密码（默认 'password123'）开 WS
    const bobLogin = await request(app())
      .post('/api/login')
      .send({ username: 'bob', password: 'password123' })
      .expect(200);

    const ws = new WebSocket(wsUrl, ['bearer', bobLogin.body.token]);
    const frames = [];
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString('utf8'))));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'subscribe', id: 's1', data: { room_id: roomId } }));

    const waitFor = (type, timeoutMs = 1500) =>
      new Promise((resolve, reject) => {
        const start = Date.now();
        const t = setInterval(() => {
          const f = frames.find((f) => f.type === type);
          if (f) {
            clearInterval(t);
            resolve(f);
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(t);
            reject(new Error(`WS 未收到 ${type}`));
          }
        }, 20);
      });

    await waitFor('subscribe:ack');

    await a.client.callTool({
      name: 'chat_send',
      arguments: { room_id: roomId, content: '来自 MCP 的消息' },
    });

    const got = await waitFor('message');
    expect(got.data.message.content).toBe('来自 MCP 的消息');
    expect(got.data.message.user_id).toBe(aUser.id);

    ws.close();
    await a.client.close();
    await b.client.close();
  });

  it('chat_members 返回 online 状态', async () => {
    const { a, aUser, b, bUser, roomId } = await setupRoom();
    const r = await b.client.callTool({
      name: 'chat_members',
      arguments: { room_id: roomId },
    });
    const data = unwrap(r);
    const alice = data.members.find((m) => m.user_id === aUser.id);
    const bob = data.members.find((m) => m.user_id === bUser.id);
    expect(alice).toBeTruthy();
    expect(bob).toBeTruthy();
    // touch 在 MCP 调用时刷过，应 online
    expect(alice.online).toBe(true);
    expect(bob.online).toBe(true);
    await a.client.close();
    await b.client.close();
  });
});
