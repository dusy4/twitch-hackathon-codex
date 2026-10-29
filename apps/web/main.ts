import "./style.css";
import { clientRequestId, copyText } from "./browser-compat.js";
import { RiftRenderer } from "./renderer.js";
import type {
  WorldSnapshot,
  QuestState,
} from "../../packages/shared/contracts.js";
import { emoteNames as allEmotes } from "../../packages/shared/animations.js";
import { buildingMaterials } from "../../packages/shared/construction.js";
import { defaultConfig } from "../../packages/shared/settings.js";
import type { DuelState } from "../../packages/shared/duels.js";
const emoteNames = allEmotes.filter(
  (name) => !["wave", "dance", "sit", "jump", "backflip"].includes(name),
);
const root = document.querySelector<HTMLDivElement>("#app")!;
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let me: any = { user: null },
  status: any = {},
  state: WorldSnapshot | null = null,
  renderer: RiftRenderer | null = null,
  socket: WebSocket | null = null,
  routeCleanup: (() => void) | null = null,
  room = new URLSearchParams(location.search).get("room") || "demo-world",
  generation = 0;
let feed: string[] = [];
let spatialView: import("./spatial-world.js").SpatialWorld | null = null;
let reconnect: ReturnType<typeof setTimeout> | null = null;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const face = (p: any) =>
  `<span class="pixel-face" style="background:${/^#[a-f0-9]{6}$/i.test(p.color) ? p.color : "#bba0ff"}">•ᴗ•</span>`;
