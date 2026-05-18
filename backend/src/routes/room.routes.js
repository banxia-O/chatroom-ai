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
import {
  emitMemberJoined,
  emitMemberLeft,
  emitMemberKicked,
  emitRoomDeleted,
  emitRoomUpdated,
} from '../ws/broadcaster.js';

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
    if (!result.already_member) {
      emitMemberJoined(result.room.id, {
        id: req.user.id,
        nickname: req.user.nickname,
        avatar: req.user.avatar,
      });
    }
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
    const result = deleteRoom(req.user.id, roomId);
    emitRoomDeleted(roomId);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

roomRouter.patch('/:id(\\d+)/password', async (req, res, next) => {
  try {
    const roomId = Number(req.params.id);
    const { new_password } = parseOrThrow(updatePasswordSchema, req.body);
    const result = await updateRoomPassword(req.user.id, roomId, new_password);
    emitRoomUpdated(roomId, ['password']);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

roomRouter.post('/:id(\\d+)/leave', (req, res, next) => {
  try {
    const roomId = Number(req.params.id);
    const result = leaveRoom(req.user.id, roomId);
    if (result.deleted) {
      emitRoomDeleted(roomId);
    } else {
      emitMemberLeft(roomId, req.user.id);
      if (result.transferred_to) {
        emitRoomUpdated(roomId, ['owner']);
      }
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
});

roomRouter.post('/:id(\\d+)/kick', (req, res, next) => {
  try {
    const roomId = Number(req.params.id);
    const { user_id } = parseOrThrow(kickSchema, req.body);
    const result = kickMember(req.user.id, roomId, user_id);
    emitMemberKicked(roomId, user_id, req.user.id);
    res.json(result);
  } catch (e) {
    next(e);
  }
});
