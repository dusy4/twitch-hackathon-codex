import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { Button } from "./components/motion/button/base.js";
import ClickSpark from "./components/ClickSpark/ClickSpark.js";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-600.css";
import "./style.css";

type Authorization = { token: string; channelId: string; userId: string };
declare global {
  interface Window {
    Twitch?: {
      ext: {
        onAuthorized: (callback: (auth: Authorization) => void) => void;
        actions: { requestIdShare: () => void };
        onVisibilityChanged?: (callback: (visible: boolean) => void) => void;
        viewer?: { isLinked?: boolean };
      };
    };
  }
}
const Hero = z.object({
  id: z.string(),
  name: z.string().max(50),
  cosmetic: z.string(),
  animation: z.string(),
  message: z.string(),
  color: z.string(),
  steer: z
    .object({
      x: z.number(),
      y: z.number(),
      seq: z.number(),
      until: z.number(),
    })
    .nullish(),
});
const State = z.object({
  serverTime: z.number(),
  hero: Hero.nullable(),
  targets: z
    .array(
      z.object({
        id: z.string(),
        number: z.number().nullable(),
        label: z.string(),
      }),
    )
    .max(50),
  roster: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
        animation: z.string(),
      }),
    )
    .max(30),
});
type ViewerState = z.infer<typeof State>;
const backend = (import.meta.env.VITE_EBS_ORIGIN || location.origin).replace(
  /\/$/,
  "",
);
const keyboard = import.meta.env.VITE_EXT_KEYBOARD === "true";
const overlay =
  !/(component|panel|mobile)\.html$/.test(location.pathname) &&
  new URLSearchParams(location.search).get("platform") !== "mobile";
const vectors: Record<string, [number, number]> = {
  w: [0, 1],
  ArrowUp: [0, 1],
  a: [-1, 0],
  ArrowLeft: [-1, 0],
  s: [0, -1],
  ArrowDown: [0, -1],
  d: [1, 0],
  ArrowRight: [1, 0],
};

