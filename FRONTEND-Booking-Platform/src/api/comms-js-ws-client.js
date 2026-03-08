// comms-js-ws-client.js
//
// Lightweight, resilient WebSocket client for front-end integration with comms-js real-time notifications.
// - Minimal dependency: uses browser WebSocket API (works in modern browsers).
// - Features: auto-reconnect with exponential backoff, heartbeat (ping/pong), channel subscription, message handlers,
//   optional ack callback, and simple presence/connection state.
// - Designed to work with the server-side wsPublisher channel id pattern used by notification.provider.setWSPublisher.
//
// Usage (example):
//   import CommsJsWSClient from './comms-js-ws-client';
//   const client = new CommsJsWSClient({ url: 'wss://api.example.com/ws', token: 'jwt...' });
//   client.on('connected', () => client.subscribe('user:123'));
//   client.on('message', (msg) => console.log('notification', msg));
//   client.connect();

class CommsJsWSClient {
  /**
   * @param {Object} opts
   *  { url, token, protocols, autoConnect=true, reconnectMaxAttempts=Infinity, reconnectBaseMs=500, maxReconnectMs=30000, heartbeatIntervalMs=30000, logger }
   */
  constructor(opts = {}) {
    this.url = opts.url;
    this.token = opts.token || null;
    this.protocols = opts.protocols || undefined;
    this.autoConnect = typeof opts.autoConnect === 'undefined' ? true : !!opts.autoConnect;
    this.reconnectBaseMs = Math.max(100, opts.reconnectBaseMs || 500);
    this.maxReconnectMs = Math.max(this.reconnectBaseMs, opts.maxReconnectMs || 30000);
    this.reconnectMaxAttempts = typeof opts.reconnectMaxAttempts === 'undefined' ? Infinity : Number(opts.reconnectMaxAttempts);
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs || 30000;
    this.logger = opts.logger || console;

    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.attempts = 0;
    this.subscriptions = new Set(); // channel ids subscribed (e.g., user:123)
    this.eventHandlers = {}; // simple event emitter
    this.heartbeatTimer = null;
    this.pongTimeout = null;

    if (this.autoConnect) {
      // defer connect to next tick to allow attaching handlers
      setTimeout(() => this.connect(), 0);
    }
  }

  /* -------------------------
   * Public API
   * ------------------------- */

  connect() {
    if (this.connected || this.connecting) return;
    if (!this.url) throw new Error('WebSocket URL required');

    this.connecting = true;
    this.attempts += 1;
    const wsUrl = this._buildUrlWithToken(this.url, this.token);

    try {
      this.ws = this.protocols ? new WebSocket(wsUrl, this.protocols) : new WebSocket(wsUrl);
    } catch (err) {
      this.connecting = false;
      this._scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', this._onOpen.bind(this));
    this.ws.addEventListener('message', this._onMessage.bind(this));
    this.ws.addEventListener('close', this._onClose.bind(this));
    this.ws.addEventListener('error', this._onError.bind(this));
  }

  disconnect({ code = 1000, reason = 'client_disconnect', reconnect = false } = {}) {
    this.reconnect = reconnect;
    this._clearHeartbeat();
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch (_) {}
    }
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    if (!reconnect) {
      this.attempts = 0;
    }
    this._emit('disconnected', { code, reason });
  }

  subscribe(channelId) {
    if (!channelId) return;
    this.subscriptions.add(channelId);
    if (this.connected) {
      this._send({ type: 'subscribe', channel: channelId });
    }
  }

  unsubscribe(channelId) {
    if (!channelId) return;
    this.subscriptions.delete(channelId);
    if (this.connected) {
      this._send({ type: 'unsubscribe', channel: channelId });
    }
  }

  publish(channelId, payload = {}) {
    if (!channelId) throw new Error('channelId required');
    return this._send({ type: 'publish', channel: channelId, payload });
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = new Set();
    this.eventHandlers[event].add(handler);
  }

  off(event, handler) {
    if (!this.eventHandlers[event]) return;
    this.eventHandlers[event].delete(handler);
  }

  /* -------------------------
   * Internal helpers
   * ------------------------- */

