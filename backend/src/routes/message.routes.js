import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  sendMessage,
  listMessages,
} from '../services/message.service.js';
import {
  parseOrThrow,
  sendMessageSchema,
  listMessagesQuerySchema,
} from '../utils/validate.js';
import { createLimiter } from '../utils/rate-limit.js';
import { config } from '../config.js';

const sendLimiter = createLimiter({
  max: config.rateLimit.sendPer10s,
  windowMs: 10_000,
});

export const messageRouter = Router({ mergeParams: true });

messageRouter.use(requireAuth);

messageRouter.get('/', (req, res, next) => {
  try {
    const roomId = Number(req.params.roomId);
    const query = parseOrThrow(listMessagesQuerySchema, req.query);
    res.json(
      listMessages(req.user.id, roomId, {
        before_id: query.before_id,
        limit: query.limit ?? 100,
      }),
    );
  } catch (e) {
    next(e);
  }
});

messageRouter.post('/', (req, res, next) => {
  try {
    sendLimiter.check(`uid:${req.user.id}`);
    const roomId = Number(req.params.roomId);
    const body = parseOrThrow(sendMessageSchema, req.body);
    const { message } = sendMessage(req.user.id, roomId, body);
    // 注：广播在 M2 接 WS 时再触发
    res.status(201).json({ message });
  } catch (e) {
    next(e);
  }
});
