import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from './stores/auth';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/rooms' },
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
  { path: '/register', name: 'register', component: () => import('./views/RegisterView.vue') },
  {
    path: '/rooms',
    name: 'rooms',
    component: () => import('./views/RoomListView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/rooms/:id(\\d+)',
    name: 'chat',
    component: () => import('./views/ChatView.vue'),
    meta: { requiresAuth: true },
    props: true,
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.token) {
    return { name: 'login', query: { from: to.fullPath } };
  }
  if ((to.name === 'login' || to.name === 'register') && auth.token) {
    return { name: 'rooms' };
  }
  return true;
});
