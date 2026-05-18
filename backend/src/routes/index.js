import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { meRouter } from './me.routes.js';
import { roomRouter } from './room.routes.js';
import { messageRouter } from './message.routes.js';

export function buildApiRouter() {
  const r = Router();
  r.use('/', authRouter); // /register, /login
  r.use('/me', meRouter);
  r.use('/rooms', roomRouter);
  // 嵌套：/rooms/:roomId/messages
  r.use('/rooms/:roomId(\\d+)/messages', messageRouter);
  return r;
}
