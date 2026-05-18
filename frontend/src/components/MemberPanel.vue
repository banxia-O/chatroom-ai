<script setup lang="ts">
import { ref } from 'vue';
import type { Member } from '../api/types';

const props = defineProps<{
  members: Member[];
  myRole: 'owner' | 'member' | null;
  myId: number;
  // 移动端用：是否以 drawer 形式显示
  open: boolean;
  isMobile: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'kick', userId: number): void;
}>();

const confirmingKick = ref<number | null>(null);

function startKick(userId: number) {
  confirmingKick.value = userId;
}
function cancelKick() {
  confirmingKick.value = null;
}
function confirmKick(userId: number) {
  emit('kick', userId);
  confirmingKick.value = null;
}
</script>

<template>
  <div
    v-if="isMobile && open"
    class="overlay"
    @click="emit('close')"
  />
  <aside
    class="panel"
    :class="{ drawer: isMobile, open: !isMobile || open }"
  >
    <header class="head">
      <h3>成员（{{ members.length }}）</h3>
      <button v-if="isMobile" class="ghost close-btn" @click="emit('close')">关闭</button>
    </header>
    <ul>
      <li v-for="m in members" :key="m.user_id">
        <span class="avatar">{{ m.avatar }}</span>
        <div class="meta">
          <div class="nick-row">
            <span class="nick">{{ m.nickname }}</span>
            <span v-if="m.role === 'owner'" class="badge">房主</span>
            <span v-if="m.user_id === myId" class="me-tag">（我）</span>
          </div>
          <div v-if="m.username" class="uname muted">@{{ m.username }}</div>
        </div>
        <span class="online-dot" :class="{ on: m.online }" :title="m.online ? '在线' : '离线'" />
        <template v-if="myRole === 'owner' && m.user_id !== myId">
          <button
            v-if="confirmingKick !== m.user_id"
            class="ghost kick-btn"
            @click="startKick(m.user_id)"
            title="踢出"
          >踢</button>
          <span v-else class="confirm">
            <button class="danger" @click="confirmKick(m.user_id)">确认</button>
            <button class="ghost" @click="cancelKick">取消</button>
          </span>
        </template>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.panel {
  width: 260px;
  border-left: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.7);
  padding: 16px;
  overflow-y: auto;
  flex-shrink: 0;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.head h3 {
  margin: 0;
  color: var(--color-purple-700);
}
.close-btn {
  padding: 4px 10px;
  font-size: 13px;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  border-radius: var(--radius-sm);
}
li:hover {
  background: var(--color-purple-50);
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
.meta {
  flex: 1;
  min-width: 0;
}
.nick-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nick {
  font-weight: 500;
}
.badge {
  background: var(--color-orange-200);
  color: #5a3010;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}
.me-tag {
  font-size: 11px;
  color: var(--color-text-muted);
}
.uname {
  font-family: var(--font-mono);
  font-size: 11px;
}
.online-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
  opacity: 0.5;
}
.online-dot.on {
  background: #6bbf7a;
  opacity: 1;
  box-shadow: 0 0 0 3px rgba(107, 191, 122, 0.18);
}
.kick-btn {
  padding: 2px 8px;
  font-size: 12px;
}
.confirm {
  display: flex;
  gap: 4px;
}
.confirm button {
  padding: 2px 8px;
  font-size: 12px;
}

/* 移动端抽屉 */
.panel.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(320px, 86vw);
  transform: translateX(100%);
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
  box-shadow: var(--shadow-lg);
  z-index: 30;
  background: var(--color-surface);
}
.panel.drawer.open {
  transform: translateX(0);
}
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(40, 30, 60, 0.35);
  z-index: 25;
  animation: fadeIn 200ms ease;
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
}
</style>
