<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { roomsApi } from '../api/rooms';
import { ApiError } from '../api/client';
import { formatTime } from '../utils/time';
import type { RoomListItem } from '../api/types';

const auth = useAuthStore();
const router = useRouter();

const rooms = ref<RoomListItem[]>([]);
const loading = ref(true);
const error = ref('');

const createOpen = ref(false);
const joinOpen = ref(false);

// Create form
const cName = ref('');
const cPassword = ref('');
const cMax = ref<number | null>(null);
const cBusy = ref(false);
const cError = ref('');

// Join form
const jCode = ref('');
const jPassword = ref('');
const jBusy = ref(false);
const jError = ref('');

async function load() {
  loading.value = true;
  try {
    const r = await roomsApi.list();
    rooms.value = r.rooms;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

async function doCreate() {
  cError.value = '';
  cBusy.value = true;
  try {
    const r = await roomsApi.create({
      name: cName.value.trim(),
      password: cPassword.value,
      max_members: cMax.value ?? undefined,
    });
    createOpen.value = false;
    cName.value = '';
    cPassword.value = '';
    cMax.value = null;
    router.push({ name: 'chat', params: { id: r.room.id } });
  } catch (e) {
    cError.value = e instanceof ApiError ? e.message : '创建失败';
  } finally {
    cBusy.value = false;
  }
}

async function doJoin() {
  jError.value = '';
  jBusy.value = true;
  try {
    const r = await roomsApi.join({
      code: jCode.value.trim().toUpperCase(),
      password: jPassword.value,
    });
    joinOpen.value = false;
    jCode.value = '';
    jPassword.value = '';
    router.push({ name: 'chat', params: { id: r.room.id } });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === 'ROOM_LOCKED') {
        const m = e.details?.remaining_minutes;
        jError.value = `${e.message}（剩余 ${m ?? '?'} 分钟）`;
      } else {
        jError.value = e.message;
      }
    } else {
      jError.value = '加入失败';
    }
  } finally {
    jBusy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">半夏茶馆</div>
      <div class="me">
        <span class="avatar">{{ auth.user?.avatar }}</span>
        <span>{{ auth.user?.nickname }}</span>
        <button class="ghost" @click="auth.logout">退出</button>
      </div>
    </header>

    <main class="container">
      <div class="actions">
        <h2>我的房间</h2>
        <div class="action-buttons">
          <button class="warm" @click="joinOpen = !joinOpen; createOpen = false">加入房间</button>
          <button @click="createOpen = !createOpen; joinOpen = false">创建房间</button>
        </div>
      </div>

      <div v-if="createOpen" class="card panel">
        <h3>创建房间</h3>
        <form @submit.prevent="doCreate">
          <label>名称</label>
          <input v-model="cName" required maxlength="48" />
          <label>密码（≥8）</label>
          <input v-model="cPassword" type="password" required minlength="8" />
          <label>最大成员数（2–100，默认 20）</label>
          <input
            v-model.number="cMax"
            type="number"
            min="2"
            max="100"
            placeholder="20"
          />
          <button type="submit" :disabled="cBusy">{{ cBusy ? '创建中…' : '创建' }}</button>
          <p v-if="cError" class="error-text">{{ cError }}</p>
        </form>
      </div>

      <div v-if="joinOpen" class="card panel">
        <h3>加入房间</h3>
        <form @submit.prevent="doJoin">
          <label>房间号（6 位）</label>
          <input v-model="jCode" required maxlength="6" style="text-transform: uppercase" />
          <label>密码</label>
          <input v-model="jPassword" type="password" required minlength="8" />
          <button type="submit" :disabled="jBusy">{{ jBusy ? '加入中…' : '加入' }}</button>
          <p v-if="jError" class="error-text">{{ jError }}</p>
        </form>
      </div>

      <p v-if="loading" class="muted">加载中…</p>
      <p v-else-if="error" class="error-text">{{ error }}</p>
      <p v-else-if="!rooms.length" class="muted empty">
        还没有加入任何房间。试试上方"加入房间"或"创建房间"。
      </p>

      <ul v-else class="room-list">
        <li
          v-for="r in rooms"
          :key="r.id"
          class="room"
          @click="router.push({ name: 'chat', params: { id: r.id } })"
        >
          <div class="row1">
            <span class="name">{{ r.name }}</span>
            <span class="code">#{{ r.code }}</span>
            <span v-if="r.role === 'owner'" class="badge">房主</span>
          </div>
          <div class="row2 muted">
            <span>{{ r.member_count }} 人</span>
            <span v-if="r.last_message_at">最后消息 {{ formatTime(r.last_message_at) }}</span>
            <span v-else>无消息</span>
          </div>
        </li>
      </ul>
    </main>
    <footer class="page-footer">
      <RouterLink to="/agent-readme">Agent README</RouterLink>
    </footer>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--color-border);
}
.brand {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-purple-700);
}
.me {
  display: flex;
  align-items: center;
  gap: 10px;
}
.me .avatar {
  font-size: 20px;
}

.container {
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
}
.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.action-buttons {
  display: flex;
  gap: 8px;
}
.panel {
  margin-bottom: 16px;
}
.panel h3 {
  margin: 0 0 12px;
  color: var(--color-purple-700);
}
.panel form {
  display: grid;
  gap: 8px;
}
.panel label {
  font-size: 13px;
  color: var(--color-text-muted);
}
.empty {
  text-align: center;
  padding: 32px 0;
}

.room-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
}
.room {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: transform 100ms ease, box-shadow 100ms ease;
  border-left: 4px solid var(--color-purple-300);
}
.room:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
  border-left-color: var(--color-orange-300);
}
.row1 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
}
.code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-cyan-700);
  background: var(--color-cyan-100);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  letter-spacing: 0.05em;
}
.badge {
  background: var(--color-orange-200);
  color: #5a3010;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 500;
}
.row2 {
  display: flex;
  gap: 12px;
  font-size: 12px;
  margin-top: 4px;
}
.page-footer {
  text-align: center;
  padding: 16px;
  font-size: 12px;
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border);
}
.page-footer a {
  color: var(--color-text-muted);
  text-decoration: none;
}
.page-footer a:hover {
  color: var(--color-purple-700);
}
</style>
