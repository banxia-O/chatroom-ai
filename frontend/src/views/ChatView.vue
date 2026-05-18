<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { roomsApi } from '../api/rooms';
import { messagesApi } from '../api/messages';
import { getWsClient, genClientMsgId } from '../ws/client';
import { ApiError } from '../api/client';
import MessageBubble from '../components/MessageBubble.vue';
import MemberPanel from '../components/MemberPanel.vue';
import ChatInput from '../components/ChatInput.vue';
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
const showPasswordPanel = ref(false);
const error = ref('');
const scroller = ref<HTMLElement | null>(null);
const chatInput = ref<{ clear: () => void; focus: () => void } | null>(null);
const cleanups: Array<() => void> = [];

// 移动端断点：小于此宽度成员面板走 drawer
const MOBILE_BREAK = 720;
const winWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
const isMobile = computed(() => winWidth.value < MOBILE_BREAK);
function onResize() {
  winWidth.value = window.innerWidth;
}

const myId = computed(() => auth.user?.id ?? -1);
const myRole = computed<'owner' | 'member' | null>(() => detail.value?.my_role ?? null);
const onlineCount = computed(
  () => detail.value?.members.filter((m) => m.online).length ?? 0,
);

// ---------- typing 状态 ----------

interface TypingEntry {
  user_id: number;
  nickname: string;
  expiresAt: number;
}
const typingUsers = ref<TypingEntry[]>([]);
let typingSweepTimer: ReturnType<typeof setInterval> | null = null;

function typingLabel(): string {
  if (!typingUsers.value.length) return '';
  if (typingUsers.value.length === 1) return `${typingUsers.value[0].nickname} 正在输入…`;
  if (typingUsers.value.length === 2)
    return `${typingUsers.value[0].nickname} 和 ${typingUsers.value[1].nickname} 正在输入…`;
  return `${typingUsers.value.length} 人正在输入…`;
}

// ---------- 修改密码 ----------

const newPasswordInput = ref('');
const passwordBusy = ref(false);
const passwordError = ref('');
const passwordSuccess = ref('');

async function submitPassword() {
  passwordError.value = '';
  passwordSuccess.value = '';
  passwordBusy.value = true;
  try {
    await roomsApi.updatePassword(roomId.value, newPasswordInput.value);
    passwordSuccess.value = '密码已更新';
    newPasswordInput.value = '';
    setTimeout(() => {
      passwordSuccess.value = '';
      showPasswordPanel.value = false;
    }, 1200);
  } catch (e) {
    passwordError.value = e instanceof ApiError ? e.message : '更新失败';
  } finally {
    passwordBusy.value = false;
  }
}

// ---------- 消息 ----------

function pushMessage(m: Message) {
  if (seenMessageIds.has(m.id)) return;
  seenMessageIds.add(m.id);
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
    for (const m of r.messages) seenMessageIds.add(m.id);
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
    if (el) el.scrollTop = el.scrollHeight - prevHeight;
  } catch {
    /* ignore */
  } finally {
    loadingHistory.value = false;
  }
}

async function onSend(content: string) {
  if (sending.value) return;
  sending.value = true;
  const clientMsgId = genClientMsgId();
  try {
    const ws = getWsClient(() => auth.token);
    if (ws.ready) {
      await ws.sendMessage(roomId.value, content, clientMsgId);
    } else {
      const r = await messagesApi.send(roomId.value, { content, client_msg_id: clientMsgId });
      pushMessage(r.message);
    }
    chatInput.value?.clear();
  } catch (e: any) {
    error.value = e?.message ?? '发送失败';
  } finally {
    sending.value = false;
  }
}

function onTyping(isTyping: boolean) {
  getWsClient(() => auth.token).sendTyping(roomId.value, isTyping);
}

async function leaveRoom() {
  if (!confirm('确定退出这个房间？')) return;
  try {
    await roomsApi.leave(roomId.value);
  } finally {
    router.replace('/rooms');
  }
}

