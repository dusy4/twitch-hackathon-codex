import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Database } from "./db.js";
import type { Security } from "./security.js";
import type { World } from "./world.js";
type Subscriber = {
  ws: WebSocket;
  expires: number;
  version: number | null;
  alive: boolean;
};
export function installWorldTransport(
  server: Server,
  db: Database,
  security: Security,
  origin: string,
  getWorld: (id: string) => Promise<World>,
  metrics: { sockets: number },
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const rooms = new Map<
    string,
    {
      world: World;
      subscribers: Set<Subscriber>;
      listener: (event: any) => void;
    }
  >();
  const send = (ws: WebSocket, message: string) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1000000) {
      ws.close(1013, "Slow connection");
      return;
    }
    ws.send(message);
  };
  server.on("upgrade", async (req, socket, head) => {
    try {
      const url = new URL(req.url || "/", origin);
      if (url.pathname === "/v1/media") return;
      if (url.pathname !== "/v1/socket") throw Error("Path");
      if (req.headers.origin && req.headers.origin !== origin)
        throw Error("Origin");
      if (wss.clients.size >= 1500) throw Error("Capacity");
      const id = url.searchParams.get("room") || "";
      const world = await getWorld(id);
      let expires = Date.now() + 3600000,
        version: number | null = null;
      const token = url.searchParams.get("token");
      if (token) {
        const p = security.verify(token);
        if (p.role !== "overlay" || p.room !== id) throw Error("Role");
        const channel = (
          await db.query("SELECT token_version FROM channels WHERE id=$1", [id])
        ).rows[0];
        if (channel?.token_version !== p.version) throw Error("Revoked");
        expires = p.exp;
        version = p.version;
      } else if (!world.state.config.public) throw Error("Private");
      let room = rooms.get(id);
      if (!room) {
        const subscribers = new Set<Subscriber>();
        const listener = (event: any) => {
          const message = JSON.stringify(event);
          for (const s of subscribers) {
            if (s.version === null && !world.state.config.public)
              s.ws.close(1008, "World is now private");
            else send(s.ws, message);
          }
        };
        room = { world, subscribers, listener };
        world.on("event", listener);
        rooms.set(id, room);
      }
      if (room.subscribers.size >= 1100) throw Error("Room capacity");
      wss.handleUpgrade(req, socket, head, (ws) => {
        const subscriber = { ws, expires, version, alive: true };
        room!.subscribers.add(subscriber);
        metrics.sockets++;
        send(
          ws,
          JSON.stringify({
            type: "world.snapshot",
            sequence: world.sequence,
            payload: world.state,
          }),
        );
        ws.on("pong", () => (subscriber.alive = true));
        ws.on("message", () => ws.close(1008, "Read-only transport"));
        ws.on("error", () => {});
        ws.on("close", () => {
          metrics.sockets--;
          room!.subscribers.delete(subscriber);
          if (!room!.subscribers.size) {
            world.off("event", room!.listener);
            rooms.delete(id);
          }
        });
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    }
  });
  const snapshots = setInterval(() => {
    for (const room of rooms.values()) {
      const message = JSON.stringify({
        type: "world.snapshot",
        sequence: room.world.sequence,
        payload: room.world.state,
      });
      for (const s of room.subscribers) {
        if (s.version === null && !room.world.state.config.public) {
          s.ws.close(1008, "World is now private");
          continue;
        }
        if (s.expires < Date.now()) {
          s.ws.close(1008, "Expired");
          continue;
        }
        send(s.ws, message);
      }
    }
  }, 100);
  const revocations = setInterval(() => {
    for (const [id, room] of rooms) {
      if (![...room.subscribers].some((s) => s.version !== null)) continue;
      void db
        .query("SELECT token_version FROM channels WHERE id=$1", [id])
        .then(({ rows }) => {
          for (const s of room.subscribers)
            if (s.version !== null && s.version !== rows[0]?.token_version)
              s.ws.close(1008, "Revoked");
        })
        .catch(() => {
          for (const s of room.subscribers)
            s.ws.close(1011, "Database unavailable");
        });
    }
  }, 2000);
  const heartbeat = setInterval(() => {
    for (const room of rooms.values())
      for (const s of room.subscribers) {
        if (!s.alive) {
          s.ws.terminate();
          continue;
        }
        s.alive = false;
        s.ws.ping();
      }
  }, 30000);
  return () => {
    clearInterval(snapshots);
    clearInterval(revocations);
    clearInterval(heartbeat);
    for (const room of rooms.values()) {
      room.world.off("event", room.listener);
      for (const s of room.subscribers) s.ws.terminate();
    }
    rooms.clear();
    wss.close();
  };
}
