import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { configureClient } from '../api/client';
import { authApi } from '../api/auth';
import { router } from '../router';
import type { User } from '../api/types';

const TOKEN_KEY = 'banxia:token';
const USER_KEY = 'banxia:user';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null);
  const user = ref<User | null>(null);

  function setSession(t: string, u: User) {
    token.value = t;
    user.value = u;
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  }

  function clearSession() {
    token.value = null;
    user.value = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function hydrate() {
    const t = localStorage.getItem(TOKEN_KEY);
    const u = localStorage.getItem(USER_KEY);
    if (t && u) {
      try {
        token.value = t;
        user.value = JSON.parse(u);
      } catch {
        clearSession();
      }
    }
  }

  async function login(username: string, password: string) {
    const r = await authApi.login({ username, password });
    setSession(r.token, r.user);
  }

  async function register(payload: {
    username: string;
    password: string;
    nickname: string;
    avatar?: string;
  }) {
    const r = await authApi.register(payload);
    setSession(r.token, r.user);
  }

  function logout() {
    clearSession();
    router.replace({ name: 'login' });
  }

  // 把 token 注入到 api client；401 时自动退出
  configureClient({
    getToken: () => token.value,
    onUnauthenticated: () => {
      if (token.value) {
        clearSession();
        router.replace({ name: 'login' });
      }
    },
  });

  return {
    token,
    user,
    isAuthed: computed(() => !!token.value),
    hydrate,
    login,
    register,
    logout,
    setSession,
    clearSession,
  };
});