function toast(message: string, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `visible ${error ? "error" : ""}`;
  setTimeout(() => (el.className = ""), 4500);
}
async function api(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
) {
  const res = await fetch(path, {
    signal,
    method,
    headers: {
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": me.csrf || "" } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw Error(result.message || "Request failed");
  return result;
}
async function refreshMe() {
  me = await api("/v1/me");
  renderer?.setViewerId(me.user?.id || null);
}
function bind(
  selector: string,
  action: (event: Event) => void | Promise<void>,
  event = "click",
) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.addEventListener(event, (e) => {
    const fail = (error: unknown) =>
      toast(
        error instanceof Error
          ? error.message
          : "That action could not complete.",
        true,
      );
    try {
      Promise.resolve(action(e)).catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}
function navigate(path: string) {
  history.pushState({}, "", path);
  void render();
}
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-nav]");
  if (a && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    navigate(a.getAttribute("href")!);
  }
});
addEventListener("popstate", () => void render());
async function loginDemo(persona = "traveler") {
  await api("/v1/demo/session", "POST", { persona });
  await refreshMe();
}
function shell(content: string) {
  const p = location.pathname;
  root.innerHTML = `<a class="skip" href="#main">Skip to content</a><header><a class="logo" href="/" data-nav><span class="logo-symbol">◈</span> raidrift <small>REALITY, REIMAGINED</small></a><nav aria-label="Main navigation">${[
    ["/", "Explore"],
    ["/leaderboard", "Leaderboard"],
    ["/quests", "Quests"],
    ["/shop", "The outfitter"],
    ["/dashboard", "Creator studio"],
  ]
    .map(
      ([href, name]) =>
        `<a class="${p === href ? "active" : ""}" href="${href}" data-nav>${name}</a>`,
    )
    .join(
      "",
    )}</nav><div class="account">${me.user ? `<span class="badge ${me.user.demo ? "orange" : "mint"}">${me.user.demo ? "SIMULATOR" : "TWITCH LINKED"}</span><a class="button" href="/controller" data-nav>${esc(me.user.name)} ↗</a><button id="logout" aria-label="Sign out">⇥</button>` : `<a class="button" href="/auth/twitch">Connect Twitch ↗</a>`}</div></header><main id="main">${content}</main><footer><span>◈ RaidRift · Small heroes. Shared worlds.</span><span>Original worlds & assets · <a href="/privacy" data-nav>Privacy & fair play</a></span></footer>`;
  bind("#logout", async () => {
    await api("/v1/auth/logout", "POST", {});
    await refreshMe();
    await render();
  });
}
function intro(eyebrow: string, title: string, description: string) {
  return `<div class="intro"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1></div><p>${description}</p></div>`;
}
function stageMarkup(overlay = false) {
  return `<div class="${overlay ? "overlay-stage" : "stage"}" id="stage">${overlay ? '<div class="overlay-status" id="overlay-status"></div>' : `<div class="stage-top"><span class="badge orange" id="mode">SIMULATOR · ORIGINAL WORLD PREVIEW</span><span class="badge" id="connection">CONNECTING</span></div><div class="stage-bottom"><div><div class="stage-title" id="world-title">The Violet Frontier</div><div class="stage-caption">Your community’s next chapter starts with a portal.</div></div><button id="audio" class="button">♫ Enable sound</button></div>`}</div>`;
}
function startWorld(id: string, token?: string, drawScene = true) {
  room = id;
  let closed = false;
  function connect() {
    if (closed) return;
    const params = new URLSearchParams({ room: id });
    if (token) params.set("token", token);
    const connection = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/socket?${params}`,
    );
    socket = connection;
    let lastSequence = -1;
    socket.onmessage = (e) => {
      if (closed || socket !== connection) return;
      const event = JSON.parse(e.data);
      renderer?.setServerTime(Date.parse(event.serverTime));
      spatialView?.setServerTime(Date.parse(event.serverTime));
      if (typeof event.sequence === "number") {
        if (event.sequence < lastSequence) return;
        lastSequence = event.sequence;
      }
      if (event.type === "world.snapshot") {
        state = event.payload;
        updateWorldUI();
      } else {
        if (event.type === "duel.started" || event.type === "duel.changed")
          receiveDuel(event.payload);
        if (
          event.type === "avatar.arriving" &&
          event.payload.id === me.user?.id
        )
          addFeed("Stepping through the portal");
        if (event.type === "raid.started") {
          renderer?.sound("raid", state?.config.audio);
          addFeed(
            `${event.payload.test ? "TEST RAID" : "Raid"} · ${event.payload.from} · ${event.payload.count} reported viewers`,
          );
        }
        if (event.type === "quest.completed") {
          renderer?.sound("quest", state?.config.audio);
          toast(
            `Quest complete! +${event.payload.reward} Shards to eligible players`,
          );
          void refreshMe();
        }
        if (
          event.type === "party.invitation" &&
          event.payload.to === me.user?.id
        ) {
          toast("A traveler sent a party invitation.");
          void refreshInvitations();
        }
        if (
          event.type === "action.step" &&
          event.payload.actorId === me.user?.id
        )
          addFeed(
            `Step ${event.payload.step + 1}/${event.payload.total}: ${event.payload.name || event.payload.op}`,
          );
        if (
          event.type === "action.failed" &&
          event.payload.actorId === me.user?.id
        )
          addFeed(`Action ended: ${event.payload.status}`);
      }
    };
    socket.onopen = () => {
      if (closed || socket !== connection) return;
      const c = document.querySelector("#connection");
      if (c) c.textContent = "● CONNECTED";
      document.querySelector(".connection-warning")?.remove();
    };
    socket.onclose = () => {
      if (socket !== connection) return;
      const c = document.querySelector("#connection");
      if (c) c.textContent = "RECONNECTING";
      if (!closed) {
        const stage = document.querySelector("#stage");
        if (stage && !stage.querySelector(".connection-warning")) {
          const n = document.createElement("div");
          n.className = "connection-warning";
          n.textContent = "Connection lost · reconnecting";
          stage.append(n);
        }
        reconnect = setTimeout(connect, 2500);
      }
    };
    socket.onerror = () => {};
  }
  connect();
  try {
    if (drawScene)
      renderer = new RiftRenderer(
        $("#stage"),
        () => state,
        location.pathname === "/overlay",
        false,
        me.user?.id || null,
      );
  } catch {
    const stage = $("#stage");
    stage.dataset.status =
      "3D graphics unavailable. Try enabling browser hardware acceleration.";
  }
  bind("#audio", () => {
    renderer?.unlockAudio();
    toast("Audio enabled at the creator’s configured level.");
    $("#audio").textContent = "♫ Sound armed";
  });
  routeCleanup = () => {
    closed = true;
    socket?.close();
    if (reconnect) clearTimeout(reconnect);
    renderer?.destroy();
    spatialView?.dispose();
    spatialView = null;
    renderer = null;
    state = null;
  };
}
function updateWorldUI() {
  if (!state) return;
  const set = (selector: string, text: string) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = text;
  };
  set(
    "#mode",
    state.mode === "SIMULATOR"
      ? "SIMULATOR · NOT A LIVE TWITCH BROADCAST"
      : state.mode === "LIVE TWITCH"
        ? "TWITCH WORLD · ACCOUNT LINKED"
        : "OFFLINE · TWITCH DISCONNECTED",
  );
  set("#world-title", state.config.title);
  set("#players-count", String(state.avatars.length));
  set("#raid-count", state.raid ? state.raid.count.toLocaleString() : "—");
  set("#wallet", Number(me.wallet || 0).toLocaleString());
  set(
    "#overlay-status",
    state.mode === "SIMULATOR"
      ? "SIMULATOR · TEST WORLD"
      : state.config.paused
        ? "WORLD PAUSED"
        : "",
  );
  const q = state.quests.find((q) => !q.completed) || state.quests[0];
  if (q) {
    set("#quest-title", q.title);
    set(
      "#quest-reward",
      q.completed
        ? "✓ Awarded by server"
        : `◆ +${q.reward} Shards per eligible player`,
    );
    const bar = document.querySelector<HTMLElement>("#quest-progress");
    if (bar) bar.style.width = `${q.completed ? 100 : q.progress * 100}%`;
  }
  const partySelect =
    document.querySelector<HTMLSelectElement>("#party-target");
  if (partySelect) {
    const key = state.avatars
      .filter((a) => a.id !== me.user?.id)
      .map((a) => a.id)
      .join(",");
    if (partySelect.dataset.key !== key) {
      partySelect.innerHTML =
        '<option value="">Choose a traveler</option>' +
        state.avatars
          .filter((a) => a.id !== me.user?.id)
          .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
          .join("");
      partySelect.dataset.key = key;
    }
  }
  const portalEntry =
    document.querySelector<HTMLButtonElement>("#portal-entry");
  if (portalEntry) portalEntry.disabled = state.config.paused;
  updateDuelUI();
  updateWorkshop();
  updateTargetSelect(state.tracks);
}
function updateTargetSelect(tracks: WorldSnapshot["tracks"]) {
  const targetSelect = document.querySelector<HTMLSelectElement>("#target");
  if (targetSelect) {
    const key = tracks.map((t) => t.id).join(",");
    if (targetSelect.dataset.key !== key) {
      const selected = targetSelect.value;
      targetSelect.innerHTML =
        '<option value="">Automatic target</option>' +
        tracks
          .map(
            (t) =>
              `<option value="${esc(t.id)}">${esc(t.class)} · ${Math.round(t.confidence * 100)}%</option>`,
          )
          .join("");
      targetSelect.value = selected;
      targetSelect.dataset.key = key;
    }
  }
}

function addFeed(message: string) {
  feed.unshift(message);
  feed = feed.slice(0, 12);
  const el = document.querySelector("#action-feed");
  if (el)
    el.innerHTML = feed
      .map((f) => `<div class="feed-item">${esc(f)}</div>`)
      .join("");
}
async function command(prompt: string) {
  if (!me.user) {
    if (status.mode?.includes("SIMULATOR")) await loginDemo();
    else throw Error("Connect Twitch before controlling your avatar.");
  }
  const targetHint =
    document.querySelector<HTMLSelectElement>("#target")?.value || undefined;
  const action = await api(
    `/v1/worlds/${encodeURIComponent(room)}/actions`,
    "POST",
    { prompt, clientRequestId: clientRequestId(), targetHint },
  );
  addFeed(action.message || `Action ${action.status}`);
  await refreshMe();
  updateWorldUI();
}
function requireAccount(content: string, creator = false) {
  if (me.user && (!creator || me.channel)) return false;
  shell(
    `${intro(creator ? "CREATOR ONBOARDING" : "YOUR ADVENTURE", creator ? "Give chat a <em>world.</em>" : "A tiny hero.<br><em>Entirely yours.</em>", creator ? "Connect your Twitch account, install one browser source, and open the rift." : "One persistent avatar follows you between participating worlds.")}<div class="panel"><h2>${creator ? "Connect your channel" : "Join the adventure"}</h2><p class="muted" style="margin:15px 0">${content}</p><a class="button primary" href="/auth/twitch${creator ? "?role=creator" : ""}">Connect Twitch ↗</a>${status.mode?.includes("SIMULATOR") ? ` <button id="demo-account">Try ${creator ? "creator" : "viewer"} simulator</button>` : ""}<div class="notice">Twitch integration status: ${esc(status.twitch)}. Simulator accounts are labelled and separate from real Twitch identities.</div></div>`,
  );
  bind("#demo-account", async () => {
    await loginDemo(creator ? "host" : "traveler");
    await render();
  });
  return true;
}
async function home() {
  const data = await api("/v1/live");
  const first = data.worlds.find((w: any) => w.id === room) || data.worlds[0];
  shell(
    `${intro("A NEW WAY TO BELONG", "Your stream.<br><em>Their little universe.</em>", "Turn raids into portals and viewers into tiny heroes. <strong>Let your community become part of the world.</strong>")}<div class="stage-grid">${stageMarkup()}<aside class="panel"><div class="eyebrow">STEP THROUGH THE RIFT</div><div class="world-status"><span class="world-avatar">✦</span><div><strong>${esc(first?.creator || "No connected creator")}</strong><div class="muted small">${esc(first?.mode || "Connect Twitch to begin")}</div></div></div><div class="stat-grid"><div><strong id="players-count">0</strong><span>CLAIMED HEROES</span></div><div><strong id="raid-count">—</strong><span>REPORTED RAID SIZE</span></div></div><button class="primary full" id="join">Enter the world ↗</button><button class="full" id="preview-raid">Try a portal event</button><div class="quest"><span class="eyebrow">COMMUNITY QUEST</span><strong id="quest-title">A little rift celebration</strong><p class="muted small">Dance together. The server verifies the moment and awards the adventure.</p><div class="bar"><span id="quest-progress" style="width:0%"></span></div><div class="reward" id="quest-reward">◆ +40 Shards · verified game state</div></div></aside></div><div class="section-note">◌ ${esc(first?.mode || "OFFLINE")} · Stage preview is original generated scenery. Camera processing is off.</div><div class="section-heading"><h2>More than a moment on stream.</h2><a href="/live" data-nav>Discover worlds ↗</a></div><div class="features"><a class="feature" href="/controller" data-nav><span class="number">01 / BECOME SOMETHING SMALL</span><span class="icon">♟</span><h3>Your own pocket adventurer</h3><p>Jump, dance, make a little magic. Your character travels with you.</p></a><a class="feature" href="/dashboard" data-nav><span class="number">02 / MAKE AN ENTRANCE</span><span class="icon">◈</span><h3>Raids that open worlds</h3><p>A violet rift. A crowd of newcomers. One shared beginning.</p></a><a class="feature" href="/leaderboard" data-nav><span class="number">03 / LEAVE YOUR MARK</span><span class="icon">✧</span><h3>Earn your place in the story</h3><p>Verified quests, persistent Shards, and cosmetic treasures to call your own.</p></a></div>`,
  );
  if (first) startWorld(first.id);
  bind("#join", async () => {
    if (!me.user) {
      if (first?.id.startsWith("demo")) await loginDemo();
      else {
        location.href = "/auth/twitch";
        return;
      }
    }
    await api(`/v1/worlds/${room}/join`, "POST", {
      entrance: !state?.config.paused,
    });
    navigate(`/controller?room=${encodeURIComponent(room)}`);
  });
  bind("#preview-raid", async () => {
    if (!first?.id.startsWith("demo")) {
      navigate("/dashboard");
      return;
    }
    await loginDemo("host");
    await api("/v1/creator/test-raid", "POST", { count: 247 });
    await refreshMe();
    toast(
      "Simulator raid · 247 reported viewers, bounded anonymous visual crowd.",
    );
  });
}
async function leaderboard() {
  const params = new URLSearchParams(location.search);
  const period = params.get("period") || "week",
    type = params.get("type") || "players",
    search = params.get("search") || "";
  const data = await api(
    `/v1/leaderboard?${new URLSearchParams({ period, type, search, ...(params.get("season") ? { season: params.get("season")! } : {}) })}`,
  );
  shell(
    `${intro("THE HALL OF LITTLE LEGENDS", "Small heroes.<br><em>Remarkable company.</em>", "Every Shard has a story. Rankings come from verified earnings, so spending on your next look never costs you your place.")}<div class="toolbar"><div class="tabs" aria-label="Leaderboard category">${["players", "streamers", "factions"].map((t) => `<button data-type="${t}" class="${t === type ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><span class="badge orange">${esc(data.mode)}</span></div>${
      data.rows.length
        ? `<div class="podium">${data.rows
            .slice(0, 3)
            .map(
              (p: any) =>
                `<div class="panel"><span class="rank">${p.rank.toString().padStart(2, "0")}</span>${face(p)}<div><strong>${esc(p.name)}</strong><div class="shards small">◆ ${Number(p.score).toLocaleString()} earned</div></div></div>`,
            )
            .join("")}</div>`
        : ""
    }<div class="toolbar"><div class="tabs" aria-label="Ranking period">${["week", "month", "season", "all"].map((t) => `<button data-period="${t}" class="${t === period ? "active" : ""}">${({ week: "This week", month: "This month", season: "Season", all: "All time" } as any)[t]}</button>`).join("")}</div><label><span class="small">Find a hero</span><input id="search" placeholder="Search the leaderboard…" value="${esc(search)}"></label></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>${esc(type)}</th><th>Verified earnings</th><th>World</th><th></th></tr></thead><tbody>${data.rows.map((p: any) => `<tr><td>${String(p.rank).padStart(2, "0")}</td><td><div class="player-cell">${face(p)}<strong>${esc(p.name)}</strong></div></td><td class="shards">◆ ${Number(p.score).toLocaleString()}</td><td><span class="badge ${p.demo ? "orange" : "mint"}">${p.demo ? "SIMULATOR" : "VERIFIED LEDGER"}</span></td><td>${type === "players" ? `<a href="/players/${encodeURIComponent(p.id)}" data-nav aria-label="View ${esc(p.name)} profile">↗</a>` : ""}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">The story is just beginning. Complete a verified quest to enter the ranks.</td></tr>'}</tbody></table></div><div class="notice">${data.myRank ? `Your rank: #${data.myRank.rank} - ${Number(data.myRank.score).toLocaleString()} verified earnings` : `${me.user ? "Your public rank appears after an eligible earning." : "Connect Twitch to see your own rank."}`}</div><div class="section-note"><span id="rank-updated">Checked ${new Date(data.updatedAt).toLocaleTimeString()}</span> - ${esc(data.semantics)} · Updated ${new Date(data.updatedAt).toLocaleTimeString()}</div><div class="notice">Archived seasons use calendar quarters in UTC. <button id="archive">View current-year Q1 archive</button></div>`,
  );
  function filter(k: string, v: string) {
    const p = new URLSearchParams(location.search);
    p.set(k, v);
    navigate(`/leaderboard?${p}`);
  }
  document
    .querySelectorAll<HTMLElement>("[data-period]")
    .forEach((el) => (el.onclick = () => filter("period", el.dataset.period!)));
  document
    .querySelectorAll<HTMLElement>("[data-type]")
    .forEach((el) => (el.onclick = () => filter("type", el.dataset.type!)));
  let timer: ReturnType<typeof setTimeout>;
  bind(
    "#search",
    () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => filter("search", $<HTMLInputElement>("#search").value),
        500,
      );
    },
    "input",
  );
  bind("#archive", () => filter("season", `${new Date().getUTCFullYear()}-Q1`));
  const path = location.pathname + location.search;
  const fingerprint = JSON.stringify(data.rows);
  const refresh = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void api(
      `/v1/leaderboard?${new URLSearchParams({ period, type, search, ...(params.get("season") ? { season: params.get("season")! } : {}) })}`,
    )
      .then((latest) => {
        if (location.pathname + location.search !== path) return;
        const checked = document.querySelector("#rank-updated");
        if (checked)
          checked.textContent = `Checked ${new Date(latest.updatedAt).toLocaleTimeString()}`;
        if (
          JSON.stringify(latest.rows) !== fingerprint &&
          !["INPUT", "SELECT", "BUTTON"].includes(
            document.activeElement?.tagName || "",
          )
        )
          void render();
      })
      .catch(() => {
        const checked = document.querySelector("#rank-updated");
        if (checked)
          checked.textContent = "Connection interrupted - rankings will retry";
      });
  }, 5000);
  routeCleanup = () => {
    clearTimeout(timer);
    clearInterval(refresh);
  };
}
async function controller() {
  const controllerGeneration = generation;
  if (
    requireAccount(
      "Connect your account to claim a character and control only your own avatar.",
    )
  )
    return;
  const worlds = await api("/v1/live");
  room =
    new URLSearchParams(location.search).get("room") ||
    worlds.worlds[0]?.id ||
    room;
  await api(`/v1/worlds/${room}/join`, "POST", {});
  await refreshMe();
  const history = await api("/v1/me/actions");
  if (controllerGeneration !== generation) return;
  shell(
    `${intro("YOUR POCKET ADVENTURER", `Hello, <em>${esc(me.user.name)}.</em>`, "A wave, a dance, a tiny dragon. Pick a world and make a little mischief.")}<div class="columns"><div class="stack">${stageMarkup()}<div class="panel"><h3>Tell your hero what happens next.</h3><form id="command-form"><div class="field-row"><input id="prompt" aria-label="Avatar instruction" maxlength="500" placeholder="Sprint towards the dog and sit on it…" required><button class="primary" type="submit">Make it happen ↗</button></div></form><div class="form-grid"><label>World<select id="world-select">${worlds.worlds.map((w: any) => `<option value="${esc(w.id)}" ${w.id === room ? "selected" : ""}>${esc(w.title)} · ${esc(w.mode)}</option>`).join("")}</select></label><label>Visible target<select id="target"><option value="">Automatic target</option></select></label></div><div class="small muted">Camera actions require the creator’s active, calibrated capture source. Missing or ambiguous targets stop with an explanation.</div></div></div><aside class="stack"><div class="panel"><div class="eyebrow">PLAYER CONTROLLER</div><div class="world-status">${face(me.user)}<div><strong>${esc(me.user.name)}</strong><div class="small shards">◆ <span id="wallet">${Number(me.wallet).toLocaleString()}</span> spendable Shards</div></div></div><div class="dpad"><span></span><button data-command="up" aria-label="Move up">↑</button><span></span><button data-command="left" aria-label="Move left">←</button><button data-command="jump">⤒</button><button data-command="right" aria-label="Move right">→</button><span></span><button data-command="down" aria-label="Move down">↓</button><span></span></div><div class="command-buttons">${["wave", "dance", "sit", "jump", "backflip", "stop"].map((c) => `<button data-command="${c}">${c}</button>`).join("")}</div><div class="notice small">Keyboard: arrow keys move, Space jumps. Chat also accepts !rift and !ourapp.</div><details style="margin-top:18px"><summary>More emotes (${emoteNames.length})</summary><div class="command-buttons">${emoteNames.map((name) => `<button data-command="${name}">${name.replaceAll("_", " ")}</button>`).join("")}</div></details><button id="dragon" class="full">✧ Summon a tiny dragon</button></div><div class="panel"><h3>A moment together</h3><label style="margin-top:15px">Invite a hero<select id="party-target"><option value="">Choose a traveler</option></select></label><label>Activity<select id="party-kind"><option value="dance">Shared dance</option><option value="wave">Shared wave</option><option value="duel">Friendly wizard duel</option></select></label><button id="invite-dance" class="full">Send invitation</button><button id="refresh-invites" class="full">Check invitations</button><div id="invitations" class="feed"></div><div id="duel-panel" aria-live="polite"></div></div><div class="panel"><h3>Your story, as it happens</h3><div id="action-feed" class="feed"><div class="muted small">Your approved actions appear here.</div></div></div><div class="panel"><h3>A little rift celebration</h3><p class="muted small" id="quest-title">Dance for two seconds to complete the starter quest.</p><div class="bar"><span id="quest-progress" style="width:0%"></span></div><div class="shards small" id="quest-reward">◆ +40 Shards</div></div></aside></div>`,
  );
  startWorld(room);
  for (const action of history.actions.slice(0, 8).reverse())
    addFeed(`${action.plan?.message || "Previous action"} · ${action.status}`);
  document
    .querySelectorAll<HTMLElement>("[data-command]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          void command(el.dataset.command!).catch((e) =>
            toast(e.message, true),
          )),
    );
  bind(
    "#command-form",
    async (e) => {
      e.preventDefault();
      const prompt = $<HTMLInputElement>("#prompt");
      await command(prompt.value);
      prompt.value = "";
    },
    "submit",
  );
  bind("#invite-dance", async () => {
    const target = $<HTMLSelectElement>("#party-target").value;
    if (!target) throw Error("Choose a traveler who has joined this world.");
    await api("/v1/parties/invite", "POST", {
      channelId: room,
      inviteeId: target,
      kind: $<HTMLSelectElement>("#party-kind").value,
    });
    toast("Invitation sent. Their avatar moves only if they accept.");
  });
  bind("#refresh-invites", () => refreshInvitations());
  void refreshInvitations();
  const workshopLink = document.createElement("a");
  workshopLink.className = "small muted";
  workshopLink.style.cssText = "display:block;margin-top:12px";
  workshopLink.href = `/workshop?room=${encodeURIComponent(room)}`;
  workshopLink.dataset.nav = "";
  workshopLink.textContent = "Community workshop ↗";
  $("#dragon").after(workshopLink);
  const portalEntry = document.createElement("button");
  portalEntry.id = "portal-entry";
  portalEntry.className = "primary full";
  portalEntry.textContent = "Step through the portal";
  $("#dragon").before(portalEntry);
  bind("#portal-entry", async () => {
    await api(`/v1/worlds/${encodeURIComponent(room)}/join`, "POST", {
      entrance: true,
    });
    toast("Your character is entering through the portal.");
  });
  bind("#dragon", () => command("summon a tiny dragon and ride it"));
  bind(
    "#world-select",
    () =>
      navigate(
        `/controller?room=${encodeURIComponent($<HTMLSelectElement>("#world-select").value)}`,
      ),
    "change",
  );
  const keyboard = (e: KeyboardEvent) => {
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes(
        (e.target as HTMLElement).tagName,
      )
    )
      return;
    const c = (
      {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        " ": "jump",
      } as any
    )[e.key];
    if (c) {
      e.preventDefault();
      void command(c).catch((error) => toast(error.message, true));
    }
  };
  addEventListener("keydown", keyboard);
  const prior = routeCleanup;
  routeCleanup = () => {
    prior?.();
    removeEventListener("keydown", keyboard);
  };
}
function receiveDuel(duel: DuelState) {
  if (!state || !duel.players.includes(me.user?.id)) return;
  const existing = state.duels?.find((d) => d.id === duel.id);
  if (existing && existing.revision > duel.revision) return;
  state.duels = [...(state.duels || []).filter((d) => d.id !== duel.id), duel];
  updateDuelUI();
}
function updateDuelUI() {
  const el = document.querySelector<HTMLElement>("#duel-panel");
  if (!el || !state || !me.user) return;
  const duel = [...(state.duels || [])]
    .reverse()
    .find((d) => d.players.includes(me.user.id));
  const key = duel ? `${duel.id}:${duel.revision}:${duel.status}` : "none";
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  if (!duel) {
    el.innerHTML =
      '<p class="small muted">Duels are turn-based, require both players’ consent, and award no Shards.</p>';
    return;
  }
  const names = duel.players.map(
    (id) => state!.avatars.find((a) => a.id === id)?.name || "Traveler",
  );
  const mine = duel.players.indexOf(me.user.id);
  const myTurn = duel.turn === me.user.id;
  el.innerHTML = `<h3 style="margin-top:20px">Wizard duel</h3><p class="small">${names.map((name, i) => `${esc(name)}: ${duel.health[i]}/3 hearts · ${duel.charge[i]} charge${duel.shield[i] ? " · shield" : ""}`).join("<br>")}</p><p class="small">${esc(duel.message)}</p>${duel.status === "active" ? `<p class="small"><strong>${myTurn ? "Your turn" : `${esc(names[1 - mine])}’s turn`}</strong> · 60-second turns</p><div class="command-buttons">${["cast", "shield", "charge"].map((move) => `<button data-duel-move="${move}" ${!myTurn || (move === "charge" && duel.charge[mine] >= 2) ? "disabled" : ""}>${move}</button>`).join("")}<button data-duel-move="leave">Leave duel</button></div><p class="small muted">Cast deals 1 + charge (max 3). Shield absorbs 1 from the next incoming cast. Charge replaces your shield. The challenger opens.</p>` : `<p class="small">${duel.winner ? `${esc(names[duel.players.indexOf(duel.winner)])} won. No Shards awarded.` : "Duel cancelled."}</p>`}`;
  el.querySelectorAll<HTMLButtonElement>("[data-duel-move]").forEach(
    (button) =>
      (button.onclick = () => {
        button.disabled = true;
        void api(
          `/v1/worlds/${encodeURIComponent(room)}/duels/${encodeURIComponent(duel.id)}/moves`,
          "POST",
          {
            move: button.dataset.duelMove,
            revision: duel.revision,
            clientRequestId: clientRequestId(),
          },
        ).catch((error) => {
          el.dataset.key = "";
          toast(error.message, true);
          updateDuelUI();
        });
      }),
  );
}
async function refreshInvitations() {
  const element = document.querySelector("#invitations");
  if (!element || !me.user) return;
  const data = await api("/v1/parties/invitations");
  element.innerHTML =
    data.invitations
      .map(
        (i: any) =>
          `<button data-invite="${esc(i.id)}">Accept ${esc(i.kind)} invitation</button>`,
      )
      .join("") || '<span class="small muted">No pending invitations.</span>';
  document.querySelectorAll<HTMLElement>("[data-invite]").forEach(
    (el) =>
      (el.onclick = () =>
        void api(`/v1/parties/${el.dataset.invite}/accept`, "POST", {})
          .then((result) => {
            if (result.duel) receiveDuel(result.duel);
            toast("Invitation accepted.");
            return refreshInvitations();
          })
          .catch((e) => toast(e.message, true))),
  );
}
async function dashboard() {
  if (
    requireAccount(
      "Creator tools include an OBS source, conservative performance presets, camera permissions, moderation and a kill switch.",
      true,
    )
  )
    return;
  const data = await api("/v1/creator/config");
  const config = data.config;
  shell(
    `${intro("CREATOR STUDIO", "A world with<br><em>your fingerprints.</em>", "Set the tone, invite the community, and keep the controls close. Everything starts with one OBS browser source.")}<div class="columns"><div class="stack"><div class="panel"><div class="eyebrow">01 / BRING THE WORLD ON STREAM</div><h2>Open the rift in OBS</h2><p class="muted" style="margin:15px 0">Add a Browser Source at your canvas resolution (1920 × 1080 by default), paste the generated URL, and place it above your video.</p><button id="overlay-token" class="primary">Generate / rotate overlay URL ↗</button><div id="overlay-url" class="code">Overlay tokens are read-only and stay valid until you rotate them.</div><button id="copy-overlay">Copy source URL</button> <button id="open-overlay">Open source preview</button><div class="notice">OBS audio: enable “Control audio via OBS” and set monitoring in Advanced Audio Properties. In Interact, arm sound once. Original synthesized cues respect the volume below.</div></div><form class="panel" id="config-form"><div class="eyebrow">02 / SET THE TONE</div><h2>Your world, your rules.</h2><div class="form-grid"><label>World name<input name="title" maxlength="80" value="${esc(config.title)}" required></label><label>Chaos level<select name="chaos">${["cozy", "standard", "mayhem"].map((c) => `<option ${config.chaos === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>Visible crowd budget<input name="density" type="number" min="5" max="150" value="${config.density}"></label><label>Maximum claimed heroes<input name="maxPlayers" type="number" min="1" max="1000" value="${config.maxPlayers}"></label><label>Sound level (0–0.5)<input name="audio" type="number" step="0.01" min="0" max="0.5" value="${config.audio}"></label></div><div class="stack">${[
      ["public", "Public discovery"],
      ["reducedMotion", "Reduced motion"],
      [
        "ai",
        "Enable advanced AI choreography (requires authorized server connection)",
      ],
      [
        "vision",
        "Consent to processing selected camera source for ephemeral object anchors",
      ],
      ["construction", "Allow community structures to persist for 24 hours"],
      ["paused", "Pause all world activity"],
    ]
      .map(
        ([key, label]) =>
          `<label class="check"><input name="${key}" type="checkbox" ${config[key] ? "checked" : ""}>${label}</label>`,
      )
      .join(
        "",
      )}</div><div class="form-grid"><label>OBS canvas width<input name="width" type="number" value="${config.geometry.width}"></label><label>OBS canvas height<input name="height" type="number" value="${config.geometry.height}"></label><label class="check"><input name="mirror" type="checkbox" ${config.geometry.mirror ? "checked" : ""}>Mirror source</label><label>Rotation<select name="rotation">${["0", "90", "180", "270"].map((r) => `<option ${r === config.geometry.rotation ? "selected" : ""}>${r}</option>`).join("")}</select></label>${["Left", "Top", "Right", "Bottom"].map((label, i) => `<label>Crop ${label.toLowerCase()} (0–0.95)<input name="crop${i}" type="number" min="0" max="0.95" step="0.01" value="${config.geometry.crop[i]}"></label>`).join("")}${["Output left", "Output top", "Output width", "Output height"].map((label, i) => `<label>${label} (normalized)<input name="viewport${i}" type="number" min="0" max="1" step="0.01" value="${(config.geometry.viewport || [0, 0, 1, 1])[i]}"></label>`).join("")}</div><button class="primary">Save world settings</button></form><div class="panel"><div class="eyebrow">03 / A SHARED ADVENTURE</div><h2>Create a verified quest</h2><form id="quest-form"><div class="form-grid"><label>Quest title<input name="title" maxlength="80" value="Dance at the edge of the universe" required></label><label>Action<select name="action"><option>dance</option><option>wave</option><option>sit</option><option>cheer</option></select></label><label>Near a visible object<select name="targetClass"><option value="">Anywhere</option><option value="dog">dog</option><option value="bench">bench</option><option value="bicycle">bicycle</option></select></label><label>Distinct players<input name="minPlayers" type="number" min="1" max="20" value="3"></label><label>Reward per hero<input name="reward" type="number" min="1" max="100" value="40"></label></div><button>Create virtual quest</button></form><div class="notice">Virtual quests are verified by server state. Camera and hybrid rewards remain experimental and are disabled by default pending calibration.</div></div><div class="panel"><h3>Moderation</h3><form id="ban-form"><div class="field-row"><input id="ban-account" placeholder="Player account ID" aria-label="Account ID to ban" required><button class="danger">Ban from this world</button></div></form></div></div><aside class="stack"><div class="panel"><div class="eyebrow">YOUR CONTROL ROOM</div><div class="badge ${me.user.demo ? "orange" : "mint"}">${me.user.demo ? "SIMULATOR" : "TWITCH CONNECTED"}</div><div class="stat-grid"><div><strong id="players-count">0</strong><span>CLAIMED HEROES</span></div><div><strong id="raid-count">—</strong><span>REPORTED RAID</span></div></div><label>Test raid size<input id="raid-size" type="number" value="247" min="1" max="10000"></label><button id="test-raid" class="full">◈ Run a labelled test raid</button><button id="stop" class="full danger">■ Emergency stop</button><a class="button full" href="/capture" data-nav>Open camera companion ↗</a><a class="button full" href="/controller?room=${encodeURIComponent(data.channelId)}" data-nav>Enter your world ↗</a><button id="mobile-pair" class="full">Pair native AR + share composed video</button><div id="mobile-pairing" class="code" hidden></div><button id="subscriptions" class="full">Reconcile Twitch subscriptions</button><button id="disconnect" class="full danger">Disconnect Twitch</button></div><div class="panel"><h3>Integration health</h3><div id="health"></div></div><div class="notice warning">Native AR is a separate mobile capture mode. This browser overlay uses explicitly labelled screen-space positioning.</div></aside></div>`,
  );
  let overlayUrl = "";
  bind("#overlay-token", async () => {
    const d = await api("/v1/creator/overlay-token/rotate", "POST", {});
    overlayUrl = d.url;
    $("#overlay-url").textContent = overlayUrl;
    toast("Previous source links revoked. Rotate again to revoke this one.");
  });
  bind("#copy-overlay", async () => {
    if (!overlayUrl) throw Error("Generate the source URL first.");
    await copyText(overlayUrl);
    toast("OBS source URL copied");
  });
  bind("#open-overlay", () => {
    if (!overlayUrl) throw Error("Generate the source URL first.");
    window.open(overlayUrl, "_blank", "noopener");
  });
  bind(
    "#config-form",
    async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget as HTMLFormElement);
      const next = {
        ...config,
        title: String(f.get("title")),
        chaos: String(f.get("chaos")),
        density: Number(f.get("density")),
        maxPlayers: Number(f.get("maxPlayers")),
        audio: Number(f.get("audio")),
        geometry: {
          width: Number(f.get("width")),
          height: Number(f.get("height")),
          viewport: [0, 1, 2, 3].map((i) => Number(f.get(`viewport${i}`))),
          crop: [0, 1, 2, 3].map((i) => Number(f.get(`crop${i}`))),
          mirror: f.has("mirror"),
          rotation: String(f.get("rotation")),
        },
      };
      for (const key of [
        "public",
        "reducedMotion",
        "ai",
        "vision",
        "paused",
        "construction",
      ])
        next[key] = f.has(key);
      await api("/v1/creator/config", "PATCH", next);
      toast("World settings saved");
      await refreshMe();
    },
    "submit",
  );
  bind("#test-raid", async () => {
    await api("/v1/creator/test-raid", "POST", {
      count: Number($<HTMLInputElement>("#raid-size").value),
    });
    toast(
      "Test raid sent to the overlay. No invented player accounts or rewards.",
    );
  });
  bind("#stop", async () => {
    await api("/v1/creator/emergency-stop", "POST", {});
    toast("World paused. Camera processing and active actions stopped.");
    await render();
  });
  bind("#mobile-pair", async () => {
    const d = await api("/v1/creator/mobile-token", "POST", { consent: true });
    const el = $("#mobile-pairing");
    el.hidden = false;
    el.className = "panel";
    el.innerHTML = `<h4>Connect your Android camera</h4>
      <p>Install RaidRift on your Android phone. In Pair room, enter this server and pairing token.</p>
      <label>Server<input readonly value="${esc(d.server)}"></label>
      <label>24-hour pairing token<input id="mobile-capture-token" type="password" readonly autocomplete="off" value="${esc(d.token)}"></label>
      <button id="copy-mobile-token">Copy pairing token</button>
      <p>In the phone app, choose Broadcast and enter your existing SRT or RTMPS ingest. Add your relay's watch feed to your existing OBS scene.</p>
      <details><summary>WebRTC watch feed for OBS</summary>
        <p>If your relay or private receiver bridge provides a WHEP watch URL, use it here to create an OBS Browser Source with automatic frozen-frame clearing.</p>
        <label>Private WHEP watch URL<input id="mobile-relay-watch" type="password" autocomplete="off" spellcheck="false" placeholder="https://relay.example/live/whep"></label>
        <button id="copy-relay-receiver">Copy OBS Browser Source URL</button>
      </details>
      <details><summary>Experimental LAN video-only receiver</summary>
        <label>LAN receiver URL<input type="password" readonly autocomplete="off" value="${esc(d.receiverUrl)}"></label>
        <button id="copy-lan-receiver">Copy LAN receiver URL</button>
      </details>`;
    bind("#copy-mobile-token", async () => {
      await copyText(d.token);
      toast("Pairing token copied. Keep it private.");
    });
    bind("#copy-lan-receiver", async () => {
      await copyText(d.receiverUrl);
      toast("Experimental LAN receiver URL copied.");
    });
    bind("#copy-relay-receiver", async () => {
      const { relayEndpoint } = await import("./relay-receiver.js");
      const endpoint = relayEndpoint(
        $<HTMLInputElement>("#mobile-relay-watch").value.trim(),
      );
      await copyText(
        `${location.origin}/relay-receiver#source=${encodeURIComponent(endpoint.href)}`,
      );
      toast(
        "OBS Browser Source URL copied. It contains your private watch address.",
      );
    });
    toast(
      "24-hour pairing created. Camera sharing begins only after consent in the native app.",
    );
  });
  bind("#subscriptions", async () => {
    const d = await api("/v1/creator/subscriptions/reconcile", "POST", {});
    toast(JSON.stringify(d.subscriptions));
  });
  bind("#disconnect", async () => {
    await api("/v1/creator/disconnect", "POST", {});
    toast("Twitch disconnected and overlay tokens revoked.");
    await render();
  });
  bind(
    "#quest-form",
    async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget as HTMLFormElement);
      const action = String(f.get("action"));
      const targetClass = String(f.get("targetClass") || "") || null;
      await api("/v1/creator/quests", "POST", {
        title: String(f.get("title")),
        type: "virtual",
        action,
        targetClass,
        minPlayers: Number(f.get("minPlayers")),
        // Short emotes last 2s; the hold must finish inside the animation.
        sustainMs: targetClass || action === "dance" ? 2000 : 1500,
        reward: Number(f.get("reward")),
      });
      toast("Quest activated. Rewards require qualifying server state.");
    },
    "submit",
  );
  bind(
    "#ban-form",
    async (e) => {
      e.preventDefault();
      await api("/v1/creator/moderation/ban", "POST", {
        accountId: $<HTMLInputElement>("#ban-account").value,
        reason: "Creator moderation",
      });
      toast("Player banned from this world.");
    },
    "submit",
  );
  const health = await api("/v1/creator/health");
  $("#health").innerHTML = Object.entries({
    ...health,
    twitch: status.twitch,
    ai: status.ai,
  })
    .map(
      ([k, v]) =>
        `<div class="key-value"><span>${esc(k)}</span><span>${esc(v)}</span></div>`,
    )
    .join("");
}
async function shop() {
  const { catalog } = await api("/v1/shop");
  let owned: string[] = [];
  if (me.user)
    owned = (await api("/v1/me/inventory")).items.map((i: any) => i.item_id);
  shell(
    `${intro("THE OUTFITTER", "A little more<br><em>you, in every pixel.</em>", "Made for adventures. Earn Rift Shards through verified play, then find a look that feels like home.")}<div class="toolbar"><span class="muted">Original voxel cosmetics · No cash value</span><span class="badge mint">◆ ${Number(me.wallet || 0).toLocaleString()} SPENDABLE SHARDS</span></div>${
      me.user
        ? `<section class="panel" id="equipment" style="margin-bottom:24px"><h2>Your equipped treasures</h2><p class="muted small">Wear a skin, hat, and pet together. Removing an item keeps it in your collection.</p>${[
            "skin",
            "hat",
            "pet",
          ]
            .map((slot) => {
              const id = me.user.equipment?.[slot];
              return `<div class="key-value"><span>${esc(slot)} · ${esc(catalog.find((item: any) => item.id === id)?.name || "None")}</span>${id ? `<button data-unequip="${slot}">Remove ${slot}</button>` : ""}</div>`;
            })
            .join("")}</section>`
        : ""
    }<div class="shop-grid">${catalog.map((item: any) => `<article class="panel shop-item"><div class="shop-art">${face(item)}</div><div class="eyebrow">${esc(item.slot)} / ORIGINAL COLLECTION</div><h3>${esc(item.name)}</h3><div class="price">◆ ${item.price} Rift Shards</div><p class="small muted">Cosmetic only. Your competitive earnings stay yours.</p><button data-item="${esc(item.id)}" data-owned="${owned.includes(item.id)}" class="${owned.includes(item.id) ? "primary" : ""}">${owned.includes(item.id) ? (me.user?.equipment?.[item.slot] === item.id ? "Equipped" : "Equip cosmetic") : "Unlock with Shards"}</button></article>`).join("")}</div>`,
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-unequip]")
    .forEach((button) => {
      button.onclick = () =>
        void (async () => {
          await api(`/v1/me/equipment/${button.dataset.unequip}`, "DELETE");
          await refreshMe();
          await render();
          toast("Item removed. It is still in your collection.");
        })().catch((e) => toast(e.message, true));
    });
  document.querySelectorAll<HTMLElement>("[data-item]").forEach(
    (el) =>
      (el.onclick = () =>
        void (async () => {
          if (!me.user)
            throw Error("Connect Twitch or enter the simulator first.");
          if (el.dataset.owned === "true")
            await api(`/v1/me/cosmetics/${el.dataset.item}/equip`, "POST", {});
          else
            await api("/v1/shop/orders", "POST", {
              itemId: el.dataset.item,
              idempotencyKey: clientRequestId(),
            });
          await refreshMe();
          toast(
            el.dataset.owned === "true"
              ? "Your new look is equipped."
              : "Cosmetic unlocked. Equip it to see it in the world.",
          );
          await render();
        })().catch((e) => toast(e.message, true))),
  );
}
async function quests() {
  const data = await api("/v1/quests");
  shell(
    `${intro("THE QUEST JOURNAL", "Good things happen<br><em>together.</em>", "Small challenges make shared stories. Every reward is verified and recorded by the server.")}<div class="features">${data.quests.map((q: any) => `<article class="panel"><span class="badge ${q.active ? "mint" : ""}">${q.active ? "ACTIVE" : "COMPLETED"} · ${esc(q.definition.type)}</span><h3 style="margin:20px 0 10px">${esc(q.definition.title)}</h3><p class="muted small">${q.definition.minPlayers} distinct hero${q.definition.minPlayers === 1 ? "" : "es"} · ${esc(q.definition.action)} for ${q.definition.sustainMs / 1000} seconds.</p><div class="shards" style="margin:20px 0">◆ +${q.definition.reward} Shards per eligible player</div><a class="button" href="/controller?room=${encodeURIComponent(q.channel_id)}" data-nav>Visit world ↗</a></article>`).join("") || '<div class="empty">No quests yet. A creator can start the next adventure.</div>'}</div>`,
  );
}
function updateWorkshop() {
  const select = document.querySelector<HTMLSelectElement>("#structure-select");
  if (!select || !state) return;
  const structures = state.structures || [];
  const key = structures.map((s) => `${s.id}:${s.revision}`).join(",");
  if (select.dataset.key !== key) {
    const selected = select.value;
    select.innerHTML = structures
      .map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`)
      .join("");
    if (structures.some((s) => s.id === selected)) select.value = selected;
    select.dataset.key = key;
  }
  const structure = structures.find((s) => s.id === select.value);
  const details = document.querySelector<HTMLElement>("#building-details")!;
  const detailKey = `${key}:${select.value}`;
  if (details.dataset.key !== detailKey) {
    details.innerHTML = structure
      ? `<h3>${esc(structure.title)}</h3><p class="small muted">Revision ${structure.revision} · ${structure.blocks.length}/64 blocks · lease ends ${esc(new Date(structure.expiresAt).toLocaleString())}</p><div tabindex="0" role="region" aria-label="Shared block coordinates" style="max-height:240px;overflow:auto"><table><caption class="small">Shared block coordinates</caption><thead><tr><th scope="col">X / Y / Z</th><th scope="col">Material</th><th scope="col">Contribution</th></tr></thead><tbody>${structure.blocks.map((b) => `<tr><td>${b.x} / ${b.y} / ${b.z}</td><td>${esc(b.material)}</td><td>${b.ownerId === me.user.id ? "Yours" : "Community"}</td></tr>`).join("")}</tbody></table></div>`
      : '<p class="muted">No structures yet. Lay a foundation to begin.</p>';
    details.dataset.key = detailKey;
  }
  const enabled = state.config.construction && !state.config.paused;
  $("#building-status").textContent = enabled
    ? "Community construction is enabled. Work together; remove only your own blocks."
    : "The creator must enable community construction and resume the world before you can build.";
  $("#workshop-create")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((button) => (button.disabled = !enabled));
  $("#workshop-edit")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((button) => (button.disabled = !enabled || !structure));
  $<HTMLButtonElement>("#structure-delete").disabled = !enabled || !structure;
}
async function workshop() {
  const currentGeneration = generation;
  if (
    requireAccount(
      "Enter a world and help build an original shared voxel structure.",
    )
  )
    return;
  const id = new URLSearchParams(location.search).get("room") || room;
  await api(`/v1/worlds/${encodeURIComponent(id)}/join`, "POST", {});
  const snapshot = await api(`/v1/worlds/${encodeURIComponent(id)}`);
  if (currentGeneration !== generation) return;
  room = id;
  state = snapshot;
  shell(
    `${intro("THE COMMUNITY WORKSHOP", "Small blocks.<br><em>Shared stories.</em>", "Build an original voxel landmark together. These virtual stage structures survive restarts for a 24-hour lease when the creator enables construction.")}<div class="columns"><div class="stack">${stageMarkup()}<div class="panel"><h2>Lay a foundation</h2><form id="workshop-create"><label>Structure name<input name="title" maxlength="40" required placeholder="Our little watchtower"></label><div class="form-grid"><label>Stage X (0.1–0.9)<input name="x" type="number" min="0.1" max="0.9" step="0.01" value="0.65" required></label><label>Stage Y (0.55–0.9)<input name="y" type="number" min="0.55" max="0.9" step="0.01" value="0.78" required></label></div><button class="primary">Create community structure</button></form><p class="small muted">One foundation per founder, eight per world. Each starts at block 3 / 0 / 3. No Shards are spent or awarded.</p></div></div><aside class="stack"><div class="notice" id="building-status" role="status"></div><div class="panel"><label>Shared structure<select id="structure-select" aria-label="Shared structure"></select></label><div id="building-details"></div></div><div class="panel"><h2>Add your piece</h2><form id="workshop-edit"><div class="form-grid">${["x", "y", "z"].map((axis) => `<label>Block ${axis.toUpperCase()}<input name="${axis}" type="number" min="0" max="${axis === "y" ? 5 : 7}" value="${axis === "y" ? 1 : 3}" required></label>`).join("")}<label>Material<select name="material">${buildingMaterials.map((material) => `<option>${material}</option>`).join("")}</select></label></div><div class="command-buttons"><button class="primary" name="operation" value="place">Place block</button><button name="operation" value="remove">Remove my block</button></div></form><p class="small muted">Stack on an existing block; remove from the top down. Up to 16 blocks per contributor and 64 per structure. The creator can remove any block.</p><button id="structure-delete" class="danger">Remove entire structure</button><p class="small muted">Only the founder or creator can remove a whole structure.</p></div><a class="button" href="/controller?room=${encodeURIComponent(room)}" data-nav>Back to your hero ↗</a></aside></div>`,
  );
  startWorld(id);
  const mutate = async (operation: Record<string, unknown>) => {
    try {
      const result = await api(
        `/v1/worlds/${encodeURIComponent(id)}/construction`,
        "POST",
        { requestId: clientRequestId(), ...operation },
      );
      if (generation !== currentGeneration) return;
      if (result.structure)
        $<HTMLSelectElement>("#structure-select").value = result.structure.id;
      toast("Community structure saved.");
    } finally {
      if (generation === currentGeneration) {
        state = await api(`/v1/worlds/${encodeURIComponent(id)}`);
        updateWorldUI();
      }
    }
  };
  bind(
    "#workshop-create",
    async (e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget as HTMLFormElement);
      await mutate({
        kind: "create",
        title: String(data.get("title")),
        x: Number(data.get("x")),
        y: Number(data.get("y")),
      });
    },
    "submit",
  );
  bind(
    "#workshop-edit",
    async (e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget as HTMLFormElement),
        kind = (e as SubmitEvent).submitter?.getAttribute("value") || "place";
      const selected = state?.structures?.find(
        (s) => s.id === $<HTMLSelectElement>("#structure-select").value,
      );
      if (!selected) throw Error("Choose a community structure first.");
      await mutate({
        kind,
        structureId: selected.id,
        revision: selected.revision,
        x: Number(data.get("x")),
        y: Number(data.get("y")),
        z: Number(data.get("z")),
        ...(kind === "place" ? { material: String(data.get("material")) } : {}),
      });
    },
    "submit",
  );
  bind("#structure-delete", async () => {
    const selected = state?.structures?.find(
      (s) => s.id === $<HTMLSelectElement>("#structure-select").value,
    );
    if (selected)
      await mutate({
        kind: "delete",
        structureId: selected.id,
        revision: selected.revision,
      });
  });
  bind(
    "#structure-select",
    () => {
      $("#building-details").dataset.key = "";
      updateWorkshop();
    },
    "change",
  );
  updateWorkshop();
}
async function factions() {
  const data = await api("/v1/factions");
  shell(
    `${intro("A COMMUNITY OF TRAVELERS", "Find your<br><em>kind of magic.</em>", "Join a faction to contribute future verified earnings to its story. Your existing Shards and past faction contributions stay where they were earned.")}<div class="features">${data.factions.map((f: any) => `<article class="panel"><span class="badge ${data.mine === f.id ? "mint" : ""}">${data.mine === f.id ? "YOUR FACTION" : "FACTION"}</span><h2 style="margin:20px 0">${esc(f.name)}</h2><p class="shards">${Number(f.earned).toLocaleString()} lifetime earned Shards</p><p class="small muted" style="margin:15px 0">${f.public_members} public members</p>${me.user ? `<button class="${data.mine === f.id ? "" : "primary"}" data-faction="${esc(f.id)}" ${data.mine === f.id ? "disabled" : ""}>${data.mine === f.id ? "Joined" : "Join faction"}</button>` : '<a class="button" href="/controller" data-nav>Connect to join</a>'}</article>`).join("")}</div><div class="panel" style="margin-top:24px"><h3>Every chapter counts</h3><p class="muted small" style="margin:15px 0">Switching factions affects future contributions only. Spending Shards does not lower faction score. Members who keep their profile private are excluded from public member counts. Rankings record contributions at award time.</p><a class="button" href="/leaderboard?type=factions&amp;period=all" data-nav>Faction rankings</a>${data.mine ? '<button id="leave-faction">Leave faction</button>' : ""}</div>`,
  );
  root.querySelectorAll<HTMLButtonElement>("[data-faction]").forEach(
    (button) =>
      (button.onclick = () => {
        button.disabled = true;
        void api(
          `/v1/factions/${encodeURIComponent(button.dataset.faction!)}/join`,
          "POST",
          {},
        )
          .then(() => render())
          .then(() => toast("Faction joined. Future earnings contribute here."))
          .catch((error) => {
            button.disabled = false;
            toast(error.message, true);
          });
      }),
  );
  bind("#leave-faction", async () => {
    await api("/v1/me/faction", "DELETE", {});
    await render();
    toast("Faction left. Past contributions remain recorded.");
  });
}
async function live() {
  const data = await api("/v1/live"),
    raids = await api("/v1/raids");
  shell(
    `${intro("THE RIFT ATLAS", "Many streams.<br><em>One shared adventure.</em>", "Discover participating worlds and the portals that connect their communities. This atlas maps virtual communities, never physical locations.")}<div class="features">${data.worlds.map((w: any) => `<article class="panel"><span class="badge orange">${esc(w.mode)}</span><h3 style="margin:20px 0 8px">${esc(w.title)}</h3><p class="muted">${esc(w.creator)} · ${w.players} claimed heroes</p><a class="button primary" style="margin-top:22px" href="/controller?room=${encodeURIComponent(w.id)}" data-nav>Step inside ↗</a></article>`).join("")}</div><div class="section-heading"><h2>Recent crossings</h2></div><div class="panel">${raids.raids.map((r: any) => `<div class="key-value"><span>${esc(r.source_name)} → ${esc(r.destination_id)} ${r.test ? "[TEST]" : ""}</span><span>${r.viewers} reported · ${r.claimed} claimed</span></div>`).join("") || '<p class="muted">The next portal is yet to open.</p>'}</div>`,
  );
}
async function streamer(id: string) {
  const data = await api(`/v1/streamers/${encodeURIComponent(id)}`);
  shell(
    `${intro("A COMMUNITY WORLD", `${esc(data.creator)}'s<br><em>little universe.</em>`, "Persistent heroes, shared quests, and the crossings that connect this community.")}<div class="stage-grid">${stageMarkup()}<aside class="panel"><span class="badge orange">${esc(data.mode)}</span><h2 style="margin-top:20px">${esc(data.title)}</h2><div class="stat-grid"><div><strong id="players-count">${data.players}</strong><span>CLAIMED HEROES</span></div><div><strong>${Number(data.communityEarned).toLocaleString()}</strong><span>COMMUNITY EARNINGS</span></div></div><a class="button primary" href="/controller?room=${encodeURIComponent(id)}" data-nav>Join this world</a>${me.channel?.id === id ? '<a class="button" href="/dashboard" data-nav style="margin-top:15px">Manage your world</a>' : ""}</aside></div><div class="section-heading"><h2>Community quest journal</h2></div><div class="features">${data.quests.map((q: any) => `<article class="panel"><span class="badge">${q.active ? "ACTIVE" : "COMPLETED"}</span><h3 style="margin-top:15px">${esc(q.definition.title)}</h3><p class="shards" style="margin-top:15px">+${q.definition.reward} Shards per eligible hero</p></article>`).join("") || '<p class="muted">No quests yet.</p>'}</div><div class="section-heading"><h2>Recent crossings</h2></div><div class="panel">${data.raids.map((r: any) => `<div class="key-value"><span>${esc(r.source_name)} ${r.test ? "[TEST]" : ""}</span><span>${r.viewers} reported, ${r.claimed} claimed</span></div>`).join("") || '<p class="muted">No raids recorded yet.</p>'}</div>`,
  );
  startWorld(id);
}
async function profile(id: string) {
  const data = await api(`/v1/players/${encodeURIComponent(id)}`);
  shell(
    `${intro("A TRAVELER’S TALE", `${esc(data.player.name)}<br><em>was here.</em>`, "A persistent character, earned treasures, and little stories that travel between worlds.")}<div class="columns"><div class="panel"><div class="profile-header">${face(data.player)}<div><h2>${esc(data.player.name)}</h2><span class="badge orange">${data.player.demo ? "SIMULATOR PLAYER" : "TWITCH-LINKED PLAYER"}</span></div></div><div class="stat-grid"><div><strong>${Number(data.earned).toLocaleString()}</strong><span>LIFETIME VERIFIED EARNINGS</span></div><div><strong>${data.quests.length}</strong><span>QUESTS COMPLETED</span></div></div><h3>Quest memories</h3>${data.quests.map((q: any) => `<div class="key-value"><span>${esc(q.definition.title)}</span><span class="shards">◆ ${q.definition.reward}</span></div>`).join("") || '<p class="muted" style="margin-top:15px">The adventure is just beginning.</p>'}</div><div class="stack"><div class="stage" id="avatar-preview" style="min-height:340px"><div class="stage-top"><span class="badge">LOCAL AVATAR PREVIEW</span></div></div><div class="panel"><h3>Collected treasures</h3>${data.inventory.map((i: any) => `<div class="key-value">${esc(i.item_id)}</div>`).join("") || '<p class="muted" style="margin-top:15px">No cosmetics unlocked yet.</p>'}<a class="button" style="margin-top:20px" href="/shop" data-nav>Visit the outfitter ↗</a></div></div>`,
  );
  if (me.user?.id === data.player.id) {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.style.marginTop = "24px";
    panel.innerHTML =
      '<h3>Share your traveler</h3><a class="button" style="margin-top:15px" href="/factions" data-nav>Meet the factions</a><p class="small muted" style="margin:15px 0">Create a signed 24-hour card with your public name, earned Shards and quest count. Your spendable wallet stays private. Nothing is posted automatically.</p><button id="create-share-card">Create public share card</button> <button id="revoke-share-card">Revoke existing card links</button><div id="share-card-result"></div>';
    root.querySelector("main")?.append(panel);
    bind("#create-share-card", async () => {
      const card = await api("/v1/me/share-card", "POST", { consent: true });
      $("#share-card-result").innerHTML =
        `<img id="share-card-image" style="width:100%;margin-top:20px" alt="Your RaidRift traveler share card" src="${esc(card.url)}"><a class="button" style="margin-top:15px" href="${esc(card.url)}" download="raidrift-traveler.svg">Download card</a><p class="small muted">Expires ${esc(new Date(card.expiresAt).toLocaleString())}. Changing your privacy or revoking links stops future access. Copies already downloaded cannot be recalled.</p>`;
    });
    bind("#revoke-share-card", async () => {
      await api("/v1/me/share-card", "DELETE", {});
      $("#share-card-result").textContent = "Existing links revoked.";
      toast("Share card links revoked.");
    });
  }
  const preview: WorldSnapshot = {
    roomId: "profile-preview",
    mode: "SIMULATOR",
    epoch: 0,
    tick: 0,
    config: defaultConfig,
    avatars: [
      {
        id: data.player.id,
        name: data.player.name,
        color: data.player.color,
        cosmetic: data.player.cosmetic,
        equipment: data.player.equipment,
        x: 0.5,
        y: 0.56,
        animation: "wave",
        message: "",
        target: null,
        lastActive: Date.now(),
      },
    ],
    tracks: [],
    props: [],
    raid: null,
    quests: [],
  };
  try {
    const view = new RiftRenderer(
      $("#avatar-preview"),
      () => preview,
      false,
      true,
    );
    routeCleanup = () => view.destroy();
  } catch {
    $("#avatar-preview").dataset.status =
      "3D preview needs hardware acceleration";
  }
}
async function privacy() {
  shell(
    `${intro("PRIVACY & FAIR PLAY", "A world that<br><em>respects yours.</em>", "Camera processing is opt-in, player identity is scoped, and every Shard has a deterministic accounting trail.")}<div class="columns"><div class="stack"><div class="panel"><h2>What we process</h2><p class="muted" style="margin:18px 0">Twitch numeric identity links your avatar across worlds. OAuth tokens stay encrypted on the server. Camera detection runs locally in the companion; only short-lived boxes and class labels are transmitted. Optional experimental quest verification sends sampled frames to OpenAI only with creator consent and an explicitly enabled server integration. Frames are not stored by this app.</p><p class="muted">Tracking IDs are ephemeral and discarded on scene changes or loss. We do not identify faces or retain physical location. Action plans expire from the log after one day. Economic ledger records remain pseudonymous for reconciliation after deletion.</p></div><div class="panel"><h2>Fair rankings</h2><p class="muted" style="margin-top:18px">Rankings use verified earned score, independent of spending. Weeks start Monday at 00:00 UTC. Seasons follow UTC calendar quarters. Ties sort by the latest scoring event time, then stable player ID. Anonymous raid counts never receive wallets or rewards. Rift Shards have no cash value and are separate from Twitch Bits and Channel Points.</p></div></div><div class="panel"><h2>Your choices</h2>${me.user ? `<label style="margin-top:20px">Public profile<select id="privacy"><option value="public">Public</option><option value="anonymous">Pseudonymous</option><option value="hidden">Hide from rankings</option></select></label><button id="save-privacy" style="margin-top:15px">Save privacy</button><button id="unlink-twitch" style="margin-top:15px">Unlink Twitch · keep my avatar</button><button id="delete-account" class="danger" style="margin-top:25px">Delete my account data</button><div class="notice warning">Deletion removes your sessions, avatar and public identity. Immutable pseudonymous economic records are retained. Type DELETE in the field to enable deletion.<input id="delete-confirm" aria-label="Type DELETE to confirm deletion" style="margin-top:12px;width:100%"></div>` : '<p class="muted" style="margin-top:20px">Connect Twitch to manage your privacy settings.</p>'}</div></div>`,
  );
  if (me.user) {
    $<HTMLSelectElement>("#privacy").value = me.user.privacy;
    bind("#save-privacy", async () => {
      await api("/v1/me/profile", "PATCH", {
        privacy: $<HTMLSelectElement>("#privacy").value,
      });
      await refreshMe();
      toast("Privacy saved");
    });
    bind("#unlink-twitch", async () => {
      await api("/v1/me/unlink", "POST", {});
      await refreshMe();
      navigate("/");
      toast(
        "Twitch unlinked. Your avatar and inventory will be restored when you relink.",
      );
    });
    bind("#delete-account", async () => {
      if ($<HTMLInputElement>("#delete-confirm").value !== "DELETE")
        throw Error("Type DELETE in the confirmation field first.");
      await api("/v1/me", "DELETE");
      await refreshMe();
      navigate("/");
      toast("Account data deleted.");
    });
  }
}
async function capture() {
  const captureGeneration = generation;
  if (
    requireAccount(
      "The companion processes an explicitly selected local camera or display source.",
      true,
    )
  )
    return;
  const data = await api("/v1/creator/config");
  if (captureGeneration !== generation) return;
  shell(
    `${intro("REALITYQUEST / DESKTOP COMPANION", "The scene becomes<br><em>a playground.</em>", "Select a camera or an OBS source projector. Detection stays on this device; ephemeral object anchors go to your world.")}<div class="columns"><div class="panel"><div class="capture-wrap"><video id="capture-video" autoplay playsinline muted aria-hidden="true"></video><canvas id="capture-boxes" aria-label="Transformed source and tracking diagnostics"></canvas><div id="capture-world" class="capture-world" hidden></div></div><div class="command-buttons"><button id="camera-start" class="primary">Select camera</button><button id="display-start">Select OBS source projector</button><button id="capture-stop" class="danger">Stop capture</button></div><div class="notice" id="capture-status">${data.config.vision ? "Camera processing consent is enabled. Select a source to begin." : "Enable camera processing in Creator Studio before starting."}</div><label class="check" style="margin:16px 0"><input id="silhouette-enabled" type="checkbox">Experimental local silhouette anchoring (animals and furniture)</label><label>Use a permitted test video (local only)<input id="video-file" type="file" accept="video/*"></label><form id="capture-command-form"><label style="margin-top:20px">Direct your own virtual hero<div class="field-row"><input id="capture-command" maxlength="500" placeholder="sprint towards the dog and sit on it" required><button class="primary">Send action</button></div></label></form><p class="small muted" style="margin-top:15px">Screen-space composite preview. Test video is not live quest evidence.</p><a class="button" href="/dashboard" data-nav style="margin-top:20px">Source geometry & consent settings ↗</a></div><aside class="stack"><div class="panel"><h3>Screen-space mode</h3><p class="muted small" style="margin-top:15px">Choose OBS’s source projector rather than the finished composite to avoid detecting overlay graphics. Match crop, rotation and mirror in Creator Studio.</p><p class="muted small" style="margin-top:15px">This detector recognizes COCO object classes. Red-hat referring expressions and native 3D locks remain validation gaps. Optional animal/furniture silhouette anchors are experimental. Local patch tracking bridges detector observations and stops on low image agreement.</p></div><div class="panel"><h3>Capture diagnostics</h3><div id="capture-metrics" class="feed"></div></div></aside></div>`,
  );
  const targetLabel = document.createElement("label");
  targetLabel.style.marginTop = "15px";
  targetLabel.innerHTML =
    '<span>Visible target</span><select id="target"><option value="">Automatic target</option></select>';
  $("#capture-command-form").after(targetLabel);
  let captureSnapshot: WorldSnapshot | null = null;
  const sourceControls = Array.from(
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "#video-file,#camera-start,#display-start,#silhouette-enabled,#capture-command-form button",
    ),
  );
  sourceControls.forEach((control) => (control.disabled = true));
  let cancelCapture = () => {};
  const previewSocket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/socket?room=${encodeURIComponent(data.channelId)}`,
  );
  previewSocket.onmessage = (event) => {
    const value = JSON.parse(event.data);
    preview?.setServerTime(Date.parse(value.serverTime));
    if (value.type === "world.snapshot") {
      captureSnapshot = value.payload;
      if (captureSnapshot) updateTargetSelect(captureSnapshot.tracks);
      if (captureSnapshot?.config.paused || !captureSnapshot?.config.vision)
        cancelCapture();
    }
  };
  previewSocket.onerror = () => {};
  let preview: RiftRenderer | null = null;
  try {
    preview = new RiftRenderer(
      $("#capture-world"),
      () => captureSnapshot,
      true,
      false,
      me.user?.id || null,
    );
  } catch {}
  bind(
    "#capture-command-form",
    async (e) => {
      e.preventDefault();
      room = data.channelId;
      await command($<HTMLInputElement>("#capture-command").value);
      toast("Virtual action submitted to the server.");
    },
    "submit",
  );
  const { CaptureCompanion } = await import("./vision.js");
  const { LocalClipRecorder } = await import("./clips.js");
  if (captureGeneration !== generation) {
    previewSocket.close();
    preview?.destroy();
    return;
  }
  const clipPanel = document.createElement("div");
  clipPanel.className = "panel";
  clipPanel.innerHTML =
    '<h3>Keep a little moment</h3><p class="small muted" style="margin:15px 0">Record up to 20 seconds of this source plus virtual heroes locally. Video only, up to 1280 × 720. Player name labels and diagnostic boxes are omitted. Nothing is uploaded or posted.</p><label class="check"><input type="checkbox" id="clip-consent">I have permission to record this source and its participants.</label><div class="command-buttons"><button id="clip-start">Record local clip</button><button id="clip-stop">Finish clip</button><button id="clip-clear">Discard local clip</button></div><p id="clip-status" class="small muted" role="status">Recording is off. No rolling buffer.</p><div id="clip-result"></div>';
  $("#capture-metrics").closest(".panel")?.parentElement?.append(clipPanel);
  const clip = new LocalClipRecorder(
    $<HTMLVideoElement>("#capture-video"),
    () => captureSnapshot?.config.geometry || data.config.geometry,
    (ctx, w, h) => {
      if (!preview) throw Error("Overlay unavailable");
      preview.drawTo(ctx, w, h);
    },
    () =>
      c.sourceKind === "TEST VIDEO"
        ? "TEST VIDEO · SIMULATOR SOURCE"
        : captureSnapshot?.mode === "SIMULATOR"
          ? "SIMULATOR · CAPTURE SOURCE"
          : "CAPTURE SOURCE",
    (text) => {
      $("#clip-status").textContent = text;
    },
    (result) => {
      const extension = result.mime.includes("mp4") ? "mp4" : "webm";
      $("#clip-result").innerHTML =
        `<video id="clip-preview" controls playsinline style="width:100%;margin-top:15px" src="${esc(result.url)}"></video><a id="clip-download" class="button" href="${esc(result.url)}" download="raidrift-clip.${extension}">Download ${extension.toUpperCase()} clip</a><p class="small muted">${(result.bytes / 1048576).toFixed(2)} MiB · ${Math.round(result.elapsed / 1000)} seconds. Review permission and source attribution before sharing.</p>`;
    },
  );
  bind("#clip-start", async () => {
    if (
      !captureSnapshot ||
      captureSnapshot.config.paused ||
      !captureSnapshot.config.vision
    )
      throw Error("Enable camera processing and resume the world first.");
    try {
      await clip.start($<HTMLInputElement>("#clip-consent").checked);
    } catch (error) {
      $("#clip-status").textContent =
        error instanceof Error ? error.message : "Recording could not start.";
      throw error;
    }
    $("#clip-result").innerHTML = "";
  });
  bind("#clip-stop", () => clip.stop());
  const clearClip = () => {
    clip.abort();
    clip.clearSaved();
    $("#clip-result").innerHTML = "";
    $("#clip-status").textContent = "Recording off. Local clip discarded.";
  };
  bind("#clip-clear", clearClip);
  bind(
    "#clip-consent",
    () => {
      if (!$<HTMLInputElement>("#clip-consent").checked) clearClip();
    },
    "change",
  );
  const onVisibility = () => {
    if (document.hidden) clip.abort("Browser left the foreground");
  };
  document.addEventListener("visibilitychange", onVisibility);
  const c = new CaptureCompanion(
    $<HTMLVideoElement>("#capture-video"),
    $<HTMLCanvasElement>("#capture-boxes"),
    async (tracks, signal) => {
      const cover = $("#capture-world");
      cover.hidden = false;

      await api(
        "/v1/creator/vision/tracks",
        "POST",
        {
          epoch: c.epoch,
          tracks,
        },
        signal,
      );
    },
    (message) => {
      $("#capture-status").textContent = message;
      if (message.startsWith("Capture stopped"))
        clip.abort("Capture source stopped");
    },
    () => captureSnapshot?.config.geometry || data.config.geometry,
  );
  cancelCapture = () => {
    clip.abort();
    c.stop();
  };
  bind(
    "#silhouette-enabled",
    () => c.setSilhouette($<HTMLInputElement>("#silhouette-enabled").checked),
    "change",
  );
  async function start(kind: "camera" | "display") {
    if (!data.config.vision)
      throw Error("Enable camera processing consent in Creator Studio first.");
    const reset = await api("/v1/creator/vision/scene", "POST", {});
    c.epoch = reset.epoch;
    await c.start(kind);
  }
  bind("#camera-start", () => start("camera"));
  bind("#display-start", () => start("display"));
  bind("#capture-stop", async () => {
    c.stop();
    $("#capture-world").hidden = true;
    await api("/v1/creator/vision/scene", "POST", {});
    toast("Capture stopped. Ephemeral tracks cleared.");
  });
  bind(
    "#video-file",
    async () => {
      if (!data.config.vision) throw Error("Enable processing consent first.");
      const file = $<HTMLInputElement>("#video-file").files?.[0];
      if (file) {
        const reset = await api("/v1/creator/vision/scene", "POST", {});
        c.epoch = reset.epoch;
        await c.file(file);
      }
    },
    "change",
  );
  sourceControls.forEach((control) => (control.disabled = false));
  $("#capture-metrics").dataset.ready = "true";
  routeCleanup = () => {
    clip.dispose();
    document.removeEventListener("visibilitychange", onVisibility);
    c.dispose();
    previewSocket.close();
    preview?.destroy();
    void api("/v1/creator/vision/scene", "POST", {}).catch(() => {});
  };
}
async function admin() {
  if (
    requireAccount("Operator tools require an explicitly authorized Twitch ID.")
  )
    return;
  const d = await api("/v1/admin/audit");
  shell(
    `${intro("OPERATIONS", "A healthy rift.<br><em>A fair world.</em>", "Audit history and compensating ledger corrections for authorized operators.")}<div class="panel"><form id="reverse-form"><div class="form-grid"><label>Original earning transaction ID<input id="transaction" required></label><label>Reason<input id="reason" minlength="5" required></label></div><button class="danger">Append compensating reversal</button></form><div class="feed">${d.audit.map((a: any) => `<div class="feed-item">${esc(a.operation)} · ${esc(a.created_at)} · ${esc(JSON.stringify(a.detail))}</div>`).join("") || '<p class="muted">No operator actions recorded.</p>'}</div></div>`,
  );
  bind(
    "#reverse-form",
    async (e) => {
      e.preventDefault();
      await api("/v1/admin/reverse", "POST", {
        transactionId: $<HTMLInputElement>("#transaction").value,
        reason: $<HTMLInputElement>("#reason").value,
      });
      toast("Compensating transaction appended. Original history preserved.");
    },
    "submit",
  );
}
async function spatialRoom() {
  shell(
    `${intro("YOUR ROOM, THEIR WORLD", "Let them step<br><em>into your space.</em>", "Place your community’s 3D characters on a real desk or floor using your device’s AR tracking.")}<div class="panel"><div id="stage" class="stage spatial-stage" aria-label="World-anchored AR view"></div><div id="ar-controls" class="spatial-controls"><p id="ar-status" role="status">Checking immersive AR support…</p><div class="command-buttons"><button id="ar-start" class="primary" disabled>Start room AR</button><button id="ar-recenter" disabled>Place again</button><button id="ar-end" disabled>Stop AR</button></div><div class="command-buttons">${["wave", "sit", "dance", "jump"].map((command) => `<button data-ar-command="${command}" ${me.user ? "" : "disabled"}>${command}</button>`).join("")}</div><a class="button" href="/controller?room=${encodeURIComponent(room)}" data-nav>Open character controls ↗</a></div><p class="small muted">Requires a compatible immersive AR browser and trusted HTTPS. This view uses real runtime camera poses and horizontal surface hit tests. Room contact and coarse occlusion use sensed mesh/plane data when available. Per-pixel depth and recording of camera passthrough are not enabled. Session anchors are not saved between visits.</p></div>`,
  );
  const { SpatialWorld } = await import("./spatial-world.js");
  const supported = await SpatialWorld.supported();
  if (!supported) {
    $("#ar-status").textContent =
      "This browser does not provide immersive AR. Use a supported AR device/browser over trusted HTTPS. Camera-overlay mode cannot provide room anchoring.";
    $("#stage").dataset.spatialState = "unsupported";
    return;
  }
  if (me.user)
    await api(`/v1/worlds/${encodeURIComponent(room)}/join`, "POST", {});
  startWorld(room, undefined, false);
  spatialView = new SpatialWorld(
    $("#stage"),
    () => state,
    (text) => {
      $("#ar-status").textContent = text;
      const running = !["idle", "unsupported"].includes(
        $("#stage").dataset.spatialState || "idle",
      );
      $<HTMLButtonElement>("#ar-start").disabled = running;
      $<HTMLButtonElement>("#ar-end").disabled = !running;
      $<HTMLButtonElement>("#ar-recenter").disabled = !running;
    },
    $("#ar-controls"),
  );
  $("#ar-status").textContent =
    "AR is available. Start, aim at a surface, then tap to place your world.";
  $<HTMLButtonElement>("#ar-start").disabled = false;
  bind("#ar-start", () => spatialView?.start());
  bind("#ar-end", () => spatialView?.end());
  bind("#ar-recenter", () => spatialView?.recenter());
  document
    .querySelectorAll<HTMLButtonElement>("[data-ar-command]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        void api(`/v1/worlds/${encodeURIComponent(room)}/actions`, "POST", {
          prompt: button.dataset.arCommand,
          clientRequestId: clientRequestId(),
        }).catch((error) => toast(error.message, true));
      }),
    );
}
async function render() {
  const gen = ++generation;
  routeCleanup?.();
  routeCleanup = null;
  feed = [];
  document.body.classList.toggle(
    "overlay-body",
    location.pathname === "/overlay",
  );
  try {
    if (location.pathname === "/relay-receiver") {
      document.body.classList.add("overlay-body");
      root.innerHTML =
        '<video id="relay-video" autoplay playsinline hidden style="width:100vw;height:100vh;max-height:none;background:#10121c"></video><div class="overlay-status" id="relay-status" role="status">Connecting to relay…</div>';
      const params = new URLSearchParams(location.hash.slice(1));
      const { relayEndpoint, receiveRelay } = await import(
        "./relay-receiver.js"
      );
      routeCleanup = receiveRelay(
        $<HTMLVideoElement>("#relay-video"),
        relayEndpoint(params.get("source") || ""),
        params.get("bearer") || "",
        (text) => {
          $("#relay-status").textContent = text;
          $("#relay-status").hidden = !text;
        },
      );
      return;
    }
    if (location.pathname === "/receiver") {
      document.body.classList.add("overlay-body");
      root.innerHTML =
        '<video id="receiver-video" autoplay playsinline controls style="width:100vw;height:100vh;max-height:none"></video><div class="overlay-status" id="receiver-status">Pairing...</div>';
      const token = new URLSearchParams(location.hash.slice(1)).get("token");
      if (!token)
        throw Error("A creator-generated receiver token is required.");
      const { receiveMedia } = await import("./receiver.js");
      routeCleanup = receiveMedia(
        $<HTMLVideoElement>("#receiver-video"),
        token,
        (text) => {
          $("#receiver-status").textContent = text;
        },
      );
      return;
    }
    if (location.pathname === "/overlay") {
      root.innerHTML = stageMarkup(true);
      const token =
        new URLSearchParams(location.hash.slice(1)).get("token") || undefined;
      startWorld(
        new URLSearchParams(location.search).get("room") || room,
        token,
      );
      return;
    }
    await refreshMe();
    status = await api("/v1/status");
    if (gen !== generation) return;
    switch (location.pathname) {
      case "/":
        await home();
        break;
      case "/leaderboard":
        await leaderboard();
        break;
      case "/controller":
        await controller();
        break;
      case "/dashboard":
        await dashboard();
        break;
      case "/shop":
      case "/inventory":
        await shop();
        break;
      case "/quests":
        await quests();
        break;
      case "/live":
        await live();
        break;
      case "/workshop":
        await workshop();
        break;
      case "/factions":
        await factions();
        break;
      case "/privacy":
        await privacy();
        break;
      case "/capture":
        await capture();
        break;
      case "/ar":
        await spatialRoom();
        break;
      case "/admin":
        await admin();
        break;
      default:
        if (location.pathname.startsWith("/streamers/"))
          await streamer(decodeURIComponent(location.pathname.split("/")[2]));
        else if (location.pathname.startsWith("/players/"))
          await profile(decodeURIComponent(location.pathname.split("/")[2]));
        else
          shell(
            '<div class="empty"><h1>Off the map.</h1><a class="button" href="/" data-nav>Return to the rift</a></div>',
          );
    }
  } catch (e) {
    shell(
      `<div class="panel"><h2>This part of the world is unavailable.</h2><p class="muted" style="margin:20px 0">${esc((e as Error).message)}</p><a href="/" data-nav class="button">Return to the rift</a></div>`,
    );
  }
}
void render();
