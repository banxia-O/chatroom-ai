import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import { buildHttpServer } from '../src/server.js';
import { app, resetDb, teardown, registerAndLogin, auth } from './helpers.js';
import { hub } from '../src/ws/hub.js';
import { config } from '../src/config.js';

let server;
let port;
let baseWsUrl;

beforeAll(async () => {
  server = buildHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  baseWsUrl = `ws://127.0.0.1:${port}${config.ws.path}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  teardown();
});

beforeEach(() => {
  resetDb();
  hub.reset();
});

// ---------- 测试小工具 ----------

/**
 * 打开 ws，等握手成功后 resolve。挂上 frame 缓冲，避免 ready / 早到的广播丢失。
 * @param {string} token
 * @returns {Promise<WebSocket>}
 */
function open(token) {
  const ws = new WebSocket(baseWsUrl, ['bearer', token]);
  ws.__frames = [];
  ws.__waiters = [];
  ws.on('message', (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    // 先尝试唤醒在等的 waiter
    for (let i = 0; i < ws.__waiters.length; i++) {
      const w = ws.__waiters[i];
      if (w.type === frame.type && (!w.predicate || w.predicate(frame))) {
        ws.__waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(frame);
        return;
      }
    }
    ws.__frames.push(frame);
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      reject(new Error(`unexpected-response ${res.statusCode}`));
    });
  });
}

/**
 * 等下一条 type==expected 的帧。先扫缓冲，再注册 waiter。超时 1500ms。
 */
function waitFor(ws, expected, predicate) {
  for (let i = 0; i < ws.__frames.length; i++) {
    const frame = ws.__frames[i];
    if (frame.type === expected && (!predicate || predicate(frame))) {
      ws.__frames.splice(i, 1);
      return Promise.resolve(frame);
    }
  }
  return new Promise((resolve, reject) => {
    const waiter = { type: expected, predicate, resolve };
    waiter.timer = setTimeout(() => {
      const idx = ws.__waiters.indexOf(waiter);
      if (idx >= 0) ws.__waiters.splice(idx, 1);
      reject(new Error(`等待 ${expected} 超时`));
    }, 1500);
    ws.__waiters.push(waiter);
  });
}

/**
 * 收集后续 N 毫秒内的所有帧（用于断言"没有收到 X"）。
 * 注意：collect 期间不与 waitFor 共存——通过临时清空 waiters。
 */
function collect(ws, ms) {
  const collected = [];
  const watcher = (raw) => {
    try {
      collected.push(JSON.parse(raw.toString('utf8')));
    } catch {
      /* ignore */
    }
  };
  ws.on('message', watcher);
  return new Promise((resolve) => {
    setTimeout(() => {
      ws.off('message', watcher);
      resolve(collected);
    }, ms);
  });
}

function send(ws, frame) {
  ws.send(JSON.stringify(frame));
}

async function setupRoom() {
  const { token: aToken, user: aUser } = await registerAndLogin('alice');
  const room = (
    await request(app())
      .post('/api/rooms')
      .set('Authorization', auth(aToken))
      .send({ name: 'r', password: 'right1234' })
      .expect(201)
  ).body.room;
  const { token: bToken, user: bUser } = await registerAndLogin('bob');
  await request(app())
    .post('/api/rooms/join')
    .set('Authorization', auth(bToken))
    .send({ code: room.code, password: 'right1234' })
    .expect(200);
  return { aToken, aUser, bToken, bUser, room };
}

// ---------- 测试用例 ----------

describe('ws: 握手鉴权', () => {
  it('无 token → 401，连接被销毁', async () => {
    const ws = new WebSocket(baseWsUrl);
    const res = await new Promise((resolve) => {
      ws.on('unexpected-response', (_req, r) => resolve(r));
      ws.on('error', () => resolve({ statusCode: -1 }));
    });
    expect(res.statusCode).toBe(401);
  });

  it('错 token → 401', async () => {
    const ws = new WebSocket(baseWsUrl, ['bearer', 'not-a-real-jwt']);
    const res = await new Promise((resolve) => {
      ws.on('unexpected-response', (_req, r) => resolve(r));
      ws.on('error', () => resolve({ statusCode: -1 }));
    });
    expect(res.statusCode).toBe(401);
  });

  it('正确 token → ready 帧带 user_id', async () => {
    const { aToken, aUser } = await setupRoom();
    const ws = await open(aToken);
    const ready = await waitFor(ws, 'ready');
    expect(ready.data.user_id).toBe(aUser.id);
    expect(typeof ready.data.server_time).toBe('number');
    ws.close();
  });
});

describe('ws: subscribe', () => {
  it('成员订阅 → ack 含 online_user_ids', async () => {
    const { aToken, aUser, bToken, bUser, room } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    const b = await open(bToken);
    await waitFor(b, 'ready');

    send(b, { type: 'subscribe', id: 's1', data: { room_id: room.id } });
    const ack = await waitFor(b, 'subscribe:ack');
    expect(ack.id).toBe('s1');
    expect(ack.data.room_id).toBe(room.id);
    expect(new Set(ack.data.online_user_ids)).toEqual(new Set([aUser.id, bUser.id]));

    a.close();
    b.close();
  });

  it('非成员订阅 → subscribe:error NOT_MEMBER', async () => {
    const { room } = await setupRoom();
    const { token: cToken } = await registerAndLogin('carol');
    const c = await open(cToken);
    await waitFor(c, 'ready');
    send(c, { type: 'subscribe', id: 'x', data: { room_id: room.id } });
    const err = await waitFor(c, 'subscribe:error');
    expect(err.id).toBe('x');
    expect(err.data.code).toBe('NOT_MEMBER');
    c.close();
  });
});

describe('ws: send + 广播', () => {
  it('alice 发送 → bob 收到 message 广播', async () => {
    const { aToken, bToken, room } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    const b = await open(bToken);
    await waitFor(b, 'ready');

    send(a, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(a, 'subscribe:ack');
    send(b, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(b, 'subscribe:ack');

    send(a, {
      type: 'send',
      id: 'm1',
      data: { room_id: room.id, content: '你好', client_msg_id: 'cm-1' },
    });
    const ack = await waitFor(a, 'send:ack');
    expect(ack.data.client_msg_id).toBe('cm-1');
    expect(typeof ack.data.message_id).toBe('number');

    const msg = await waitFor(b, 'message');
    expect(msg.data.room_id).toBe(room.id);
    expect(msg.data.message.content).toBe('你好');

    a.close();
    b.close();
  });

  it('同 client_msg_id 重发：ack 收两次，message 广播只一次', async () => {
    const { aToken, bToken, room } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    const b = await open(bToken);
    await waitFor(b, 'ready');
    send(b, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(b, 'subscribe:ack');

    const payload = {
      type: 'send',
      data: { room_id: room.id, content: 'hi', client_msg_id: 'cm-dup' },
    };
    send(a, { ...payload, id: 'r1' });
    const ack1 = await waitFor(a, 'send:ack');
    const msg1 = await waitFor(b, 'message');

    send(a, { ...payload, id: 'r2' });
    const ack2 = await waitFor(a, 'send:ack');
    expect(ack2.data.message_id).toBe(ack1.data.message_id);

    // 重发后 200ms 内 bob 不应再收到 message 帧
    const tail = await collect(b, 200);
    expect(tail.filter((f) => f.type === 'message').length).toBe(0);
    expect(msg1.data.message.id).toBe(ack1.data.message_id);

    a.close();
    b.close();
  });

  it('非成员 send → send:error NOT_MEMBER（不入库 / 不广播）', async () => {
    const { aToken, room } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    send(a, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(a, 'subscribe:ack');

    const { token: cToken } = await registerAndLogin('carol');
    const c = await open(cToken);
    await waitFor(c, 'ready');
    send(c, {
      type: 'send',
      id: 'x',
      data: { room_id: room.id, content: 'spam', client_msg_id: 'cm-x' },
    });
    const err = await waitFor(c, 'send:error');
    expect(err.data.code).toBe('NOT_MEMBER');

    // alice 不应收到 spam
    const tail = await collect(a, 200);
    expect(tail.filter((f) => f.type === 'message').length).toBe(0);

    a.close();
    c.close();
  });
});

describe('ws: 成员事件广播', () => {
  it('REST join → 房内订阅者收到 member_joined', async () => {
    const { aToken, room } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    send(a, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(a, 'subscribe:ack');

    const { token: cToken, user: cUser } = await registerAndLogin('carol');
    await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(cToken))
      .send({ code: room.code, password: 'right1234' })
      .expect(200);

    const ev = await waitFor(a, 'member_joined');
    expect(ev.data.room_id).toBe(room.id);
    expect(ev.data.user.id).toBe(cUser.id);
    expect(ev.data.user.nickname).toBe('carol');

    a.close();
  });

  it('REST leave → 房内订阅者收到 member_left', async () => {
    const { aToken, bToken, bUser, room } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    send(a, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(a, 'subscribe:ack');

    await request(app())
      .post(`/api/rooms/${room.id}/leave`)
      .set('Authorization', auth(bToken))
      .expect(200);

    const ev = await waitFor(a, 'member_left');
    expect(ev.data.room_id).toBe(room.id);
    expect(ev.data.user_id).toBe(bUser.id);

    a.close();
  });

  it('REST kick → 房内 + 被踢者本人都收到 member_kicked', async () => {
    const { aToken, aUser, bToken, bUser, room } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    send(a, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(a, 'subscribe:ack');
    const b = await open(bToken);
    await waitFor(b, 'ready');
    send(b, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(b, 'subscribe:ack');

    await request(app())
      .post(`/api/rooms/${room.id}/kick`)
      .set('Authorization', auth(aToken))
      .send({ user_id: bUser.id })
      .expect(200);

    const ev = await waitFor(b, 'member_kicked');
    expect(ev.data.user_id).toBe(bUser.id);
    expect(ev.data.by).toBe(aUser.id);

    a.close();
    b.close();
  });
});

describe('ws: presence', () => {
  it('alice 断开 → bob 在 offline 延迟后收到 presence offline', async () => {
    const { aToken, aUser, bToken, room } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    const b = await open(bToken);
    await waitFor(b, 'ready');

    send(a, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(a, 'subscribe:ack');
    send(b, { type: 'subscribe', data: { room_id: room.id } });
    // bob subscribe 时，alice 已在 → bob 不会收到 alice 的 presence:true（不是首次）
    await waitFor(b, 'subscribe:ack');

    a.close();
    // 等离线广播（80ms 延迟 + buffer）
    const ev = await waitFor(b, 'presence');
    expect(ev.data.user_id).toBe(aUser.id);
    expect(ev.data.online).toBe(false);

    b.close();
  });

  it('bob 后到 → 订阅时收到 alice 已在的 online_user_ids；alice 离开后短窗内重连不广播 offline', async () => {
    const { aToken, aUser, bToken, room } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    send(a, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(a, 'subscribe:ack');

    const b = await open(bToken);
    await waitFor(b, 'ready');
    send(b, { type: 'subscribe', data: { room_id: room.id } });
    const ack = await waitFor(b, 'subscribe:ack');
    expect(ack.data.online_user_ids).toContain(aUser.id);

    // alice 立刻断开 + 立刻重连 → 80ms 内重新建立 → 不应广播 offline
    a.close();
    const a2 = await open(aToken);
    await waitFor(a2, 'ready');
    send(a2, { type: 'subscribe', data: { room_id: room.id } });
    await waitFor(a2, 'subscribe:ack');

    const tail = await collect(b, 200);
    expect(tail.filter((f) => f.type === 'presence' && f.data.online === false).length).toBe(0);

    a2.close();
    b.close();
  });
});

describe('ws: ping-pong', () => {
  it('ping → pong', async () => {
    const { aToken } = await setupRoom();
    const a = await open(aToken);
    await waitFor(a, 'ready');
    send(a, { type: 'ping', data: {} });
    const pong = await waitFor(a, 'pong');
    expect(typeof pong.data.server_time).toBe('number');
    a.close();
  });
});
