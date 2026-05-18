import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  kickMember,
  deleteRoom,
  updateRoomPassword,
  listMyRooms,
  getRoomDetail,
} from '../services/room.service.js';
import {
  parseOrThrow,
  createRoomSchema,
  joinRoomSchema,
  updatePasswordSchema,
  kickSchema,
} from '../utils/validate.js';

export const roomRouter = Router();

roomRouter.use(requireAuth);

roomRouter.post('/', async (req, res, next) => {
  try {
    const body = parseOrThrow(createRoomSchema, req.body);
    const room = await createRoom(req.user.id, body);
    res.status(201).json({ room });
  } catch (e) {
    next(e);
  }
});

roomRouter.post('/join', async (req, res, next) => {
  try {
    const body = parseOrThrow(joinRoomSchema, req.body);
    const result = await joinRoom(req.user.id, body);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

roomRouter.get('/', (req, res, next) => {
  try {
    res.json({ rooms: listMyRooms(req.user.id) });
  } catch (e) {
    next(e);
  }
});

roomRouter.get('/:id(\\d+)', (req, res, next) => {
  try {
    const roomId = Number(req.params.id);
    res.json(getRoomDetail(req.user.id, roomId));
  } catch (e) {
    next(e);
  }
});

roomRouter.delete('/:id(\\d+)', (req, res, next) => {
  try {
    const roomId = Number(req.params.id);
    res.json(deleteRoom(req.user.id, roomId));
  } catch (e) {
    next(e);
  }
});

roomRouter.patch('/:id(\\d+)/password', async (req, res, next) => {
  try {
    const roomId = Number(req.params.id);
    const { new_password } = parseOrThrow(updatePasswordSchema, req.body);
    res.json(await updateRoomPassword(req.user.id, roomId, new_password));
  } catch (e) {
    next(e);
  }
});

roomRouter.post('/:id(\\d+)/leave', (req, res, next) => {
  try {
    const roomId = Number(req.params.id);
    res.json(leaveRoom(req.user.id, roomId));
  } catch (e) {
    next(e);
  }
});

roomRouter.post('/:id(\\d+)/kick', (req, res, next) => {
  try {
    const roomId = Number(req.params.id);
    const { user_id } = parseOrThrow(kickSchema, req.body);
    res.json(kickMember(req.user.id, roomId, user_id));
  } catch (e) {
    next(e);
  }
});
