import { err } from './errors.js';

// 进程内所有 limiter 的集合，供测试时统一清空。
const _allBuckets = new Set();

export function resetAllLimiters() {
  for (const b of _allBuckets) b.clear();
}

/**
 * 进程内滑窗限流器。key → 时间戳列表（升序）。
 *
 * 注：单进程内存方案，足够单 VPS。集群部署时需要换 Redis。
 */
export function createLimiter({ max, windowMs }) {
  /** @type {Map<string, number[]>} */
  const buckets = new Map();
  _allBuckets.add(buckets);

  function hit(key) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const arr = buckets.get(key) ?? [];
    // 去掉过期的
    while (arr.length && arr[0] < cutoff) arr.shift();
    if (arr.length >= max) {
      const oldest = arr[0];
      const retryMs = oldest + windowMs - now;
      return { ok: false, retryMs };
    }
    arr.push(now);
    buckets.set(key, arr);
    return { ok: true, retryMs: 0 };
  }

  function check(key) {
    const r = hit(key);
    if (!r.ok) {
      throw err('RATE_LIMITED', '请求过于频繁，请稍后重试', {
        retry_after_seconds: Math.ceil(r.retryMs / 1000),
      });
    }
  }

  function reset(key) {
    buckets.delete(key);
  }

  return { hit, check, reset };
}

// 定时清理空 bucket（可选；不接也无内存爆炸风险因为活跃 key 有限）
