import WebSocket from "ws";
import { randomInt } from "node:crypto";
import type { LiveStatus } from "../../packages/shared/contracts.js";

export type IrcMessage = {
  tags: Record<string, string>;
  prefix: string;
  command: string;
  params: string[];
};
/** IRCv3 escapes are decoded once; unknown escapes lose the backslash (IRCv3 spec). */
export function parseIrc(line: string): IrcMessage | null {
  let rest = line.replace(/\r?\n$/, "");
  const tags: Record<string, string> = Object.create(null);
  if (rest.startsWith("@")) {
    const end = rest.indexOf(" ");
    if (end < 0) return null;
    for (const tag of rest.slice(1, end).split(";")) {
      const eq = tag.indexOf("=");
      const key = eq < 0 ? tag : tag.slice(0, eq);
      tags[key] = (eq < 0 ? "" : tag.slice(eq + 1)).replace(
        /\\(.)/g,
        (_, c: string) =>
          ({ s: " ", ":": ";", r: "\r", n: "\n", "\\": "\\" })[c] ?? c,
      );
    }
    rest = rest.slice(end + 1).trimStart();
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const end = rest.indexOf(" ");
    if (end < 0) return null;
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1).trimStart();
  }
  const command = rest.match(/^\S+/)?.[0];
  if (!command) return null;
  rest = rest.slice(command.length).trimStart();
  const params: string[] = [];
  while (rest) {
    if (rest.startsWith(":")) {
      params.push(rest.slice(1));
      break;
    }
    const end = rest.indexOf(" ");
    if (end < 0) {
      params.push(rest);
      break;
    }
    params.push(rest.slice(0, end));
    rest = rest.slice(end + 1).trimStart();
  }
  return { tags, prefix, command: command.toUpperCase(), params };
}

