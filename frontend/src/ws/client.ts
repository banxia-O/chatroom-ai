/**
 * 半夏茶馆 WebSocket 客户端。
 *
 * - 订阅协议见 docs/ws-protocol.md
 * - 每 25s 发 ping（服务端 60s 无 ping 关闭）
 * - 断线指数退避重连，重连后自动重订阅 + 复发未 ack 的 send
 * - 暴露 on(type, handler) 事件总线 + req(type, data) 请求-响应
 */
type Listener = (data: any, frame: any) => void;

interface PendingReq {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingSend {
  client_msg_id: string;
  payload: { room_id: number; content: string; client_msg_id: string };
  acked: boolean;
}

const HEARTBEAT_INTERVAL_MS = 25_000;
const REQ_TIMEOUT_MS = 8_000;
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 16000];

export class WsClient {
  private url: string;
  private getToken: () => string | null;
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private pending = new Map<string, PendingReq>();
  private subscribedRooms = new Set<number>();
  private pendingSends = new Map<string, PendingSend>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitClose = false;
  private reqIdSeq = 0;

  ready = false;

  constructor(url: string, getToken: () => string | null) {
    this.url = url;
    this.getToken = getToken;
  }

  connect() {
    if (this.ws) return;
    const token = this.getToken();
    if (!token) return;
    this.explicitClose = false;
    const ws = new WebSocket(this.url, ['bearer', token]);
    this.ws = ws;
    ws.addEventListener('open', () => this.onOpen());
    ws.addEventListener('message', (e) => this.onMessage(e));
    ws.addEventListener('close', () => this.onClose());
    ws.addEventListener('error', () => {
      /* 留给 close 触发重连 */
    });
  }

  close() {
    this.explicitClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.ws?.close();
    this.ws = null;
    this.ready = false;
  }

  on(type: string, handler: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  /** 订阅房间。失败 throws；重连后会自动复订。 */
  async subscribe(roomId: number) {
    this.subscribedRooms.add(roomId);
    if (!this.ready) return; // 等 onOpen 自动 flush
    await this.req('subscribe', { room_id: roomId });
  }

  unsubscribe(roomId: number) {
    this.subscribedRooms.delete(roomId);
    if (this.ready) this.send({ type: 'unsubscribe', data: { room_id: roomId } });
  }

  /** typing 是 fire-and-forget，无 ack，无重发 */
  sendTyping(roomId: number, isTyping: boolean) {
    if (!this.ready) return;
    this.send({ type: 'typing', data: { room_id: roomId, is_typing: isTyping } });
  }

  /** 发消息。等 send:ack，超时即抛。重发同 client_msg_id 幂等。 */
  async sendMessage(roomId: number, content: string, clientMsgId: string) {
    const payload = { room_id: roomId, content, client_msg_id: clientMsgId };
    this.pendingSends.set(clientMsgId, { client_msg_id: clientMsgId, payload, acked: false });
    try {
      const ack = await this.req('send', payload);
      this.pendingSends.delete(clientMsgId);
      return ack as { client_msg_id: string; message_id: number; created_at: string };
    } catch (e) {
      // 不删 pendingSends，重连后会重发
      throw e;
    }
  }

  private send(frame: { type: string; data: unknown; id?: string }) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  /** 发请求帧并等 `<type>:ack` / `<type>:error` */
  private req(type: string, data: unknown): Promise<any> {
    const id = `r${++this.reqIdSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} 请求超时`));
      }, REQ_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.send({ type, id, data })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('WS 未连接'));
      }
    });
  }

  private emit(type: string, data: any, frame: any) {
    const set = this.listeners.get(type);
    if (set) for (const h of set) h(data, frame);
  }

  private onOpen() {
    this.reconnectAttempt = 0;
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping', data: {} });
    }, HEARTBEAT_INTERVAL_MS);
    // ready 帧到了才算就绪
  }

  private async onMessage(e: MessageEvent) {
    let frame: any;
    try {
      frame = JSON.parse(e.data);
    } catch {
      return;
    }

    // 请求-响应路由
    if (frame.id && this.pending.has(frame.id)) {
      const p = this.pending.get(frame.id)!;
      clearTimeout(p.timer);
      this.pending.delete(frame.id);
      if (frame.type.endsWith(':error')) {
        p.reject(Object.assign(new Error(frame.data?.message ?? frame.type), frame.data ?? {}));
      } else {
        p.resolve(frame.data);
      }
    }

    if (frame.type === 'ready') {
      this.ready = true;
      // 重订阅 + 复发未 ack
      for (const rid of this.subscribedRooms) {
        try {
          await this.req('subscribe', { room_id: rid });
        } catch {
          /* 个别失败不影响其他 */
        }
      }
      for (const ps of this.pendingSends.values()) {
        try {
          await this.req('send', ps.payload);
          this.pendingSends.delete(ps.client_msg_id);
        } catch {
          /* 留到下一轮重连 */
        }
      }
      this.emit('ready', frame.data, frame);
      return;
    }

    this.emit(frame.type, frame.data, frame);
  }

  private onClose() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.ws = null;
    this.ready = false;
    this.emit('disconnected', {}, {});
    if (this.explicitClose) return;
    const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}

// 单例
let _instance: WsClient | null = null;
export function getWsClient(getToken: () => string | null) {
  if (_instance) return _instance;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  _instance = new WsClient(url, getToken);
  return _instance;
}

export function genClientMsgId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
