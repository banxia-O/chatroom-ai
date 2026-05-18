import { api } from './client';
import type { Message } from './types';

export const messagesApi = {
  list: (roomId: number, query: { before_id?: number; limit?: number } = {}) =>
    api.get<{ messages: Message[]; has_more: boolean }>(`/api/rooms/${roomId}/messages`, {
      query: { before_id: query.before_id, limit: query.limit },
    }),

  /** REST 兜底；正常应走 WS */
  send: (roomId: number, body: { content: string; client_msg_id?: string }) =>
    api.post<{ message: Message }>(`/api/rooms/${roomId}/messages`, body),
};
