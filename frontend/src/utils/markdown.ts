import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

// 给 link 加 rel + target
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const tok = tokens[idx];
  tok.attrSet('rel', 'noopener noreferrer');
  tok.attrSet('target', '_blank');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// @username 包成 span.mention
const MENTION_RE = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,32})\b/g;
function highlightMentions(html: string) {
  return html.replace(MENTION_RE, (_m, prefix, name) => {
    return `${prefix}<span class="mention">@${name}</span>`;
  });
}

export function renderMarkdown(src: string): string {
  const html = md.render(src);
  const withMentions = highlightMentions(html);
  return DOMPurify.sanitize(withMentions, {
    ADD_ATTR: ['target', 'rel'],
  });
}
