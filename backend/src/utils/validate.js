import { z } from 'zod';

export const usernameSchema = z
  .string()
  .min(3, '用户名至少 3 字符')
  .max(32, '用户名至多 32 字符')
  .regex(/^[A-Za-z0-9_]+$/, '用户名只能包含字母、数字、下划线');

export const passwordSchema = z
  .string()
  .min(8, '密码至少 8 字符')
  .max(128, '密码至多 128 字符');

export const nicknameSchema = z.string().min(1).max(24);

// emoji 或 https URL
export const avatarSchema = z
  .string()
  .max(256)
  .refine(
    (v) =>
      v.startsWith('https://') ||
      // 简单允许任何非 https 短串作为 emoji；详细 emoji 校验放前端
      v.length <= 8,
    '头像必须是 emoji 或 https URL',
  );

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  nickname: nicknameSchema,
  avatar: avatarSchema.optional(),
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const updateMeSchema = z
  .object({
    nickname: nicknameSchema.optional(),
    avatar: avatarSchema.optional(),
  })
  .refine((d) => d.nickname !== undefined || d.avatar !== undefined, {
    message: 'nickname 与 avatar 至少传一个',
  });

export const createRoomSchema = z.object({
  name: z.string().min(1).max(48),
  password: passwordSchema,
  max_members: z.number().int().min(2).max(100).optional(),
});

export const joinRoomSchema = z.object({
  code: z.string().length(6),
  password: passwordSchema,
});

export const updatePasswordSchema = z.object({
  new_password: passwordSchema,
});

export const kickSchema = z.object({
  user_id: z.number().int().positive(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  client_msg_id: z.string().max(64).optional(),
});

export const listMessagesQuerySchema = z.object({
  before_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * 把 zod 错误转成 AppError 风格 issues。
 */
export function parseOrThrow(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw r.error;
  return r.data;
}
