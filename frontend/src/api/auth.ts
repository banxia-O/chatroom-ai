import { api } from './client';
import type { User } from './types';

export const authApi = {
  register: (body: { username: string; password: string; nickname: string; avatar?: string }) =>
    api.post<{ user: User; token: string }>('/api/register', body, { auth: false }),

  login: (body: { username: string; password: string }) =>
    api.post<{ user: User; token: string }>('/api/login', body, { auth: false }),

  me: () => api.get<{ user: User }>('/api/me'),
};
