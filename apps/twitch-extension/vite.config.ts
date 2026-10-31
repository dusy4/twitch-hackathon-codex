import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig(({ mode }) => ({
  define: {
    "import.meta.env.VITE_EXT_KEYBOARD": JSON.stringify(
      mode === "local-test" ? "true" : "false",
    ),
  },
  root: "apps/twitch-extension",
  base: "./",
  build: {
    outDir: "../../dist/twitch-extension",
    emptyOutDir: true,
    // Twitch review requires readable JS. There are no eval-based dependencies.
    minify: false,
    rollupOptions: {
      input: {
        overlay: resolve("apps/twitch-extension/index.html"),
        component: resolve("apps/twitch-extension/component.html"),
        panel: resolve("apps/twitch-extension/panel.html"),
        mobile: resolve("apps/twitch-extension/mobile.html"),
      },
    },
  },
}));
