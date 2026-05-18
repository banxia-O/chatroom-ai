/**
 * 把后端时间字符串（SQLite "YYYY-MM-DD HH:MM:SS" 或 ISO）转 Date。
 * SQLite 默认 UTC，但没带 Z；这里统一当 UTC 处理。
 */
export function parseServerTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  // 已是 ISO 带 Z
  if (s.endsWith('Z') || /[+-]\d\d:\d\d$/.test(s)) return new Date(s);
  // "2026-05-18 09:30:00" → "2026-05-18T09:30:00Z"
  const iso = s.replace(' ', 'T') + 'Z';
  return new Date(iso);
}

export function formatTime(s: string | null | undefined): string {
  const d = parseServerTime(s);
  if (!d) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
