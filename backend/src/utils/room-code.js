import crypto from 'node:crypto';

// 去歧义字符：0/O、1/I/L
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * 重试生成直到 isUnique(code) 为 true。
 * @param {(code: string) => boolean} isUnique
 * @param {number} [maxRetries=5]
 */
export function generateUniqueRoomCode(isUnique, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateRoomCode();
    if (isUnique(code)) return code;
  }
  throw new Error('生成房间号冲突过多，请重试');
}
