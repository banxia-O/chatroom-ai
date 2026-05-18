import 'dotenv/config';

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
};
