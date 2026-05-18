import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDb, teardown, registerAndLogin, auth } from './helpers.js';

async function createRoom(token, overrides = {}) {
  const r = await request(app())
    .post('/api/rooms')
    .set('Authorization', auth(token))
    .send({
      name: overrides.name ?? '半夏茶馆',
      password: overrides.password ?? 'roomsecret',
      max_members: overrides.max_members,
    })
    .expect(201);
  return r.body.room;
}

describe('rooms', () => {
  beforeEach(() => resetDb());
  afterAll(() => teardown());

  it('创建房间，code 为 6 位', async () => {
    const { token } = await registerAndLogin('alice');
    const room = await createRoom(token);
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(room.owner_id).toBe((await me(token)).id);
  });

  it('加入房间：错密码 5 次锁定 30 分钟', async () => {
    const { token: aToken } = await registerAndLogin('alice');
    const room = await createRoom(aToken, { password: 'correct1' });

    const { token: bToken } = await registerAndLogin('bob');
    for (let i = 0; i < 4; i++) {
      const r = await request(app())
        .post('/api/rooms/join')
        .set('Authorization', auth(bToken))
        .send({ code: room.code, password: 'wrong1234' })
        .expect(422);
      expect(r.body.error.code).toBe('INVALID_PASSWORD');
    }
    // 第 5 次：触发锁定
    const r5 = await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(bToken))
      .send({ code: room.code, password: 'wrong1234' })
      .expect(423);
    expect(r5.body.error.code).toBe('ROOM_LOCKED');

    // 锁定期内即使密码对也应该被拒
    const r6 = await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(bToken))
      .send({ code: room.code, password: 'correct1' })
      .expect(423);
    expect(r6.body.error.code).toBe('ROOM_LOCKED');
  });

  it('正确密码加入 + 计数清零', async () => {
    const { token: aToken } = await registerAndLogin('alice');
    const room = await createRoom(aToken, { password: 'right1234' });
    const { token: bToken, user: bUser } = await registerAndLogin('bob');

    // 错 4 次
    for (let i = 0; i < 4; i++) {
      await request(app())
        .post('/api/rooms/join')
        .set('Authorization', auth(bToken))
        .send({ code: room.code, password: 'wrong1234' })
        .expect(422);
    }
    // 第 5 次正确
    const r = await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(bToken))
      .send({ code: room.code, password: 'right1234' })
      .expect(200);
    expect(r.body.members.map((m) => m.user_id)).toContain(bUser.id);
  });

  it('房间满拒绝加入', async () => {
    const { token: aToken } = await registerAndLogin('alice');
    const room = await createRoom(aToken, { password: 'right1234', max_members: 2 });
    const { token: bToken } = await registerAndLogin('bob');
    const { token: cToken } = await registerAndLogin('carol');

    await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(bToken))
      .send({ code: room.code, password: 'right1234' })
      .expect(200);

    const r = await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(cToken))
      .send({ code: room.code, password: 'right1234' })
      .expect(409);
    expect(r.body.error.code).toBe('ROOM_FULL');
  });

  it('GET /api/rooms 只看到自己加入的房间', async () => {
    const { token: a } = await registerAndLogin('alice');
    const { token: b } = await registerAndLogin('bob');
    await createRoom(a);
    await createRoom(b, { name: 'bob 的房间' });
    const r = await request(app())
      .get('/api/rooms')
      .set('Authorization', auth(a))
      .expect(200);
    expect(r.body.rooms.length).toBe(1);
    expect(r.body.rooms[0].name).toBe('半夏茶馆');
  });

  it('改密码：仅房主，新密码生效', async () => {
    const { token: a } = await registerAndLogin('alice');
    const room = await createRoom(a, { password: 'old12345' });

    // 非成员改密码 → 403
    const { token: b } = await registerAndLogin('bob');
    const r1 = await request(app())
      .patch(`/api/rooms/${room.id}/password`)
      .set('Authorization', auth(b))
      .send({ new_password: 'new12345' })
      .expect(403);
    expect(r1.body.error.code).toBe('NOT_OWNER');

    await request(app())
      .patch(`/api/rooms/${room.id}/password`)
      .set('Authorization', auth(a))
      .send({ new_password: 'new12345' })
      .expect(200);

    await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(b))
      .send({ code: room.code, password: 'old12345' })
      .expect(422);
    await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(b))
      .send({ code: room.code, password: 'new12345' })
      .expect(200);
  });

  it('踢人 + 黑名单：被踢后不能重新加入', async () => {
    const { token: a } = await registerAndLogin('alice');
    const room = await createRoom(a, { password: 'right1234' });
    const { token: b, user: bUser } = await registerAndLogin('bob');
    await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(b))
      .send({ code: room.code, password: 'right1234' })
      .expect(200);

    await request(app())
      .post(`/api/rooms/${room.id}/kick`)
      .set('Authorization', auth(a))
      .send({ user_id: bUser.id })
      .expect(200);

    const r = await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(b))
      .send({ code: room.code, password: 'right1234' })
      .expect(403);
    expect(r.body.error.code).toBe('ROOM_BANNED');
  });

  it('房主退出：房间还有人 → 自动转让给最早加入的成员', async () => {
    const { token: a, user: aUser } = await registerAndLogin('alice');
    const room = await createRoom(a, { password: 'right1234' });
    const { token: b, user: bUser } = await registerAndLogin('bob');
    const { token: c } = await registerAndLogin('carol');
    await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(b))
      .send({ code: room.code, password: 'right1234' })
      .expect(200);
    await request(app())
      .post('/api/rooms/join')
      .set('Authorization', auth(c))
      .send({ code: room.code, password: 'right1234' })
      .expect(200);

    const r = await request(app())
      .post(`/api/rooms/${room.id}/leave`)
      .set('Authorization', auth(a))
      .expect(200);
    expect(r.body.transferred_to).toBe(bUser.id);

    const detail = await request(app())
      .get(`/api/rooms/${room.id}`)
      .set('Authorization', auth(b))
      .expect(200);
    expect(detail.body.room.owner_id).toBe(bUser.id);
    expect(detail.body.members.find((m) => m.user_id === aUser.id)).toBeUndefined();
  });

  it('房主退出：只剩房主 → 房间自动删除', async () => {
    const { token: a } = await registerAndLogin('alice');
    const room = await createRoom(a, { password: 'right1234' });
    const r = await request(app())
      .post(`/api/rooms/${room.id}/leave`)
      .set('Authorization', auth(a))
      .expect(200);
    expect(r.body.deleted).toBe(true);

    await request(app())
      .get(`/api/rooms/${room.id}`)
      .set('Authorization', auth(a))
      .expect(404);
  });

  it('房主删除房间', async () => {
    const { token: a } = await registerAndLogin('alice');
    const room = await createRoom(a, { password: 'right1234' });
    await request(app())
      .delete(`/api/rooms/${room.id}`)
      .set('Authorization', auth(a))
      .expect(200);
    await request(app())
      .get(`/api/rooms/${room.id}`)
      .set('Authorization', auth(a))
      .expect(404);
  });
});

async function me(token) {
  const r = await request(app())
    .get('/api/me')
    .set('Authorization', auth(token))
    .expect(200);
  return r.body.user;
}
