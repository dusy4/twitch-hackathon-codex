import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";

test("paired media accepts native header authentication and negotiates once in either connection order", async () => {
  const security = new Security(Buffer.alloc(32, 28));
  const s = await createApp({
    db: Database.memory(),
    security,
    demo: true,
    timers: false,
  });
  const sockets: WebSocket[] = [];
  try {
    const world = await s.world("demo-world");
    world.state.config.paused = false;
    const version = (
      await s.db.query("SELECT token_version FROM channels WHERE id=$1", [
        "demo-world",
      ])
    ).rows[0].token_version;
    const address = await s.app.listen({ host: "127.0.0.1", port: 0 });
    const endpoint = address.replace("http://", "ws://") + "/v1/media";
    const token = (role: string) =>
      security.sign({
        room: "demo-world",
        role,
        version,
        exp: Date.now() + 60_000,
      });
    const connect = (native: boolean) => {
      const value = token(native ? "capture" : "overlay");
      const socket = native
        ? new WebSocket(endpoint, {
            headers: { authorization: `Bearer ${value}` },
          })
        : new WebSocket(`${endpoint}?token=${value}`);
      const messages: any[] = [];
      socket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
      socket.on("error", () => {});
      sockets.push(socket);
      return { socket, messages };
    };
    const until = async (condition: () => boolean) => {
      const end = Date.now() + 5000;
      while (!condition() && Date.now() < end) await delay(10);
      assert.ok(condition(), "Expected signaling state before timeout");
    };
    for (const firstIsNative of [true, false]) {
      const first = connect(firstIsNative);
      await once(first.socket, "open");
      const second = connect(!firstIsNative);
      await once(second.socket, "open");
      const capture = firstIsNative ? first : second;
      const receiver = firstIsNative ? second : first;
      await until(() =>
        capture.messages.some((message) => message.type === "ready"),
      );
      receiver.socket.send(JSON.stringify({ type: "ready" }));
      capture.socket.send(JSON.stringify({ type: "ready" }));
      await delay(50);
      assert.equal(
        capture.messages.filter((message) => message.type === "ready").length,
        1,
        "No duplicate offers from explicit readiness plus connection notifications",
      );
      capture.socket.send(
        JSON.stringify({ type: "offer", sdp: "bounded-offer-fixture" }),
      );
      await until(() =>
        receiver.messages.some(
          (message) => message.sdp === "bounded-offer-fixture",
        ),
      );
      receiver.socket.send(
        JSON.stringify({ type: "answer", sdp: "bounded-answer-fixture" }),
      );
      await until(() =>
        capture.messages.some(
          (message) => message.sdp === "bounded-answer-fixture",
        ),
      );
      const receiverClosed = once(receiver.socket, "close");
      const captureClosed = once(capture.socket, "close");
      capture.socket.close();
      await Promise.all([receiverClosed, captureClosed]);
    }
    const invalid = new WebSocket(endpoint, {
      headers: { authorization: `Bearer ${token("viewer")}` },
    });
    sockets.push(invalid);
    invalid.on("error", () => {});
    const rejected = await new Promise<number>((resolve) =>
      invalid.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode!);
        invalid.terminate();
      }),
    );
    assert.equal(rejected, 401);
  } finally {
    for (const socket of sockets) socket.terminate();
    await s.app.close();
  }
});
