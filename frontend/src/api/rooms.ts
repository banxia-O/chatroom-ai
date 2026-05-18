import { api } from './client';
import type { Room, RoomDetail, RoomListItem } from './types';

export const roomsApi = {
  list: () => api.get<{ rooms: RoomListItem[] }>('/api/rooms'),

  create: (body: { name: string; password: string; max_members?: number }) =>
    api.post<{ room: Room }>('/api/rooms', body),

  join: (body: { code: string; password: string }) =>
    api.post<{ room: Room }>('/api/rooms/join', body),

  detail: (id: number) => api.get<RoomDetail>(`/api/rooms/${id}`),

  leave: (id: number) =>
    api.post<{ ok: true; transferred_to?: number; deleted?: true }>(`/api/rooms/${id}/leave`),

  kick: (id: number, userId: number) =>
    api.post<{ ok: true }>(`/api/rooms/${id}/kick`, { user_id: userId }),

  updatePassword: (id: number, newPassword: string) =>
    api.patch<{ ok: true }>(`/api/rooms/${id}/password`, { new_password: newPassword }),
};
