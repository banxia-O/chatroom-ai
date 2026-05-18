<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { Member } from '../api/types';

const props = defineProps<{
  members: Member[];
  myId: number;
  sending?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  (e: 'send', content: string): void;
  (e: 'typing', isTyping: boolean): void;
}>();

const text = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);

// ---------- @ autocomplete ----------

interface MentionState {
  open: boolean;
  // 当前 @ token 在 text 中的起止下标 [start, end]，start 指向 @
  start: number;
  end: number;
  query: string;
  index: number;
}

const mention = ref<MentionState>({ open: false, start: -1, end: -1, query: '', index: 0 });

const candidates = computed<Member[]>(() => {
  if (!mention.value.open) return [];
  const q = mention.value.query.toLowerCase();
  // 排除自己；按 username 前缀匹配，无前缀时显示前 10
  const pool = props.members.filter((m) => m.user_id !== props.myId && m.username);
  const matched = q
    ? pool.filter((m) => m.username.toLowerCase().startsWith(q))
    : pool;
  return matched.slice(0, 20);
});

function updateMentionFromCursor() {
  const el = textarea.value;
  if (!el) return;
  const cursor = el.selectionStart ?? 0;
  // 从 cursor 往前扫，找到最近一个 @；中途遇到空白或换行则视为没有
  let i = cursor - 1;
  while (i >= 0) {
    const c = text.value[i];
    if (c === '@') {
      // 校验 @ 前面是行首或空白，避免邮箱被误判
      const prev = i === 0 ? '' : text.value[i - 1];
      if (i === 0 || /\s/.test(prev)) {
        const query = text.value.slice(i + 1, cursor);
        // query 必须只含字母/数字/下划线（username 字符集）
        if (/^[A-Za-z0-9_]*$/.test(query)) {
          mention.value = {
            open: true,
            start: i,
            end: cursor,
            query,
            index: 0,
          };
          return;
        }
      }
      break;
    }
    if (/\s/.test(c)) break;
    i--;
  }
  if (mention.value.open) mention.value.open = false;
}

function pickMention(m: Member) {
  const before = text.value.slice(0, mention.value.start);
  const after = text.value.slice(mention.value.end);
  const replacement = `@${m.username} `;
  text.value = before + replacement + after;
  mention.value.open = false;
  // 把光标移到替换文本之后
  nextTick(() => {
    const el = textarea.value;
    if (!el) return;
    const pos = before.length + replacement.length;
    el.focus();
    el.setSelectionRange(pos, pos);
  });
}

// ---------- typing ----------

const TYPING_THROTTLE_MS = 2500;
const TYPING_STOP_MS = 3000;

let lastTypingTrueAt = 0;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmittedState = false;

function emitTyping(isTyping: boolean) {
  if (lastEmittedState === isTyping) return;
  lastEmittedState = isTyping;
  emit('typing', isTyping);
}

function noteUserActivity() {
  const now = Date.now();
  if (now - lastTypingTrueAt > TYPING_THROTTLE_MS) {
    lastTypingTrueAt = now;
    emitTyping(true);
  }
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    emitTyping(false);
    lastTypingTrueAt = 0;
  }, TYPING_STOP_MS);
}

function cancelTyping() {
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  emitTyping(false);
  lastTypingTrueAt = 0;
}

onBeforeUnmount(cancelTyping);
watch(text, (v) => {
  if (!v.trim()) cancelTyping();
});

// ---------- 事件 ----------

function onInput() {
  noteUserActivity();
  updateMentionFromCursor();
}

function onKeydown(e: KeyboardEvent) {
  // mention 优先：方向键 / Enter / Tab / Esc
  if (mention.value.open && candidates.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mention.value.index = (mention.value.index + 1) % candidates.value.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mention.value.index =
        (mention.value.index - 1 + candidates.value.length) % candidates.value.length;
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickMention(candidates.value[mention.value.index]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      mention.value.open = false;
      return;
    }
  }

  // Enter 发送，Shift+Enter 换行
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
}

function onClick() {
  // mention 打开时不刷新（避免覆盖键盘导航状态）
  if (mention.value.open) return;
  updateMentionFromCursor();
}

function onKeyUp() {
  // mention 打开时只刷新光标位置，不重置 index
  if (mention.value.open) {
    const el = textarea.value;
    if (!el) return;
    const cursor = el.selectionStart ?? 0;
    mention.value.end = cursor;
    const query = text.value.slice(mention.value.start + 1, cursor);
    if (/^[A-Za-z0-9_]*$/.test(query)) {
      mention.value.query = query;
    }
    return;
  }
  updateMentionFromCursor();
}

function submit() {
  const content = text.value.trim();
  if (!content || props.sending) return;
  emit('send', content);
}

watch(
  () => props.sending,
  (now, prev) => {
    // 发送成功（sending: true → false 且 text 已被清）时不做事；
    // 由父组件调用 clear() 来清空（见下）
    if (prev && !now) cancelTyping();
  },
);

defineExpose({
  clear() {
    text.value = '';
    cancelTyping();
    mention.value.open = false;
  },
  focus() {
    textarea.value?.focus();
  },
});
</script>

<template>
  <div class="chat-input">
    <div v-if="mention.open && candidates.length" class="mention-pop">
      <ul>
        <li
          v-for="(m, i) in candidates"
          :key="m.user_id"
          :class="{ on: i === mention.index }"
          @mousedown.prevent="pickMention(m)"
        >
          <span class="avatar">{{ m.avatar }}</span>
          <span class="nick">{{ m.nickname }}</span>
          <span class="uname muted">@{{ m.username }}</span>
        </li>
      </ul>
      <div class="hint muted">↑↓ 选择 · Enter/Tab 确认 · Esc 取消</div>
    </div>

    <form class="bar" @submit.prevent="submit">
      <textarea
        ref="textarea"
        v-model="text"
        :placeholder="placeholder ?? '说点什么…  支持 Markdown，@ 提及成员，Enter 发送，Shift+Enter 换行'"
        rows="2"
        maxlength="4000"
        @input="onInput"
        @keydown="onKeydown"
        @click="onClick"
        @keyup="onKeyUp"
      />
      <button type="submit" :disabled="sending || !text.trim()">
        {{ sending ? '发送中…' : '发送' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.chat-input {
  position: relative;
}
.bar {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 12px 0 16px;
  border-top: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.6);
}
.bar textarea {
  resize: none;
  min-height: 40px;
  max-height: 160px;
}
.bar button {
  height: 40px;
  padding: 0 18px;
  flex-shrink: 0;
}

.mention-pop {
  position: absolute;
  left: 0;
  bottom: 100%;
  margin-bottom: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-purple-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  min-width: 240px;
  max-width: 320px;
  overflow: hidden;
  z-index: 5;
}
.mention-pop ul {
  list-style: none;
  margin: 0;
  padding: 4px;
}
.mention-pop li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.mention-pop li:hover,
.mention-pop li.on {
  background: var(--color-purple-50);
}
.mention-pop li.on {
  background: var(--color-cyan-100);
}
.mention-pop .avatar {
  font-size: 18px;
}
.mention-pop .nick {
  font-weight: 500;
}
.mention-pop .uname {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 12px;
}
.mention-pop .hint {
  border-top: 1px solid var(--color-border);
  padding: 4px 8px;
  font-size: 11px;
}
</style>
