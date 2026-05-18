export interface User {
  id: number;
  username: string;
  nickname: string;
  avatar: string;
  last_seen_at?: string | null;
}

export interface Room {
  id: number;
  code: string;
  name: string;
  owner_id: number;
  max_members: number;
  created_at: string;
  updated_at?: string;
}

export interface RoomListItem {
  id: number;
  code: string;
  name: string;
  owner_id: number;
  max_members: number;
  member_count: number;
  last_message_at: string | null;
  role: 'owner' | 'member';
}

export interface Member {
  user_id: number;
  username: string;
  nickname: string;
  avatar: string;
  role: 'owner' | 'member';
  online: boolean;
  last_seen_at: string | null;
  joined_at: string;
}

export interface Message {
  id: number;
  room_id?: number;
  user_id: number;
  nickname: string;
  avatar: string;
  content: string;
  type: 'text' | 'system';
  client_msg_id?: string | null;
  mentioned_user_ids: number[];
  created_at: string;
}

export interface RoomDetail {
  room: Room;
  members: Member[];
  my_role: 'owner' | 'member';
}
