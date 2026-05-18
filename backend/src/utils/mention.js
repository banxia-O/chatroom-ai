// 匹配 @username，username 限定为 [A-Za-z0-9_]+，长度 3-32
const RE = /(^|[\s\W])@([A-Za-z0-9_]{3,32})\b/g;

/**
 * 从消息正文里抽取 @ 提及的 username 列表（去重，保持顺序）。
 * @param {string} content
 * @returns {string[]}
 */
export function extractMentions(content) {
  const set = new Set();
  for (const m of content.matchAll(RE)) {
    set.add(m[2].toLowerCase());
  }
  return [...set];
}