export function normalizeChannel(input: string) {
  const channel = input.trim().replace(/^#/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(channel))
    throw Error("Use a Twitch channel login (letters, numbers, underscore)");
  return channel;
}
export class TwitchIrc {
  readonly status: LiveStatus;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private stopped = false;
  private attempt = 0;
  private seen = new Set<string>();
  private messages = new Map<string, number>();
  private rate = new Map<string, number>();
  private lastWire = Date.now();
  private pending = 0;
  private nick = `justinfan${randomInt(10000, 100000)}`;
  constructor(
    channel: string,
    private handlers: {
      chat: (message: {
        id: string;
        userId: string;
        name: string;
        color: string;
        text: string;
      }) => Promise<unknown>;
      raid: (message: {
        id: string;
        sourceId: string;
        from: string;
        count: number;
      }) => Promise<unknown>;
      changed?: () => void;
    },
    private options: {
      url?: string;
      retryMs?: number;
      idleMs?: number;
      timeoutMs?: number;
      /** Messages worth acting on; others are ignored before rate limiting. */
      actionable?: (text: string) => boolean;
    } = {},
  ) {
    this.status = {
      channel: normalizeChannel(channel),
      connected: false,
      lastMessageAt: null,
      viewersSeen: 0,
      raidsSeen: 0,
      error: null,
    };
  }
  start() {
    this.stopped = false;
    this.connect();
    return this;
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.watchdog);
    this.socket?.terminate();
    this.socket = undefined;
    this.status.connected = false;
    this.handlers.changed?.();
  }
  private connect() {
    if (this.stopped) return;
    const ws = (this.socket = new WebSocket(
      this.options.url || "wss://irc-ws.chat.twitch.tv:443",
      { handshakeTimeout: 10000, maxPayload: 128 * 1024 },
    ));
    this.lastWire = Date.now();
    ws.on("open", () => {
      // Twitch's WebSocket gateway expects one outbound command per frame.
      for (const command of [
        "PASS SCHMOOPIIE",
        `NICK ${this.nick}`,
        "CAP REQ :twitch.tv/tags twitch.tv/commands",
        `JOIN #${this.status.channel}`,
      ])
        ws.send(command);
      // Twitch only PINGs about every 5 minutes, so a quiet channel would trip the
      // watchdog. Ask for a PONG ourselves whenever the wire has been idle.
      const idleMs = this.options.idleMs ?? 45000;
      const timeoutMs = this.options.timeoutMs ?? 90000;
      this.watchdog = setInterval(
        () => {
          const idle = Date.now() - this.lastWire;
          if (idle > timeoutMs) {
            this.status.error = "IRC heartbeat timed out";
            ws.terminate();
          } else if (idle > idleMs && ws.readyState === WebSocket.OPEN)
            ws.send("PING :raidrift");
        },
        Math.min(15000, Math.max(10, idleMs / 3)),
      );
      this.watchdog.unref();
    });
    ws.on("message", (data) => {
      if (this.stopped || this.socket !== ws) return;
      this.lastWire = Date.now();
      for (const line of data.toString().split(/\r?\n/)) {
        const m = parseIrc(line);
        if (m) this.receive(m, ws);
      }
    });
    ws.on("error", () => {
      this.status.error = "Twitch IRC connection failed";
      this.handlers.changed?.();
    });
    ws.on("close", () => {
      clearInterval(this.watchdog);
      if (this.stopped || this.socket !== ws) return;
      this.status.connected = false;
      this.status.error ||= "Twitch IRC disconnected; retrying";
      this.handlers.changed?.();
      const delay = Math.min(
        30000,
        (this.options.retryMs ?? 1000) * 2 ** Math.min(this.attempt++, 5),
      );
      this.retry = setTimeout(() => this.connect(), delay);
      this.retry.unref();
    });
  }
  private receive(m: IrcMessage, ws: WebSocket) {
    if (m.command === "PING") {
      ws.send(`PONG :${m.params.at(-1) || "tmi.twitch.tv"}\r\n`);
      return;
    }
    if (m.command === "RECONNECT") {
      this.status.error = "Twitch requested reconnect";
      ws.terminate();
      return;
    }
    if (m.command === "NOTICE") {
      this.status.error = (m.params.at(-1) || "Twitch notice").slice(0, 160);
      this.handlers.changed?.();
      return;
    }
    if (m.params[0]?.toLowerCase() !== `#${this.status.channel}`) return;
    if (
      ["ROOMSTATE", "JOIN", "366", "PRIVMSG", "USERNOTICE"].includes(m.command)
    ) {
      this.status.connected = true;
      this.status.error = null;
      this.attempt = 0;
      if (/^\d+$/.test(m.tags["room-id"] || ""))
        this.status.channelId = m.tags["room-id"];
      this.handlers.changed?.();
    }
    if (!["PRIVMSG", "USERNOTICE"].includes(m.command)) return;
    this.status.lastMessageAt = Date.now();
    const id = m.tags.id;
    // Tagged Twitch events always have an ID. Refuse unidentifiable traffic.
    if (!id || this.messages.has(id)) return;
    this.messages.set(id, Date.now());
    if (this.messages.size > 5000)
      this.messages.delete(this.messages.keys().next().value!);
    let task: (() => Promise<unknown>) | undefined;
    if (m.command === "PRIVMSG") {
      const userId = m.tags["user-id"];
      if (
        !/^\d+$/.test(userId || "") ||
        m.prefix.split("!")[0] === this.nick ||
        m.prefix.startsWith("jtv!")
      )
        return;
      if (!this.seen.has(userId)) {
        if (this.seen.size < 100000) this.seen.add(userId);
        this.status.viewersSeen = this.seen.size;
      }
      const text = (m.params[1] || "").slice(0, 500);
      // Ordinary conversation must not use up the per-user cooldown: "hi" then
      // "!join" 100 ms later should still join.
      if (this.options.actionable && !this.options.actionable(text)) return;
      const now = Date.now(),
        last = this.rate.get(userId);
      if (last !== undefined && now - last < 500) return;
      if (this.rate.size > 10000)
        for (const [key, time] of this.rate)
          if (now - time > 60000) this.rate.delete(key);
      this.rate.set(userId, now);
      task = () =>
        this.handlers.chat({
          id,
          userId,
          name: m.tags["display-name"] || m.prefix.split("!")[0],
          color: m.tags.color || "",
          text,
        });
    } else if (m.tags["msg-id"] === "raid") {
      const count = Number(m.tags["msg-param-viewerCount"]);
      if (!Number.isSafeInteger(count) || count < 1 || count > 10000000) return;
      this.status.raidsSeen++;
      task = () =>
        this.handlers.raid({
          id,
          sourceId: m.tags["user-id"] || "",
          from: (
            m.tags["msg-param-displayName"] ||
            m.tags["msg-param-login"] ||
            "Raiders"
          ).slice(0, 50),
          count,
        });
    }
    // Raids are rare and important: never drop one because chat work is backed up.
    if (task && (this.pending < 64 || m.command === "USERNOTICE")) {
      this.pending++;
      void task()
        .catch(() => {
          /* Game errors stay in the world's bounded debug log. */
        })
        .finally(() => {
          this.pending--;
        });
    }
    this.handlers.changed?.();
  }
}
