import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDb, teardown, registerAndLogin, auth } from './helpers.js';

async function setup() {
  const { token: a, user: aUser } = await registerAndLogin('alice');
  const room = (
    await request(app())
      .post('/api/rooms')
      .set('Authorization', auth(a))
      .send({ name: 'r', password: 'right1234' })
      .expect(201)
  ).body.room;
  const { token: b, user: bUser } = await registerAndLogin('bob');
  await request(app())
    .post('/api/rooms/join')
    .set('Authorization', auth(b))
    .send({ code: room.code, password: 'right1234' })
    .expect(200);
  return { a, aUser, b, bUser, room };
}

describe('messages', () => {
  beforeEach(() => resetDb());
  afterAll(() => teardown());

  it('发消息 + 拉历史', async () => {
    const { a, b, room } = await setup();
    for (let i = 1; i <= 3; i++) {
      await request(app())
        .post(`/api/rooms/${room.id}/messages`)
        .set('Authorization', auth(a))
        .send({ content: `msg ${i}` })
        .expect(201);
    }
    const r = await request(app())
      .get(`/api/rooms/${room.id}/messages`)
      .set('Authorization', auth(b))
      .expect(200);
    expect(r.body.messages.length).toBe(3);
    // 升序：1, 2, 3
    expect(r.body.messages.map((m) => m.content)).toEqual(['msg 1', 'msg 2', 'msg 3']);
    expect(r.body.has_more).toBe(false);
  });

  it('翻页：before_id + has_more', async () => {
    const { a, room } = await setup();
    for (let i = 1; i <= 5; i++) {
      await request(app())
        .post(`/api/rooms/${room.id}/messages`)
        .set('Authorization', auth(a))
        .send({ content: `msg ${i}` })
        .expect(201);
    }
    // 第一页：limit=3
    const page1 = await request(app())
      .get(`/api/rooms/${room.id}/messages?limit=3`)
      .set('Authorization', auth(a))
      .expect(200);
    expect(page1.body.messages.map((m) => m.content)).toEqual(['msg 3', 'msg 4', 'msg 5']);
    expect(page1.body.has_more).toBe(true);

    const oldestId = page1.body.messages[0].id;
    const page2 = await request(app())
      .get(`/api/rooms/${room.id}/messages?limit=3&before_id=${oldestId}`)
      .set('Authorization', auth(a))
      .expect(200);
    expect(page2.body.messages.map((m) => m.content)).toEqual(['msg 1', 'msg 2']);
    expect(page2.body.has_more).toBe(false);
  });

  it('client_msg_id 幂等：同 id 重发只入库一次', async () => {
    const { a, room } = await setup();
    const r1 = await request(app())
      .post(`/api/rooms/${room.id}/messages`)
      .set('Authorization', auth(a))
      .send({ content: 'hi', client_msg_id: 'cm-1' })
      .expect(201);
    const r2 = await request(app())
      .post(`/api/rooms/${room.id}/messages`)
      .set('Authorization', auth(a))
      .send({ content: 'hi (重试)', client_msg_id: 'cm-1' })
      .expect(201);
    expect(r2.body.message.id).toBe(r1.body.message.id);
    expect(r2.body.message.content).toBe('hi');

    const list = await request(app())
      .get(`/api/rooms/${room.id}/messages`)
      .set('Authorization', auth(a))
      .expect(200);
    expect(list.body.messages.length).toBe(1);
  });

  it('非成员发消息 → NOT_MEMBER', async () => {
    const { room } = await setup();
    const { token: c } = await registerAndLogin('carol');
    const r = await request(app())
      .post(`/api/rooms/${room.id}/messages`)
      .set('Authorization', auth(c))
      .send({ content: 'hi' })
      .expect(403);
    expect(r.body.error.code).toBe('NOT_MEMBER');
  });

  it('@username 提及解析', async () => {
    const { a, aUser, b, bUser, room } = await setup();
    const r = await request(app())
      .post(`/api/rooms/${room.id}/messages`)
      .set('Authorization', auth(a))
      .send({ content: '@bob 你好 @alice' })
      .expect(201);
    expect(r.body.message.mentioned_user_ids.sort()).toEqual(
      [aUser.id, bUser.id].sort(),
    );
  });
});
