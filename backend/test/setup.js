import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

// 在 import config 前先注入 env，确保模块加载时拿得到
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.JWT_EXPIRES_IN = '1h';
process.env.BCRYPT_ROUNDS = '4'; // 加速
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
// 缩短 ws 心跳超时 / 离线广播延迟，避免测试空跑
process.env.WS_HEARTBEAT_TIMEOUT_MS = '5000';
process.env.PRESENCE_OFFLINE_DELAY_MS = '80';

// pino 在 LOG_LEVEL=silent 时不走 transport