function App() {
  const [open, setOpen] = useState(!overlay);
  const [auth, setAuth] = useState<Authorization>();
  const [state, setState] = useState<ViewerState>();
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Waiting for Twitch");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const held = useRef(new Map<string, [number, number]>());
  const current = useRef(auth);
  current.current = auth;
  const joined = useRef(false);
  joined.current = !!state?.hero;
  const lastSend = useRef(0);
  const lastVector = useRef("0,0");
  const pendingSteer = useRef(false);
  const actionPending = useRef(false);
  const authGeneration = useRef(0);
  const [streamKey, setStreamKey] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const release = () => {
    held.current.clear();
  };
  useEffect(() => {
    const ext = window.Twitch?.ext;
    if (!ext) {
      setConnection("Open inside Twitch Local Test");
      return;
    }
    ext.onAuthorized((next) => {
      release();
      authGeneration.current++;
      setAuth(next);
      setState(undefined);
      setConnection("Connecting");
      setError("");
    });
    ext.onVisibilityChanged?.((visible) => {
      if (!visible) release();
    });
    window.addEventListener("blur", release);
    const hidden = () => {
      if (document.hidden) release();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const request = async (
    path: string,
    data?: unknown,
    signal?: AbortSignal,
  ) => {
    const token = current.current?.token;
    if (!token) throw Error("Waiting for Twitch authorization");
    const response = await fetch(`${backend}/v1/ext/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal:
        path === "events"
          ? signal
          : signal
            ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000),
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Error(
        typeof body.message === "string"
          ? body.message
          : `Connection error (${response.status})`,
      );
    }
    return response;
  };
  const update = (data: unknown) => {
    const parsed = State.safeParse(data);
    if (parsed.success) {
      setState(parsed.data);
      setConnection("Live controls connected");
    } else throw Error("World state could not be read");
  };
  useEffect(() => {
    if (!auth) return;
    const controller = new AbortController();
    const generation = authGeneration.current;
    let retry: ReturnType<typeof setTimeout>;
    let stopped = false;
    const connect = async () => {
      try {
        const initial = await request("state", undefined, controller.signal);
        if (stopped || generation !== authGeneration.current) return;
        update(await initial.json());
        const response = await request("events", undefined, controller.signal);
        const reader = response.body!.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 200000) throw Error("World update too large");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const packet = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = packet
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (data && !stopped && generation === authGeneration.current)
              update(JSON.parse(data.slice(6)));
          }
        }
        if (!stopped) throw Error("Connection interrupted. Reconnecting…");
      } catch (e) {
        if (!stopped && generation === authGeneration.current) {
          release();
          setConnection("Reconnecting");
          setError((e as Error).message);
          retry = setTimeout(connect, 2000);
        }
      }
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      controller.abort();
    };
  }, [auth, streamKey]);
  useEffect(() => {
    const tick = async () => {
      if (
        !current.current ||
        !joined.current ||
        pendingSteer.current ||
        actionPending.current ||
        Date.now() - lastSend.current < 110
      )
        return;
      let x = 0,
        y = 0;
      for (const v of held.current.values()) {
        x += v[0];
        y += v[1];
      }
      x = Math.max(-1, Math.min(1, x));
      y = Math.max(-1, Math.min(1, y));
      const vector = `${x},${y}`;
      if (!x && !y && lastVector.current === vector) return;
      pendingSteer.current = true;
      lastSend.current = Date.now();
      lastVector.current = vector;
      const generation = authGeneration.current;
      try {
        const response = await request("steer", { x, y });
        if (generation === authGeneration.current)
          update(await response.json());
      } catch (e) {
        if (generation === authGeneration.current) {
          release();
          setError((e as Error).message);
        }
      } finally {
        pendingSteer.current = false;
      }
    };
    const timer = setInterval(() => void tick(), 40);
    return () => clearInterval(timer);
  }, []);
  const action = async (route: string, data: unknown) => {
    if (actionPending.current) return;
    release();
    actionPending.current = true;
    setBusy(true);
    setError("");
    // Do not send a delayed release after an emote/prompt: it would cancel that action.
    while (pendingSteer.current)
      await new Promise((resolve) => setTimeout(resolve, 20));
    lastVector.current = "0,0";
    const generation = authGeneration.current;
    try {
      const response = await request(route, data);
      if (generation === authGeneration.current) {
        update(await response.json());
        if (route === "join") setStreamKey((n) => n + 1);
      }
    } catch (e) {
      if (generation === authGeneration.current) setError((e as Error).message);
    } finally {
      setBusy(false);
      actionPending.current = false;
    }
  };
  const controls =
    !!auth &&
    !!state?.hero &&
    !busy &&
    connection === "Live controls connected";
  return (
    <div
      ref={root}
      data-ui
      className={`rift ${overlay ? "overlay" : "full"}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) release();
      }}
      onKeyDown={(e) => {
        if (
          !keyboard ||
          !controls ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.altKey ||
          e.ctrlKey ||
          e.metaKey
        )
          return;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (vectors[key]) {
          e.preventDefault();
          held.current.set(key, vectors[key]);
        }
      }}
      onKeyUp={(e) => {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (held.current.has(key)) {
          e.preventDefault();
          held.current.delete(key);
        }
      }}
    >
      {overlay && (
        <button
          className="launcher"
          aria-expanded={open}
          aria-controls="controller"
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") setOpen(true);
          }}
          onClick={() => {
            release();
            setOpen(!open);
          }}
        >
          <span className="rift-mark" aria-hidden="true">
            ▥
          </span>{" "}
          RaidRift <span className="mint">{state?.roster.length || 0}</span>
        </button>
      )}
      {open && (
        <main id="controller" aria-label="RaidRift controller" tabIndex={0}>
          <header>
            <div>
              <h1>RaidRift</h1>
              <p>Your tiny hero. Their real world.</p>
            </div>
            {overlay && (
              <button
                className="close"
                aria-label="Collapse controls"
                onClick={() => {
                  release();
                  setOpen(false);
                }}
              >
                ×
              </button>
            )}
          </header>
          <p className="connection">
            <span
              className={
                connection === "Live controls connected"
                  ? "signal ready"
                  : "signal"
              }
              aria-hidden="true"
            />
            {connection}
          </p>
          {!state?.hero ? (
            <div className="join">
              <div className="portal" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <h2>Step through the rift</h2>
              <p>Claim one hero and play alongside chat.</p>
              <Button
                className="primary"
                disabled={!auth || busy || !state}
                onClick={() => void action("join", {})}
              >
                {busy ? "Joining…" : "Join the raid"}
              </Button>
            </div>
          ) : (
            <>
              <section className="hero" aria-label="My hero">
                <div className="voxel" aria-hidden="true">
                  <i />
                  <b />
                  <span />
                </div>
                <div>
                  <h2>{state.hero.name}</h2>
                  <p>{state.hero.cosmetic || "Rift adventurer"}</p>
                  <p className="mint" role="status">
                    {connection !== "Live controls connected"
                      ? "Reconnecting controls"
                      : state.hero.steer
                        ? "Your hero is moving"
                        : state.hero.animation === "idle"
                          ? "Ready to explore"
                          : state.hero.animation}
                  </p>
                </div>
              </section>
              <p className="delay">
                Server state now. Your stream video may be delayed.
              </p>
              <section aria-label="Movement">
                <h2>Move your hero</h2>
                <div className="movement">
                  <div className="dpad">
                    {[
                      ["Forward", 0, 1, "↑"],
                      ["Left", -1, 0, "←"],
                      ["Back", 0, -1, "↓"],
                      ["Right", 1, 0, "→"],
                    ].map(([label, x, y, icon]) => (
                      <button
                        key={label}
                        className={`direction ${String(label).toLowerCase()}`}
                        aria-label={`Move ${label}`}
                        disabled={!controls}
                        onPointerDown={(e) => {
                          if (!controls) return;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          held.current.set(`touch-${e.pointerId}`, [
                            Number(x),
                            Number(y),
                          ]);
                        }}
                        onPointerUp={(e) => {
                          held.current.delete(`touch-${e.pointerId}`);
                        }}
                        onPointerCancel={(e) =>
                          held.current.delete(`touch-${e.pointerId}`)
                        }
                        onLostPointerCapture={(e) =>
                          held.current.delete(`touch-${e.pointerId}`)
                        }
                        onKeyDown={(e) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault();
                            held.current.set(`button-${label}`, [
                              Number(x),
                              Number(y),
                            ]);
                          }
                        }}
                        onKeyUp={(e) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault();
                            held.current.delete(`button-${label}`);
                          }
                        }}
                        onBlur={() => held.current.delete(`button-${label}`)}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                  <p>
                    Hold to walk
                    <br />
                    {keyboard
                      ? "WASD or arrows when focused"
                      : "Touch, or focus a direction and hold Space"}
                  </p>
                </div>
              </section>
              <section aria-label="Emotes">
                <h2>Make a little noise</h2>
                <ClickSpark
                  sparkColor={["#c79bff", "#92ffe0"]}
                  sparkCount={5}
                  shape="dot"
                  sparkRadius={16}
                >
                  <div className="emotes">
                    {["jump", "dance", "wave", "sit", "cheer"].map((emote) => (
                      <Button
                        key={emote}
                        disabled={!controls}
                        onClick={() => void action("emote", { emote })}
                      >
                        {emote}
                      </Button>
                    ))}
                  </div>
                </ClickSpark>
              </section>
              <section aria-label="Visible targets">
                <h2>On the stream</h2>
                <div className="targets">
                  {state.targets.length ? (
                    state.targets.map((t) => (
                      <button
                        key={t.id}
                        disabled={!controls}
                        onClick={() =>
                          void action("prompt", {
                            prompt: `go to ${t.number ?? t.label}`,
                            targetHint: t.id,
                          })
                        }
                      >
                        {t.number !== null && <b>{t.number}</b>}
                        {t.label}
                      </button>
                    ))
                  ) : (
                    <p>Waiting for the phone’s target markers.</p>
                  )}
                </div>
              </section>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (prompt.trim()) {
                    void action("prompt", { prompt });
                    setPrompt("");
                  }
                }}
              >
                <label htmlFor="prompt">Give your hero an idea</label>
                <div className="prompt">
                  <input
                    id="prompt"
                    maxLength={500}
                    value={prompt}
                    onFocus={release}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Go to 3 and dance"
                    disabled={!controls}
                  />
                  <Button type="submit" disabled={!controls || !prompt.trim()}>
                    Send
                  </Button>
                </div>
              </form>
            </>
          )}
          <p className="error" role="alert">
            {error}
          </p>
          <section className="roster" aria-label="Live roster">
            <h2>
              Through the rift <span>{state?.roster.length || 0}</span>
            </h2>
            <p>
              {state?.roster.length
                ? state.roster.map((a) => <span key={a.id}>{a.name}</span>)
                : "The first adventurer could be you."}
            </p>
          </section>
          <footer>
            <button
              disabled={!auth}
              onClick={() => window.Twitch?.ext.actions.requestIdShare()}
            >
              Use my Twitch identity
            </button>
            <p>
              Links your controls to your chat hero. Chat once to show your
              name.
            </p>
          </footer>
        </main>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
