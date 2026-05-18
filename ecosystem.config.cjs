// PM2 配置 — 半夏茶馆后端
//
// 启动：pm2 start ecosystem.config.cjs --env production
// 重启：pm2 reload banxia-backend
// 日志：pm2 logs banxia-backend
// 自启：pm2 startup && pm2 save

module.exports = {
  apps: [
    {
      name: 'banxia-backend',
      script: './backend/src/server.js',
      cwd: __dirname,
      // SQLite + WebSocket hub 都是单实例状态，必须 fork 单进程
      instances: 1,
      exec_mode: 'fork',
      // dotenv 由后端 config.js 自己读 backend/.env
      env_production: {
        NODE_ENV: 'production',
        DOTENV_CONFIG_PATH: './backend/.env',
      },
      // 日志
      out_file: './logs/backend-out.log',
      error_file: './logs/backend-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // 进程管理
      max_memory_restart: '500M',
      autorestart: true,
      watch: false,
      // 优雅退出窗口（让 PM2 给进程 SIGINT，再 5s 后 SIGKILL）
      kill_timeout: 5000,
    },
  ],
};