  _buildUrlWithToken(url, token) {
    if (!token) return url;
    // If token should be sent as a query param (common for WebSocket auth)
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  }

  _onOpen() {
    this.connecting = false;
    this.connected = true;
    this.attempts = 0;
    this._emit('connected');
    this.logger.info && this.logger.info({ event: 'ws.connected', url: this.url });

    // re-subscribe to channels
    for (const ch of this.subscriptions) {
      this._send({ type: 'subscribe', channel: ch });
    }

    // start heartbeat
    this._startHeartbeat();
  }

  _onMessage(evt) {
    let data = evt.data;
    try {
      data = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (err) {
      // non-JSON payload; emit raw
      this._emit('raw', evt.data);
      return;
    }

    // handle control messages
    if (data && data.type === 'pong') {
      // reset pong timeout
      this._onPong();
      return;
    }

    // standard notification message
    this._emit('message', data);

    // convenience: emit typed events for message_notification
    if (data && data.type) {
      this._emit(`message:${data.type}`, data);
    }
  }

  _onClose(evt) {
    this.connected = false;
    this.connecting = false;
    this._clearHeartbeat();
    this._emit('disconnected', { code: evt.code, reason: evt.reason });
    this.logger.warn && this.logger.warn({ event: 'ws.closed', code: evt.code, reason: evt.reason });

    // schedule reconnect unless explicitly closed by client with reconnect=false
    if (typeof this.reconnect === 'undefined' || this.reconnect) {
      this._scheduleReconnect();
    }
  }

  _onError(err) {
    this.logger.error && this.logger.error({ event: 'ws.error', error: err && err.message ? err.message : String(err) });
    this._emit('error', err);
    // let close handler decide reconnect
  }

  _send(obj) {
    const payload = JSON.stringify(obj);
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(payload);
        return true;
      } catch (err) {
        this.logger.error && this.logger.error({ event: 'ws.send_failed', error: err && err.message ? err.message : String(err) });
        return false;
      }
    }
    // not connected: optionally buffer or return false
    this.logger.warn && this.logger.warn({ event: 'ws.send_while_disconnected', payload: obj });
    return false;
  }

  _emit(event, payload) {
    const handlers = this.eventHandlers[event];
    if (handlers && handlers.size) {
      for (const h of Array.from(handlers)) {
        try {
          h(payload);
        } catch (err) {
          this.logger.error && this.logger.error({ event: 'ws.handler_error', handler: String(h), error: err && err.message ? err.message : String(err) });
        }
      }
    }
  }

  _scheduleReconnect() {
    if (this.attempts >= this.reconnectMaxAttempts) {
      this._emit('reconnect_failed', { attempts: this.attempts });
      return;
    }
    this.attempts += 1;
    const backoffMs = Math.min(this.maxReconnectMs, this.reconnectBaseMs * Math.pow(2, Math.max(0, this.attempts - 1)));
    this.logger.info && this.logger.info({ event: 'ws.reconnect_scheduled', attempt: this.attempts, delayMs: backoffMs });
    setTimeout(() => {
      this.connect();
    }, backoffMs);
  }

  _startHeartbeat() {
    this._clearHeartbeat();
    // send ping periodically
    this.heartbeatTimer = setInterval(() => {
      try {
        if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this._send({ type: 'ping', ts: Date.now() });
          // expect a 'pong' within heartbeatIntervalMs/2
          this.pongTimeout = setTimeout(() => {
            // no pong received in time -> force reconnect
            this.logger.warn && this.logger.warn({ event: 'ws.pong_timeout' });
            try {
              this.ws.close(4000, 'pong_timeout');
            } catch (_) {}
          }, Math.max(1000, Math.floor(this.heartbeatIntervalMs / 2)));
        }
      } catch (err) {
        this.logger.error && this.logger.error({ event: 'ws.heartbeat_error', error: err && err.message ? err.message : String(err) });
      }
    }, this.heartbeatIntervalMs);
  }

  _onPong() {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  _clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }
}

/* Export default for ES modules and CommonJS compatibility */
export default CommsJsWSClient;
module.exports = CommsJsWSClient;
