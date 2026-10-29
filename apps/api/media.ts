import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Security } from "./security.js";
const Signal = z.discriminatedUnion("type", [
  z.object({ type: z.literal("offer"), sdp: z.string().max(100000) }),
  z.object({ type: z.literal("answer"), sdp: z.string().max(100000) }),
  z.object({
    type: z.literal("candidate"),
    candidate: z.string().max(5000),
    sdpMid: z.string().max(50).nullable(),
    sdpMLineIndex: z.number().int().min(0).max(20).nullable(),
  }),
  z.object({ type: z.literal("ready") }),
]);
export function installMediaRelay(
  server: Server,
  db: Database,
  security: Security,
  origin: string,
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 110000 });
  const rooms = new Map<
    string,
    Map<WebSocket, { role: string; expires: number; version: number }>
  >();
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url || "/", origin);
    if (url.pathname !== "/v1/media") return;
    try {
      if (req.headers.origin && req.headers.origin !== origin)
        throw Error("Origin");
      const authorization = req.headers.authorization;
      const payload = security.verify(
        typeof authorization === "string" && authorization.startsWith("Bearer ")
          ? authorization.slice(7)
          : url.searchParams.get("token") || "",
      );
      if (!["capture", "overlay"].includes(payload.role)) throw Error("Role");
      const channel = (
        await db.query(
          "SELECT token_version,config FROM channels WHERE id=$1",
          [payload.room],
        )
      ).rows[0];
      if (
        !channel ||
        channel.token_version !== payload.version ||
        channel.config.paused
      )
        throw Error("Revoked");
      let room = rooms.get(payload.room);
      if (!room) {
        room = new Map();
        rooms.set(payload.room, room);
      }
      if (
        [...room.values()].some((p) => p.role === payload.role) ||
        room.size >= 2
      )
        throw Error("Capacity");
      wss.handleUpgrade(req, socket, head, (ws) => {
        room!.set(ws, {
          role: payload.role,
          expires: payload.exp,
          version: payload.version,
        });
        let times: number[] = [];
        ws.on("message", (raw) => {
          try {
            times = times.filter((t) => Date.now() - t < 1000);
            if (times.length >= 30) throw Error("Rate");
            times.push(Date.now());
            const signal = Signal.parse(JSON.parse(String(raw)));
            // The server notifies the producer once when both roles are present.
            // Forwarding explicit ready messages too races two simultaneous offers.
            if (signal.type === "ready") return;
            if (
              (payload.role === "overlay" && signal.type === "offer") ||
              (payload.role === "capture" && signal.type === "answer")
            )
              throw Error("Role");
            for (const peer of room!.keys())
              if (peer !== ws && peer.readyState === WebSocket.OPEN)
                peer.send(JSON.stringify(signal));
          } catch {
            ws.close(1008, "Invalid signaling");
          }
        });
        if (room!.size === 2)
          for (const [peer, participant] of room!)
            if (
              participant.role === "capture" &&
              peer.readyState === WebSocket.OPEN
            )
              peer.send(JSON.stringify({ type: "ready" }));
        ws.on("error", () => {});
        ws.on("close", () => {
          room!.delete(ws);
          for (const peer of room!.keys())
            if (peer.readyState === WebSocket.OPEN)
              peer.close(1000, "Paired peer left");
          if (!room!.size) rooms.delete(payload.room);
        });
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    }
  });
  const timer = setInterval(() => {
    for (const [id, room] of rooms) {
      void db
        .query("SELECT token_version,config FROM channels WHERE id=$1", [id])
        .then(({ rows }) => {
          for (const [ws, p] of room)
            if (
              p.expires < Date.now() ||
              rows[0]?.token_version !== p.version ||
              rows[0]?.config.paused
            )
              ws.close(1008, "Session ended");
        })
        .catch(() => {
          for (const ws of room.keys()) ws.close(1011);
        });
    }
  }, 2000);
  return () => {
    clearInterval(timer);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}
