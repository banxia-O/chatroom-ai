import bcrypt from 'bcrypt';
import { config } from '../config.js';

export function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
}

export function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
