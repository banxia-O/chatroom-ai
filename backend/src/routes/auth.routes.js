import { Router } from 'express';
import { registerUser, authenticate } from '../services/user.service.js';
import {
  registerSchema,
  loginSchema,
  parseOrThrow,
} from '../utils/validate.js';
import { createLimiter } from '../utils/rate-limit.js';
import { config } from '../config.js';

const registerLimiter = createLimiter({
  max: config.rateLimit.registerPerHour,
  windowMs: 60 * 60_000,
});
const loginLimiter = createLimiter({
  max: config.rateLimit.loginPerMin,
  windowMs: 60_000,
});

export const authRouter = Router();

authRouter.post('/register', async (req, res, next) => {
  try {
    registerLimiter.check(`ip:${req.ip}`);
    const body = parseOrThrow(registerSchema, req.body);
    const { user, token } = await registerUser(body);
    res.status(201).json({ user_id: user.id, token, user: shapeUser(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = parseOrThrow(loginSchema, req.body);
    loginLimiter.check(`ip:${req.ip}|u:${body.username.toLowerCase()}`);
    const { user, token } = await authenticate(body);
    // 登录成功，清掉该 username 维度的限流
    loginLimiter.reset(`ip:${req.ip}|u:${body.username.toLowerCase()}`);
    res.json({ token, user: shapeUser(user) });
  } catch (e) {
    next(e);
  }
});

function shapeUser(u) {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: u.avatar,
    created_at: u.created_at,
  };
}
