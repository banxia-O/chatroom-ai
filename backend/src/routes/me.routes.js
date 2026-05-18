import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { updateProfile } from '../services/user.service.js';
import { parseOrThrow, updateMeSchema } from '../utils/validate.js';

export const meRouter = Router();

meRouter.get('/', requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar,
      created_at: u.created_at,
      updated_at: u.updated_at,
    },
  });
});

meRouter.put('/', requireAuth, (req, res, next) => {
  try {
    const body = parseOrThrow(updateMeSchema, req.body);
    const u = updateProfile(req.user.id, body);
    res.json({
      user: {
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        avatar: u.avatar,
        updated_at: u.updated_at,
      },
    });
  } catch (e) {
    next(e);
  }
});
