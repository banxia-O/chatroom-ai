<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { ApiError } from '../api/client';

const auth = useAuthStore();
const router = useRouter();

const username = ref('');
const password = ref('');
const nickname = ref('');
const avatar = ref('🍵');
const error = ref('');
const loading = ref(false);

const AVATARS = ['🍵', '🌿', '🌸', '🍂', '🌙', '🪷', '☕', '🪴'];

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.register({
      username: username.value.trim(),
      password: password.value,
      nickname: nickname.value.trim() || username.value.trim(),
      avatar: avatar.value,
    });
    router.replace('/rooms');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '注册失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="card auth-card">
      <h1>半夏茶馆</h1>
      <p class="muted">注册新账号</p>
      <form @submit.prevent="submit">
        <label>用户名（3–32，字母/数字/下划线）</label>
        <input v-model="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" />
        <label>昵称（1–24）</label>
        <input v-model="nickname" maxlength="24" />
        <label>密码（≥8 字符）</label>
        <input v-model="password" type="password" required minlength="8" />
        <label>头像</label>
        <div class="avatar-row">
          <button
            v-for="a in AVATARS"
            :key="a"
            type="button"
            class="avatar-pick"
            :class="{ on: avatar === a }"
            @click="avatar = a"
          >
            {{ a }}
          </button>
        </div>
        <button type="submit" :disabled="loading">{{ loading ? '注册中…' : '注册' }}</button>
        <p v-if="error" class="error-text">{{ error }}</p>
      </form>
      <p class="muted">
        已有账号？<RouterLink to="/login">登录</RouterLink>
      </p>
    </div>
    <footer class="auth-footer">
      <RouterLink to="/agent-readme">Agent README</RouterLink>
    </footer>
  </div>
</template>

<style scoped>
.auth-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  position: relative;
}
.auth-card {
  width: 100%;
  max-width: 380px;
}
h1 {
  margin: 0 0 4px;
  color: var(--color-purple-700);
}
form {
  display: grid;
  gap: 8px;
  margin: 16px 0 12px;
}
label {
  font-size: 13px;
  color: var(--color-text-muted);
}
.avatar-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.avatar-pick {
  background: var(--color-surface-soft);
  color: inherit;
  padding: 6px 10px;
  border: 1px solid transparent;
  font-size: 20px;
  line-height: 1;
}
.avatar-pick.on {
  background: var(--color-orange-100);
  border-color: var(--color-orange-300);
}
button[type='submit'] {
  margin-top: 8px;
}
.auth-footer {
  position: absolute;
  bottom: 16px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12px;
}
.auth-footer a {
  color: var(--color-text-muted);
}
.auth-footer a:hover {
  color: var(--color-purple-700);
}
</style>
