import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
const root = "dist/twitch-extension";
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const content = await readFile(path);
      files.push({
        path: path.replaceAll("\\", "/"),
        bytes: (await stat(path)).size,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
  }
}
await walk(root);
for (const name of ["index", "component", "panel", "mobile"]) {
  const html = await readFile(`${root}/${name}.html`, "utf8");
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(
    (m) => m[1],
  );
  if (
    scripts[0] !==
    "https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js"
  )
    throw Error("Twitch helper must be first");
  if (scripts.slice(1).some((src) => /^https?:/.test(src)))
    throw Error("Unexpected remote script");
}
const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
if (totalBytes >= 1_000_000)
  throw Error(`Conservative entire-bundle size exceeds 1 MB: ${totalBytes}`);
const record = {
  builtAt: new Date().toISOString(),
  build: process.argv.includes("--local")
    ? "private Local Test with focused keyboard"
    : "review with shortcuts disabled",
  totalBytes,
  mobileBudgetBytes: 1_000_000,
  includesAllHtmlNoticesAndFontFallbacks: true,
  files,
};
await writeFile(
  `artifacts/extension-build${process.argv.includes("--local") ? "-local" : ""}.json`,
  JSON.stringify(record, null, 2) + "\n",
);
console.log(
  `${record.build}: ${totalBytes} bytes for entire directory; helper-first HTML validated.`,
);
