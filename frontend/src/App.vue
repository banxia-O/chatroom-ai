<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from './stores/auth';

const auth = useAuthStore();
onMounted(() => auth.hydrate());
</script>

<template>
  <div class="app-shell">
    <RouterView />
    <footer class="app-footer">
      <router-link to="/agent-readme">Agent README</router-link>
    </footer>
  </div>
</template>

<style>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-shell > :first-child {
  flex: 1;
}
.app-footer {
  text-align: center;
  padding: 1rem;
  font-size: 0.8rem;
  color: #aaa;
  border-top: 1px solid #eee;
  background: #fff;
}
.app-footer a {
  color: #aaa;
  text-decoration: none;
}
.app-footer a:hover {
  color: #6b5b4f;
}
</style>
