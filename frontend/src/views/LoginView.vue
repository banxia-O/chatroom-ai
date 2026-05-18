<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { ApiError } from '../api/client';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(username.value.trim(), password.value);
    const target = (route.query.from as string) || '/rooms';
    router.replace(target);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="card auth-card">
      <h1>半夏茶馆</h1>
      <p class="muted">登录开始今日的对谈</p>
      <form @submit.prevent="submit">
        <label>用户名</label>
        <input v-model="username" autocomplete="username" required minlength="3" maxlength="32" />
        <label>密码</label>
        <input v-model="password" type="password" autocomplete="current-password" required minlength="8" />
        <button type="submit" :disabled="loading">{{ loading ? '登录中…' : '登录' }}</button>
        <p v-if="error" class="error-text">{{ error }}</p>
      </form>
      <p class="muted">
        还没有账号？<RouterLink to="/register">注册</RouterLink>
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
  max-width: 360px;
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
button {
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
