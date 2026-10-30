import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

// Keep authored skeletal motion, but remove root displacement: room motion belongs to the motor.
const [sourcePath, destinationPath] = process.argv.slice(2);
if (!sourcePath || !destinationPath) throw Error('Expected model source and generated-assets directories');
const source = resolve(sourcePath), destination = resolve(destinationPath);
await mkdir(destination, { recursive: true });
const receipts = [];
for (const name of await readdir(source)) {
  if (!name.endsWith('.glb')) {
    await copyFile(join(source, name), join(destination, name));
    continue;
  }
  const original = await readFile(join(source, name));
  if (original.readUInt32LE(0) !== 0x46546c67 || original.readUInt32LE(4) !== 2) throw Error('Expected glTF 2 binary');
  const jsonLength = original.readUInt32LE(12);
  const gltf = JSON.parse(original.subarray(20, 20 + jsonLength).toString('utf8'));
  // Optional hand weapons are all present in the source pack; no loadout is selected here.
  for (const node of gltf.nodes) if (node.name?.startsWith('handslot')) delete node.children;
  const accessories = new Set(['1H_Sword_Offhand','Badge_Shield','Rectangle_Shield','Round_Shield','Spike_Shield','1H_Sword','2H_Sword','Spellbook','Spellbook_open','1H_Wand','2H_Staff','Knife_Offhand','1H_Crossbow','2H_Crossbow','Knife','Throwable','1H_Axe_Offhand','Barbarian_Round_Shield','1H_Axe','2H_Axe','Mug']);
  let hiddenAccessories = 0;
  for (const node of gltf.nodes) if (node.mesh !== undefined && accessories.has(node.name)) { delete node.mesh; hiddenAccessories++; }
  let removed = 0;
  for (const clip of gltf.animations ?? []) {
    clip.channels = clip.channels.filter(({ target }) => {
      const drop = gltf.nodes[target.node]?.name === 'root' && target.path === 'translation';
      if (drop) removed++;
      return !drop;
    });
  }
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const header = Buffer.from(original.subarray(0, 20));
  const rest = original.subarray(20 + jsonLength);
  header.writeUInt32LE(20 + padded.length + rest.length, 8);
  header.writeUInt32LE(padded.length, 12);
  const generated = Buffer.concat([header, padded, rest]);
  await writeFile(join(destination, name), generated);
  receipts.push({ name, sourceSha256: createHash('sha256').update(original).digest('hex'), generatedSha256: createHash('sha256').update(generated).digest('hex'), removedRootTranslationChannels: removed, hiddenAccessories });
}
await writeFile(join(destination, 'native-derivatives.json'), JSON.stringify({ license: 'CC0-1.0', operation: 'Remove root translation channels and optional accessory mesh references; retain skeletal animation and binary buffers', files: receipts }, null, 2));
