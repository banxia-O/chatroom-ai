<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { roomsApi } from '../api/rooms';
import { messagesApi } from '../api/messages';
import { getWsClient, genClientMsgId } from '../ws/client';
import { ApiError } from '../api/client';
import MessageBubble from '../components/MessageBubble.vue';
import type { Message, RoomDetail } from '../api/types';

const props = defineProps<{ id: string }>();
const auth = useAuthStore();
const router = useRouter();

const roomId = computed(() => Number(props.id));
const detail = ref<RoomDetail | null>(null);
const messages = ref<Message[]>([]);
const seenMessageIds = new Set<number>();
const hasMore = ref(false);
const loadingHistory = ref(false);
const sending = ref(false);
const wsState = ref<'connecting' | 'connected' | 'disconnected'>('disconnected');
const showMembers = ref(false);
const error = ref('');
const input = ref('');
const scroller = ref<HTMLElement | null>(null);
const cleanups: Array<() => void> = [];

const myId = computed(() => auth.user?.id ?? -1);
const onlineCount = computed(
  () => detail.value?.members.filter((m) => m.online).length ?? 0,
);

function pushMessage(m: Message) {
  if (seenMessageIds.has(m.id)) return;
  seenMessageIds.add(m.id);
  // 按 id 升序插入（一般是末尾追加）
  if (!messages.value.length || messages.value[messages.value.length - 1].id < m.id) {
    messages.value.push(m);
    nextTick(() => scrollToBottom('smooth'));
  } else {
    const idx = messages.value.findIndex((x) => x.id > m.id);
    if (idx < 0) messages.value.push(m);
    else messages.value.splice(idx, 0, m);
  }
}

function scrollToBottom(behavior: ScrollBehavior = 'auto') {
  const el = scroller.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior });
}

async function loadDetail() {
  try {
    detail.value = await roomsApi.detail(roomId.value);
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'NOT_MEMBER' || e.code === 'ROOM_NOT_FOUND')) {
      router.replace('/rooms');
      return;
    }
    error.value = e instanceof ApiError ? e.message : '加载失败';
  }
}

async function loadInitialHistory() {
  loadingHistory.value = true;
  try {
    const r = await messagesApi.list(roomId.value, { limit: 50 });
    for (const m of r.messages) {
      seenMessageIds.add(m.id);
    }
    messages.value = r.messages;
    hasMore.value = r.has_more;
    await nextTick();
    scrollToBottom();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载历史失败';
  } finally {
    loadingHistory.value = false;
  }
}

async function loadMoreHistory() {
  if (loadingHistory.value || !hasMore.value || !messages.value.length) return;
  loadingHistory.value = true;
  const el = scroller.value;
  const prevHeight = el?.scrollHeight ?? 0;
  try {
    const beforeId = messages.value[0].id;
    const r = await messagesApi.list(roomId.value, { limit: 50, before_id: beforeId });
    for (const m of r.messages) seenMessageIds.add(m.id);
    messages.value = [...r.messages, ...messages.value];
    hasMore.value = r.has_more;
    await nextTick();
    // 维持滚动位置
    if (el) el.scrollTop = el.scrollHeight - prevHeight;
  } catch {
    /* 忽略 */
  } finally {
    loadingHistory.value = false;
  }
}

