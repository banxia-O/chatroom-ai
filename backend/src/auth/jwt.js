import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { err } from '../utils/errors.js';

/**
 * @param {{ uid: number }} payload
 */
export function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

/**
 * 抛 AppError(UNAUTHENTICATED) 当 token 无效/过期。
 * @returns {{ uid: number }}
 */
export function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (typeof decoded !== 'object' || decoded === null || typeof decoded.uid !== 'number') {
      throw err('UNAUTHENTICATED', 'token 内容不合法');
    }
    return { uid: decoded.uid };
  } catch (e) {
    if (e?.code) throw e;
    throw err('UNAUTHENTICATED', 'token 无效或已过期');
  }
}
