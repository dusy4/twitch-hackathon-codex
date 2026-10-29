import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

test("sensed geometry really writes a depth mask before character pixels and clears it when tracking disappears", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Synthetic GPU depth test; no physical room claim",
  );
  await page.route("**/qa-spatial-depth", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Synthetic spatial depth QA</title><body></body>",
    }),
  );
  await page.goto("/qa-spatial-depth");
  const bundle = await build({
    stdin: {
      contents: `
      import * as THREE from 'three';
      import { createSensedRoom } from './apps/web/sensed-room.ts';
      window.__depthQA = (async () => {
        const renderer = new THREE.WebGLRenderer({preserveDrawingBuffer:true});
        renderer.setSize(400,400); renderer.setClearColor(0x223344);
        document.body.append(renderer.domElement);
        const scene = new THREE.Scene(), content = new THREE.Group(); scene.add(content);
        const camera = new THREE.PerspectiveCamera(45,1,.01,20);
        camera.position.set(0,.8,4); camera.lookAt(0,.8,0);
        const hero = new THREE.Mesh(new THREE.BoxGeometry(.6,1.4,.4), new THREE.MeshBasicMaterial({color:0xff0000}));
        hero.position.set(0,.8,-.5); content.add(hero);
        const room = await createSensedRoom(content);
        const source = {meshSpace:{},lastChangedTime:1,vertices:new Float32Array([-.6,0,.3,.6,0,.3,.6,1.7,.3,-.6,1.7,.3]),indices:new Uint32Array([0,1,2,0,2,3])};
        const pose = new THREE.Matrix4();
        const frame = {detectedMeshes:new Set([source]),getPose:()=>({transform:{matrix:pose.elements}})};
        const sample = () => {renderer.render(scene,camera);const gl=renderer.getContext(),data=new Uint8Array(4);gl.readPixels(200,200,1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);return [...data];};
        const visible = sample();
        room.update(frame,{});
        const hidden = sample();
        const surfaces = room.contacts.surfaceCount;
        // Pose changes must propagate even though geometry revision has not changed.
        pose.makeTranslation(2,0,0); room.update(frame,{});
        const poseMoved = sample();
        pose.identity(); room.update(frame,{}); sample();
        frame.detectedMeshes.clear();room.update(frame,{});
        const lost = sample();
        const afterLost = room.contacts.surfaceCount;
        room.dispose();hero.geometry.dispose();hero.material.dispose();renderer.dispose();
        return {visible,hidden,poseMoved,lost,surfaces,afterLost};
      })();
    `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    logLevel: "silent",
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => (window as any).__depthQA);
  expect(result.visible[0]).toBeGreaterThan(200);
  expect(result.hidden[0]).toBeLessThan(100);
  expect(result.poseMoved[0]).toBeGreaterThan(200);
  expect(result.lost[0]).toBeGreaterThan(200);
  expect(result.surfaces).toBe(1);
  expect(result.afterLost).toBe(0);
  await writeFile(
    "artifacts/spatial-depth-pixels.json",
    JSON.stringify(
      {
        scope:
          "Synthetic provider geometry + actual WebGL pixel readback; not a physical-device test",
        ...result,
      },
      null,
      2,
    ),
  );
});
