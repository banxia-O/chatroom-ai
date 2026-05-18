import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDb, teardown, registerAndLogin, auth } from './helpers.js';

describe('auth + me', () => {
  beforeEach(() => resetDb());
  afterAll(() => teardown());

  it('注册→登录→GET /me', async () => {
    const reg = await request(app())
      .post('/api/register')
      .send({ username: 'yubai', password: 'hello1234', nickname: '予白', avatar: '🍵' })
      .expect(201);
    expect(reg.body.token).toBeTypeOf('string');
    expect(reg.body.user.username).toBe('yubai');

    const login = await request(app())
      .post('/api/login')
      .send({ username: 'yubai', password: 'hello1234' })
      .expect(200);
    expect(login.body.token).toBeTypeOf('string');

    const me = await request(app())
      .get('/api/me')
      .set('Authorization', auth(login.body.token))
      .expect(200);
    expect(me.body.user.username).toBe('yubai');
    expect(me.body.user.nickname).toBe('予白');
  });

  it('重复注册返回 USERNAME_TAKEN', async () => {
    await registerAndLogin('alice');
    const r = await request(app())
      .post('/api/register')
      .send({ username: 'alice', password: 'hello1234', nickname: 'a' })
      .expect(409);
    expect(r.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('错密码登录返回 INVALID_CREDENTIALS', async () => {
    await registerAndLogin('bob');
    const r = await request(app())
      .post('/api/login')
      .send({ username: 'bob', password: 'wrongpass' })
      .expect(401);
    expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('PUT /api/me 更新昵称', async () => {
    const { token } = await registerAndLogin('carol');
    const r = await request(app())
      .put('/api/me')
      .set('Authorization', auth(token))
      .send({ nickname: '卡萝' })
      .expect(200);
    expect(r.body.user.nickname).toBe('卡萝');
  });

  it('无 token 访问 /api/me → 401', async () => {
    const r = await request(app()).get('/api/me').expect(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('登录限流：6 次错密码触发 RATE_LIMITED', async () => {
    await registerAndLogin('dave');
    for (let i = 0; i < 5; i++) {
      await request(app())
        .post('/api/login')
        .send({ username: 'dave', password: 'badpasswd' })
        .expect(401);
    }
    const r = await request(app())
      .post('/api/login')
      .send({ username: 'dave', password: 'badpasswd' })
      .expect(429);
    expect(r.body.error.code).toBe('RATE_LIMITED');
  });
});
