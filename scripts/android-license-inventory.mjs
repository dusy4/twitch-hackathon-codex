import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const cache = process.argv[2] || '.tools/gradle-cache/caches/modules-2/files-2.1';
const coordinates = (await readFile('apps/android/app/build/reports/runtime-dependencies.txt', 'utf8')).trim().split(/\r?\n/);
const text = (xml, tag) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1].trim();
async function metadata(coordinate, depth = 0) {
  if (depth > 5) throw Error('POM parent cycle');
  const [group, artifact, version] = coordinate.split(':');
  const root = join(cache, group, artifact, version);
  let pom;
  for (const hash of await readdir(root)) for (const file of await readdir(join(root, hash))) {
    if (file.endsWith('.pom')) pom = await readFile(join(root, hash, file), 'utf8');
  }
  if (!pom) throw Error(`Missing cached POM: ${coordinate}`);
  const licenses = [...(text(pom, 'licenses') || '').matchAll(/<license>([\s\S]*?)<\/license>/g)]
    .map((match) => ({ name: text(match[1], 'name') || 'UNKNOWN', url: text(match[1], 'url') || null }));
  if (licenses.length) return { licenses, declaredBy: coordinate };
  const parent = text(pom, 'parent');
  if (parent) return metadata([text(parent, 'groupId'), text(parent, 'artifactId'), text(parent, 'version')].join(':'), depth + 1);
  throw Error(`No declared or inherited license: ${coordinate}`);
}
const records = [];
for (const coordinate of coordinates) records.push({ coordinate, ...await metadata(coordinate) });
const inventory = JSON.stringify({ scope: 'Resolved debugRuntimeClasspath POM declarations, including inherited licenses; not a vulnerability scan', records }, null, 2);
await mkdir('artifacts', { recursive: true });
await mkdir('apps/android/app/src/main/assets/notices', { recursive: true });
await writeFile('artifacts/android-dependency-licenses.json', inventory);
await writeFile('apps/android/app/src/main/assets/notices/android-dependencies.json', inventory);
console.log(`${records.length} Android runtime components; all declare or inherit license metadata.`);
