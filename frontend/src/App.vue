<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from './stores/auth';

const auth = useAuthStore();
onMounted(() => auth.hydrate());
</script>

<template>
  <RouterView />
</template>
