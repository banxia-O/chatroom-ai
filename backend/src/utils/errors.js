export class AppError extends Error {
  /**
   * @param {string} code
   * @param {number} status
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, status, message, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const codeToStatus = {
  INVALID_INPUT: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  ROOM_BANNED: 403,
  NOT_OWNER: 403,
  NOT_MEMBER: 403,
  ROOM_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  ROOM_FULL: 409,
  ALREADY_MEMBER: 409,
  INVALID_PASSWORD: 422,
  ROOM_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function err(code, message, details) {
  const status = codeToStatus[code] ?? 500;
  return new AppError(code, status, message, details);
}

/**
 * Express 全局错误处理。
 * 注意：参数必须是 4 个，否则 express 不当成 error middleware。
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(logger) {
  return (e, req, res, _next) => {
    if (e instanceof AppError) {
      return res.status(e.status).json({
        error: { code: e.code, message: e.message, details: e.details },
      });
    }
    // zod 错误
    if (e?.name === 'ZodError') {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: '请求参数不合法',
          details: { issues: e.issues },
        },
      });
    }
    logger.error({ err: e, url: req.url }, '未捕获异常');
    return res.status(500).json({
      error: { code: 'INTERNAL', message: '服务器内部错误' },
    });
  };
}