async function send() {
  const content = input.value.trim();
  if (!content || sending.value) return;
  sending.value = true;
  const clientMsgId = genClientMsgId();
  try {
    const ws = getWsClient(() => auth.token);
    if (ws.ready) {
      await ws.sendMessage(roomId.value, content, clientMsgId);
    } else {
      // WS 未就绪走 REST 兜底
      const r = await messagesApi.send(roomId.value, { content, client_msg_id: clientMsgId });
      pushMessage(r.message);
    }
    input.value = '';
  } catch (e: any) {
    error.value = e?.message ?? '发送失败';
  } finally {
    sending.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  // Enter 发送，Shift+Enter 换行
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

async function leaveRoom() {
  if (!confirm('确定退出这个房间？')) return;
  try {
    await roomsApi.leave(roomId.value);
  } finally {
    router.replace('/rooms');
  }
}

function setupWs() {
  const ws = getWsClient(() => auth.token);

  cleanups.push(
    ws.on('ready', () => {
      wsState.value = 'connected';
    }),
  );
  cleanups.push(
    ws.on('disconnected', () => {
      wsState.value = 'disconnected';
    }),
  );
  cleanups.push(
    ws.on('message', (data: { room_id: number; message: Message }) => {
      if (data.room_id !== roomId.value) return;
      pushMessage(data.message);
    }),
  );
  cleanups.push(
    ws.on('member_joined', (data: { room_id: number; user: { id: number; nickname: string; avatar: string } }) => {
      if (data.room_id !== roomId.value || !detail.value) return;
      const existing = detail.value.members.find((m) => m.user_id === data.user.id);
      if (existing) return;
      // 后端只返了 {id, nickname, avatar}，online 默认 true
      detail.value.members.push({
        user_id: data.user.id,
        username: '',
        nickname: data.user.nickname,
        avatar: data.user.avatar,
        role: 'member',
        online: true,
        last_seen_at: null,
        joined_at: new Date().toISOString(),
      });
    }),
  );
  cleanups.push(
    ws.on('member_left', (data: { room_id: number; user_id: number }) => {
      if (data.room_id !== roomId.value || !detail.value) return;
      detail.value.members = detail.value.members.filter((m) => m.user_id !== data.user_id);
    }),
  );
  cleanups.push(
    ws.on('member_kicked', (data: { room_id: number; user_id: number }) => {
      if (data.room_id !== roomId.value) return;
      if (data.user_id === myId.value) {
        alert('你已被房主移出房间');
        router.replace('/rooms');
        return;
      }
      if (detail.value) {
        detail.value.members = detail.value.members.filter((m) => m.user_id !== data.user_id);
      }
    }),
  );
  cleanups.push(
    ws.on('room_deleted', (data: { room_id: number }) => {
      if (data.room_id !== roomId.value) return;
      alert('房间已被删除');
      router.replace('/rooms');
    }),
  );
  cleanups.push(
    ws.on('presence', (data: { room_id: number; user_id: number; online: boolean }) => {
      if (data.room_id !== roomId.value || !detail.value) return;
      const m = detail.value.members.find((m) => m.user_id === data.user_id);
      if (m) m.online = data.online;
    }),
  );

  if (auth.token && !ws.ready) {
    wsState.value = 'connecting';
    ws.connect();
  } else if (ws.ready) {
    wsState.value = 'connected';
  }

  // 等 ready 后订阅
  if (ws.ready) {
    ws.subscribe(roomId.value).catch(() => {});
  } else {
    const off = ws.on('ready', () => {
      ws.subscribe(roomId.value).catch(() => {});
      off();
    });
    cleanups.push(off);
  }
}

onMounted(async () => {
  setupWs();
  await Promise.all([loadDetail(), loadInitialHistory()]);
});

onUnmounted(() => {
  for (const off of cleanups) off();
  // 注：不断 WS 连接，只取消订阅；用户可能回到房间列表后再进别的房间
  const ws = getWsClient(() => auth.token);
  ws.unsubscribe(roomId.value);
});

// 切换房间（同一 ChatView 路由复用）
watch(roomId, async (newId, oldId) => {
  if (newId === oldId) return;
  messages.value = [];
  seenMessageIds.clear();
  detail.value = null;
  const ws = getWsClient(() => auth.token);
  ws.unsubscribe(oldId);
  ws.subscribe(newId).catch(() => {});
  await Promise.all([loadDetail(), loadInitialHistory()]);
});
</script>

<template>
  <div class="page">
    <header class="topbar">
      <button class="ghost" @click="router.push('/rooms')">← 房间列表</button>
      <div class="room-info">
        <span class="name">{{ detail?.room.name ?? '加载中' }}</span>
        <span class="code">#{{ detail?.room.code }}</span>
        <span class="dot" :class="wsState" :title="`WS ${wsState}`"></span>
      </div>
      <div class="actions">
        <button class="ghost" @click="showMembers = !showMembers">
          成员 {{ detail?.members.length ?? 0 }}（在线 {{ onlineCount }}）
        </button>
        <button class="ghost" @click="leaveRoom">退出</button>
      </div>
    </header>

    <div class="body">
      <main class="chat">
        <div class="messages" ref="scroller" @scroll="(e) => {
          const el = e.target as HTMLElement;
          if (el.scrollTop < 50) loadMoreHistory();
        }">
          <p v-if="loadingHistory && !messages.length" class="muted center">加载中…</p>
          <p v-else-if="hasMore" class="center muted">
            <button class="ghost" :disabled="loadingHistory" @click="loadMoreHistory">
              {{ loadingHistory ? '加载中…' : '加载更早消息' }}
            </button>
          </p>
          <p v-else-if="messages.length" class="center muted small">— 已是最早 —</p>

          <MessageBubble
            v-for="m in messages"
            :key="m.id"
            :msg="m"
            :mine="m.user_id === myId"
            :mentioned="m.mentioned_user_ids?.includes(myId)"
          />
        </div>

        <form class="input-bar" @submit.prevent="send">
          <textarea
            v-model="input"
            placeholder="说点什么…  支持 Markdown，@username 提及他人，Enter 发送，Shift+Enter 换行"
            rows="2"
            maxlength="4000"
            @keydown="onKeydown"
          />
          <button type="submit" :disabled="sending || !input.trim()">
            {{ sending ? '发送中…' : '发送' }}
          </button>
        </form>
        <p v-if="error" class="error-text in-bar">{{ error }}</p>
      </main>

      <aside v-if="showMembers" class="member-panel">
        <h3>成员</h3>
        <ul>
          <li v-for="m in detail?.members ?? []" :key="m.user_id">
            <span class="avatar">{{ m.avatar }}</span>
            <span class="nick">{{ m.nickname }}</span>
            <span v-if="m.role === 'owner'" class="badge">房主</span>
            <span class="online-dot" :class="{ on: m.online }" />
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--color-border);
  gap: 12px;
}
.room-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: var(--color-purple-700);
}
.code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--color-cyan-100);
  color: var(--color-cyan-700);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}
