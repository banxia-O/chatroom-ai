import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// .env 在 backend/ 目录下，从 src/ 往上一级
dotenv.config({ path: resolve(__dirname, '..', '.env') });

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} 必须是数字，得到: ${v}`);
  return n;
}

function str(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

const JWT_SECRET = str('JWT_SECRET', '');
if (!JWT_SECRET || JWT_SECRET.length < 64) {
  throw new Error('JWT_SECRET 必须设置且长度 ≥ 64。生成命令: openssl rand -hex 48');
}

export const config = {
  port: num('PORT', 3000),
  logLevel: str('LOG_LEVEL', 'info'),
  jwt: {
    secret: JWT_SECRET,
    expiresIn: str('JWT_EXPIRES_IN', '7d'),
  },
  db: {
    path: str('DB_PATH', './data/chatroom.db'),
  },
  bcryptRounds: num('BCRYPT_ROUNDS', 12),
  room: {
    defaultMaxMembers: num('DEFAULT_MAX_MEMBERS', 20),
    failThreshold: num('ROOM_FAIL_THRESHOLD', 5),
    lockMinutes: num('ROOM_LOCK_MINUTES', 30),
  },
  cors: {
    origin: str('CORS_ORIGIN', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  rateLimit: {
    loginPerMin: num('RATE_LIMIT_LOGIN_PER_MIN', 5),
    registerPerHour: num('RATE_LIMIT_REGISTER_PER_HOUR', 10),
    sendPer10s: num('RATE_LIMIT_SEND_PER_10S', 10),
  },
  ws: {
    // 服务端心跳超时：> 此值未收到客户端 ping 则 terminate
    heartbeatTimeoutMs: num('WS_HEARTBEAT_TIMEOUT_MS', 60_000),
    path: str('WS_PATH', '/ws'),
  },
  presence: {
    // 最后一个连接断开后，延迟此毫秒数再广播 offline，避免短抖动
    offlineDelayMs: num('PRESENCE_OFFLINE_DELAY_MS', 90_000),
  },
};
