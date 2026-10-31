/** Read-only anonymous transport smoke; never sends PRIVMSG or records chat text. */
import { TwitchIrc } from "../apps/api/twitch-irc.js";
const channel = process.argv[2] || "twitch";
const reader = new TwitchIrc(channel, {
  chat: async () => {},
  raid: async () => {},
}).start();
await new Promise((resolve) => setTimeout(resolve, 15000));
console.log(
  JSON.stringify({
    check: "anonymous IRC transport only; no viewer-action or raid rehearsal",
    ...reader.status,
  }),
);
const ok = reader.status.connected;
reader.stop();
if (!ok) process.exitCode = 1;
