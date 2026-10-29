import { test } from "node:test";
import assert from "node:assert/strict";
import { createLanTestApp } from "../apps/api/lan-test.js";

test("LAN simulator pairs a native client and carries a viewer action with a private origin", async () => {
  const server = await createLanTestApp("192.168.1.20", 3400);
  try {
    const origin = server.origin;
    const login = await server.app.inject({
      method: "POST",
      url: "/v1/demo/session",
      headers: { origin },
      payload: { persona: "host" },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const me = await server.app.inject({ url: "/v1/me", headers: { cookie } });
    const pair = await server.app.inject({
      method: "POST",
      url: "/v1/creator/mobile-token",
      headers: { origin, cookie, "x-csrf-token": me.json().csrf },
      payload: { consent: true },
    });
    assert.equal(pair.statusCode, 200, pair.body);
    const token = pair.json().token;
    assert.ok(token);
    const read = () =>
      server.app.inject({
        url: "/v1/native/world",
        headers: { authorization: `Bearer ${token}` },
      });
    const snapshot = await read();
    assert.equal(snapshot.statusCode, 200);
    assert.equal(snapshot.json().mode, "SIMULATOR");
    assert.deepEqual(
      snapshot
        .json()
        .avatars.map((a: { name: string }) => a.name)
        .sort(),
      ["Emberfox", "Mossling"],
    );
    const viewer = await server.app.inject({
      method: "POST",
      url: "/v1/demo/session",
      headers: { origin },
      payload: { persona: "traveler" },
    });
    const viewerCookie = viewer.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const viewerMe = await server.app.inject({
      url: "/v1/me",
      headers: { cookie: viewerCookie },
    });
    const action = await server.app.inject({
      method: "POST",
      url: "/v1/worlds/demo-world/actions",
      headers: {
        origin,
        cookie: viewerCookie,
        "x-csrf-token": viewerMe.json().csrf,
      },
      payload: { prompt: "sit", clientRequestId: crypto.randomUUID() },
    });
    assert.equal(action.statusCode, 200, action.body);
    assert.equal(
      (await read())
        .json()
        .avatars.find((a: { name: string }) => a.name === "Mossling").animation,
      "sit",
    );
  } finally {
    await server.app.close();
  }
});

test("LAN simulator refuses public and wildcard listeners before starting", async () => {
  for (const host of [
    "0.0.0.0",
    "8.8.8.8",
    "172.32.0.1",
    "192.168.1.20.example.com",
  ])
    await assert.rejects(createLanTestApp(host, 3400), /private IPv4/);
});
