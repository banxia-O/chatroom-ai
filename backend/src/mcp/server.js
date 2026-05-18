// @ts-check
/**
 * 半夏茶馆 MCP Server。
 *
 * - Streamable HTTP transport
 * - 9 个工具（见 docs/mcp-tools.md）
 * - chat_register / chat_login 允许匿名；其余要求 Bearer
 * - 任何带 Bearer 的调用都刷 last_seen_at（touch 节流由 presence.service 内部完成）
 *
 * 设计：每个请求构造一个 McpServer 实例并把当前 user 绑定到 tool 闭包里。
 * 简单、线程安全、tool 内能直接拿到 user，不依赖 AsyncLocalStorage。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  registerUser,
  authenticate,
  getUserById,
} from '../services/user.service.js';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  listMyRooms,
  getRoomDetail,
} from '../services/room.service.js';
import {
  sendMessage,
  listMessages,
} from '../services/message.service.js';
import {
  emitMemberJoined,
  emitMemberLeft,
  emitRoomDeleted,
  emitRoomUpdated,
  emitMessageCreated,
} from '../ws/broadcaster.js';
import { AppError } from '../utils/errors.js';
import { touch as touchPresence } from '../services/presence.service.js';
import { listMembers } from '../services/membership.service.js';

/**
 * 构建一个绑定到当前用户的 McpServer。
 * @param {{ id:number, username:string, nickname:string, avatar:string } | null} user
 *   null 表示匿名调用（仅 chat_register / chat_login 允许）
 */
export function buildMcpServer(user) {
  const server = new McpServer({
    name: 'banxia-chat',
    version: '0.2.0',
  });

  if (user) {
    try {
      touchPresence(user.id);
    } catch {
      /* ignore */
    }
  }

  // ---- 鉴权类（匿名可用） ----

  server.registerTool(
    'chat_register',
    {
      description: '注册新用户。返回 user_id 与 JWT。',
      inputSchema: {
        username: z.string(),
        password: z.string(),
        nickname: z.string(),
        avatar: z.string().optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user: u, token } = await registerUser(args);
        return { user_id: u.id, token };
      }),
  );

  server.registerTool(
    'chat_login',
    {
      description: '登录并取 JWT。',
      inputSchema: {
        username: z.string(),
        password: z.string(),
      },
    },
    async (args) =>
      run(async () => {
        const { user: u, token } = await authenticate(args);
        return { token, user_id: u.id, nickname: u.nickname };
      }),
  );

  // ---- 房间类（需 Bearer） ----

  server.registerTool(
    'chat_create_room',
    {
      description: '创建房间。',
      inputSchema: {
        name: z.string(),
        password: z.string(),
        max_members: z.number().int().optional(),
      },
    },
    async (args) =>
      run(async () => {
        requireUser(user);
        const room = await createRoom(user.id, args);
        return { room_id: room.id, code: room.code };
      }),
  );

  server.registerTool(
    'chat_join_room',
    {
      description: '通过房间号 + 密码加入房间。错 5 次锁 30 分钟。',
      inputSchema: {
        code: z.string(),
        password: z.string(),
      },
    },
    async (args) =>
      run(async () => {
        requireUser(user);
        const result = await joinRoom(user.id, args);
        if (!result.already_member) {
          emitMemberJoined(result.room.id, {
            id: user.id,
            nickname: user.nickname,
            avatar: user.avatar,
          });
        }
        return {
          room_id: result.room.id,
          name: result.room.name,
          members: result.members,
        };
      }),
  );

  server.registerTool(
    'chat_leave_room',
    {
      description:
        '退出房间。房主退出会自动转让给最早加入的成员；只剩房主则删除房间。',
      inputSchema: { room_id: z.number().int().positive() },
    },
    async (args) =>
      run(async () => {
        requireUser(user);
        const result = leaveRoom(user.id, args.room_id);
        if (result.deleted) {
          emitRoomDeleted(args.room_id);
        } else {
          emitMemberLeft(args.room_id, user.id);
          if (result.transferred_to) emitRoomUpdated(args.room_id, ['owner']);
        }
        return result;
      }),
  );

  server.registerTool(
    'chat_list_rooms',
    {
      description: '列出我加入的所有房间。',
      inputSchema: {},
    },
    async () =>
      run(async () => {
        requireUser(user);
        return { rooms: listMyRooms(user.id) };
      }),
  );

  server.registerTool(
    'chat_members',
    {
      description: '房间成员列表，附 online 状态。',
      inputSchema: { room_id: z.number().int().positive() },
    },
    async (args) =>
      run(async () => {
        requireUser(user);
        const detail = getRoomDetail(user.id, args.room_id);
        return { members: detail.members };
      }),
  );

  // ---- 消息类（需 Bearer） ----

  server.registerTool(
    'chat_send',
    {
      description: '在房间内发送一条消息。client_msg_id 用于幂等。',
      inputSchema: {
        room_id: z.number().int().positive(),
        content: z.string().min(1).max(4000),
        client_msg_id: z.string().max(64).optional(),
      },
    },
    async (args) =>
      run(async () => {
        requireUser(user);
        const { message, idempotent } = sendMessage(user.id, args.room_id, {
          content: args.content,
          client_msg_id: args.client_msg_id,
        });
        if (!idempotent) emitMessageCreated(message);
        return { message_id: message.id, created_at: message.created_at };
      }),
  );

  server.registerTool(
    'chat_read',
    {
      description:
        '读取历史消息。返回按 id 升序（旧→新），附 has_more。游标 before_id 取更早的一段。',
      inputSchema: {
        room_id: z.number().int().positive(),
        limit: z.number().int().min(1).max(200).optional(),
        before_id: z.number().int().positive().optional(),
      },
    },
    async (args) =>
      run(async () => {
        requireUser(user);
        return listMessages(user.id, args.room_id, {
          limit: args.limit ?? 20,
          before_id: args.before_id,
        });
      }),
  );

  return server;
}

/**
 * 标准化工具返回。把业务结果包成 CallToolResult；AppError 转 isError。
 * @param {() => Promise<object> | object} fn
 */
async function run(fn) {
  try {
    const data = await fn();
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (e) {
    if (e instanceof AppError) {
      return {
        content: [{ type: 'text', text: `${e.code}: ${e.message}` }],
        isError: true,
        structuredContent: {
          error: { code: e.code, message: e.message, details: e.details },
        },
      };
    }
    throw e;
  }
}

function requireUser(user) {
  if (!user) {
    throw new AppError('UNAUTHENTICATED', 401, '此工具需要 Bearer Token');
  }
}