async function kickMember(userId: number) {
  try {
    await roomsApi.kick(roomId.value, userId);
    // 列表通过 member_kicked 广播自动更新
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '踢出失败';
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
      // 收到消息时把该用户从 typing 列表移除
      typingUsers.value = typingUsers.value.filter((t) => t.user_id !== data.message.user_id);
    }),
  );
  cleanups.push(
    ws.on(
      'member_joined',
      (data: {
        room_id: number;
        user: { id: number; username: string; nickname: string; avatar: string };
      }) => {
        if (data.room_id !== roomId.value || !detail.value) return;
        if (detail.value.members.some((m) => m.user_id === data.user.id)) return;
        detail.value.members.push({
          user_id: data.user.id,
          username: data.user.username,
          nickname: data.user.nickname,
          avatar: data.user.avatar,
          role: 'member',
          online: true,
          last_seen_at: null,
          joined_at: new Date().toISOString(),
        });
      },
    ),
  );
  cleanups.push(
    ws.on('member_left', (data: { room_id: number; user_id: number }) => {
      if (data.room_id !== roomId.value || !detail.value) return;
      detail.value.members = detail.value.members.filter((m) => m.user_id !== data.user_id);
      typingUsers.value = typingUsers.value.filter((t) => t.user_id !== data.user_id);
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
      typingUsers.value = typingUsers.value.filter((t) => t.user_id !== data.user_id);
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
  cleanups.push(
    ws.on(
      'typing',
      (data: { room_id: number; user_id: number; is_typing: boolean }) => {
        if (data.room_id !== roomId.value) return;
        if (data.user_id === myId.value) return;
        if (!data.is_typing) {
          typingUsers.value = typingUsers.value.filter((t) => t.user_id !== data.user_id);
          return;
        }
        const member = detail.value?.members.find((m) => m.user_id === data.user_id);
        if (!member) return;
        const existing = typingUsers.value.find((t) => t.user_id === data.user_id);
        const expiresAt = Date.now() + 4000;
        if (existing) {
          existing.expiresAt = expiresAt;
        } else {
          typingUsers.value.push({
            user_id: data.user_id,
            nickname: member.nickname,
            expiresAt,
          });
        }
      },
    ),
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
  window.addEventListener('resize', onResize);
  // 每 500ms 清理过期的 typing 条目
  typingSweepTimer = setInterval(() => {
    const now = Date.now();
    const filtered = typingUsers.value.filter((t) => t.expiresAt > now);
    if (filtered.length !== typingUsers.value.length) typingUsers.value = filtered;
  }, 500);

  setupWs();
  await Promise.all([loadDetail(), loadInitialHistory()]);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  if (typingSweepTimer) clearInterval(typingSweepTimer);
  for (const off of cleanups) off();
  const ws = getWsClient(() => auth.token);
  ws.unsubscribe(roomId.value);
  ws.sendTyping(roomId.value, false);
});

// 切换房间
watch(roomId, async (newId, oldId) => {
  if (newId === oldId) return;
  messages.value = [];
  seenMessageIds.clear();
  detail.value = null;
  typingUsers.value = [];
  const ws = getWsClient(() => auth.token);
  ws.unsubscribe(oldId);
  ws.subscribe(newId).catch(() => {});
  await Promise.all([loadDetail(), loadInitialHistory()]);
});
</script>

<template>
  <div class="page">
    <header class="topbar">
      <button class="ghost" @click="router.push('/rooms')">← 房间</button>
      <div class="room-info">
        <span class="name">{{ detail?.room.name ?? '加载中' }}</span>
        <span class="code">#{{ detail?.room.code }}</span>
        <span class="dot" :class="wsState" :title="`WS ${wsState}`"></span>
      </div>
      <div class="actions">
        <button
          v-if="myRole === 'owner'"
          class="ghost"
          @click="showPasswordPanel = !showPasswordPanel"
        >
          改密码
        </button>
        <button class="ghost" @click="showMembers = !showMembers">
          成员 {{ detail?.members.length ?? 0 }}（{{ onlineCount }} 在线）
        </button>
        <button class="ghost" @click="leaveRoom">退出</button>
      </div>
    </header>

    <div v-if="showPasswordPanel && myRole === 'owner'" class="password-panel card">
      <h4>修改房间密码</h4>
      <form @submit.prevent="submitPassword">
        <input
          v-model="newPasswordInput"
          type="password"
          required
          minlength="8"
          maxlength="128"
          placeholder="新密码（≥8 字符）"
        />
        <button type="submit" :disabled="passwordBusy">
          {{ passwordBusy ? '更新中…' : '确认' }}
        </button>
        <button type="button" class="ghost" @click="showPasswordPanel = false">取消</button>
      </form>
      <p v-if="passwordError" class="error-text">{{ passwordError }}</p>
      <p v-if="passwordSuccess" class="success-text">{{ passwordSuccess }}</p>
    </div>

    <div class="body">
      <main class="chat">
        <div
          class="messages"
          ref="scroller"
          @scroll="
            (e) => {
              const el = e.target as HTMLElement;
              if (el.scrollTop < 50) loadMoreHistory();
            }
          "
        >
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

        <div v-if="typingUsers.length" class="typing-bar muted">
          {{ typingLabel() }}
        </div>

        <ChatInput
          ref="chatInput"
          :members="detail?.members ?? []"
          :my-id="myId"
          :sending="sending"
          @send="onSend"
          @typing="onTyping"
        />
        <p v-if="error" class="error-text in-bar">{{ error }}</p>
      </main>

      <MemberPanel
        v-if="detail"
        :members="detail.members"
        :my-role="myRole"
        :my-id="myId"
        :open="showMembers"
        :is-mobile="isMobile"
        @close="showMembers = false"
        @kick="kickMember"
      />
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
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--color-border);
  gap: 12px;
  flex-wrap: wrap;
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
  gap: 6px;
  flex-wrap: wrap;
}

.password-panel {
  margin: 12px 16px;
  max-width: 480px;
}
.password-panel h4 {
  margin: 0 0 8px;
  color: var(--color-purple-700);
}
.password-panel form {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.password-panel input {
  flex: 1;
  min-width: 180px;
}
.success-text {
  color: var(--color-cyan-700);
  font-size: 13px;
  margin: 4px 0 0;
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

.typing-bar {
  padding: 2px 4px 4px;
  font-size: 12px;
  font-style: italic;
}

.in-bar {
  padding: 0 0 8px;
}
</style>