.dot.connected {
  background: #6bbf7a;
}
.dot.connecting {
  background: var(--color-orange-300);
}
.dot.disconnected {
  background: var(--color-danger);
}
.actions {
  display: flex;
  gap: 8px;
}

.body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-width: 1000px;
  width: 100%;
  margin: 0 auto;
  padding: 0 16px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 4px;
  display: flex;
  flex-direction: column;
}
.center {
  text-align: center;
}
.small {
  font-size: 12px;
}

.input-bar {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 12px 0 16px;
  border-top: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.6);
}
.input-bar textarea {
  resize: none;
  min-height: 40px;
  max-height: 160px;
}
.input-bar button {
  height: 40px;
  padding: 0 18px;
  flex-shrink: 0;
}
.in-bar {
  padding: 0 0 8px;
}

.member-panel {
  width: 240px;
  border-left: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.6);
  padding: 16px;
  overflow-y: auto;
}
.member-panel h3 {
  margin: 0 0 12px;
  color: var(--color-purple-700);
}
.member-panel ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.member-panel li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
.member-panel .avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-purple-100);
  display: grid;
  place-items: center;
  font-size: 16px;
}
.member-panel .nick {
  flex: 1;
}
.member-panel .badge {
  background: var(--color-orange-200);
  color: #5a3010;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
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

@media (max-width: 720px) {
  .member-panel {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 10;
    box-shadow: var(--shadow-lg);
  }
}
</style>
