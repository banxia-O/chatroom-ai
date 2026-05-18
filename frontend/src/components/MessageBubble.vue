<script setup lang="ts">
import { computed } from 'vue';
import type { Message } from '../api/types';
import { renderMarkdown } from '../utils/markdown';
import { formatTime } from '../utils/time';

const props = defineProps<{ msg: Message; mine: boolean; mentioned?: boolean }>();

const html = computed(() => renderMarkdown(props.msg.content));
const time = computed(() => formatTime(props.msg.created_at));
</script>

<template>
  <div class="bubble-row" :class="{ mine, mentioned: !mine && mentioned }">
    <div v-if="!mine" class="avatar">{{ msg.avatar }}</div>
    <div class="bubble">
      <div v-if="!mine" class="who">
        <span class="nick">{{ msg.nickname }}</span>
        <span class="time muted">{{ time }}</span>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="md-body" v-html="html" />
      <div v-if="mine" class="time-mine muted">{{ time }}</div>
    </div>
    <div v-if="mine" class="avatar">{{ msg.avatar }}</div>
  </div>
</template>

<style scoped>
.bubble-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin: 4px 0;
}
.bubble-row.mine {
  flex-direction: row-reverse;
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-purple-100);
  display: grid;
  place-items: center;
  font-size: 18px;
  flex-shrink: 0;
}
.mine .avatar {
  background: var(--color-orange-100);
}

.bubble {
  max-width: min(560px, 70%);
  background: var(--color-surface);
  border: 1px solid var(--color-purple-100);
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  word-break: break-word;
}
.mine .bubble {
  background: var(--color-orange-100);
  border-color: var(--color-orange-200);
}
.mentioned .bubble {
  border-color: var(--color-cyan-300);
  background: linear-gradient(180deg, var(--color-cyan-50), var(--color-surface));
}

.who {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
  font-size: 12px;
}
.nick {
  color: var(--color-purple-700);
  font-weight: 500;
}
.time {
  font-size: 11px;
}
.time-mine {
  font-size: 11px;
  text-align: right;
  margin-top: 2px;
}
</style>
