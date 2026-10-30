import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTailnetTestApp,
  TAILNET_ROOM,
} from "../apps/api/tailnet-test.js";

test("native simulator controls the selected existing actor without inventing another identity", async () => {
  delete process.env.OPENCODE_GO_API_KEY;
  const s = await createTailnetTestApp({
    host: "127.0.0.1",
    port: 3498,
    origin: "http://127.0.0.1:3498",
    timers: false,
  });
  try {
    const pair = (await s.app.inject({ url: "/v1/debug/pair" })).json();
    const headers = { authorization: `Bearer ${pair.token}` };
    const w = await s.world(TAILNET_ROOM);
    const [first, second] = w.state.avatars;
    const firstAnimation = first.animation;
    const send = (payload: Record<string, unknown>) =>
      s.app.inject({
        method: "POST",
        url: "/v1/native/chat",
        headers,
        payload,
      });
    const reply = await send({ text: "dance", actorId: second.id });
    assert.equal(reply.statusCode, 200, reply.body);
    assert.equal(reply.json().ok, true, reply.body);
    assert.equal(w.state.avatars.length, 2);
    assert.equal(
      w.state.avatars.find((a) => a.id === first.id)!.animation,
      firstAnimation,
    );
    assert.equal(
      w.state.avatars.find((a) => a.id === second.id)!.animation,
      "dance",
    );
    const absent = await send({ text: "wave", actorId: "not-in-this-room" });
    assert.equal(absent.json().code, "ACTOR_NOT_PRESENT");
    const candidate = {
      id: "confirmed-chair",
      class: "chair",
      attributes: ["world_anchor"],
      box: [0.1, 0.3, 0.2, 0.3] as [number, number, number, number],
      confidence: 0.4,
      seenAt: Date.now(),
    };
    w.updateTracks([candidate], w.state.epoch);
    assert.equal(
      w.state.tracks.length,
      0,
      "Default web observations retain the .5 threshold",
    );
    const nativeTrack = await s.app.inject({
      method: "POST",
      url: "/v1/native/tracks",
      headers,
      payload: { tracks: [candidate] },
    });
    assert.equal(nativeTrack.statusCode, 200, nativeTrack.body);
    assert.equal(
      w.state.tracks[0].confidence,
      0.4,
      "Native confidence is accepted without falsifying its score",
    );
    // Named objects can be ambiguous. A phone selection binds the precise track ID.
    await s.app.inject({
      method: "POST",
      url: "/v1/native/tracks",
      headers,
      payload: {
        tracks: [
          {
            id: "chair-left",
            class: "chair",
            attributes: [],
            box: [0.1, 0.3, 0.2, 0.3],
            confidence: 0.9,
            seenAt: Date.now(),
          },
          {
            id: "chair-right",
            class: "chair",
            attributes: [],
            box: [0.6, 0.3, 0.2, 0.3],
            confidence: 0.9,
            seenAt: Date.now(),
          },
        ],
      },
    });
    // Use the other actor to avoid the per-actor command cooldown.
    const selected = await send({
      text: "run to the chair and sit on it",
      actorId: first.id,
      targetHint: "chair-right",
    });
    assert.equal(selected.json().ok, true, selected.body);
    assert.equal(
      w.state.avatars.find((a) => a.id === first.id)!.target,
      "chair-right",
    );
    // A capture token is never permission to manufacture a viewer identity in a live room.
    w.state.mode = "LIVE TWITCH";
    const live = await send({ text: "dance", name: "Fake viewer" });
    assert.equal(live.statusCode, 403);
    assert.equal(live.json().code, "VIEWER_CONTROLLER_REQUIRED");
  } finally {
    await s.app.close();
  }
});
