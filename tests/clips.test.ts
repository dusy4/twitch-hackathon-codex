import { test } from "node:test";
import assert from "node:assert/strict";
import { drawSource } from "../apps/web/clips.js";
import {
  transformPoint,
  defaultConfig,
  type SourceGeometry,
} from "../packages/shared/contracts.js";

test("clip canvas source transforms align with authoritative anchors across crop, mirror, rotation and viewport", () => {
  for (const rotation of ["0", "90", "180", "270"] as const)
    for (const mirror of [false, true]) {
      const g: SourceGeometry = {
        ...defaultConfig.geometry,
        crop: [0.1, 0.2, 0.15, 0.1],
        viewport: [0.2, 0.1, 0.6, 0.8],
        rotation,
        mirror,
      };
      const points = [
        [0.3, 0.4],
        [0.7, 0.8],
        [0.5, 0.5],
      ];
      for (const [sourceX, sourceY] of points) {
        let m = [1, 0, 0, 1, 0, 0],
          saved: number[] = [];
        let drawn: number[] = [];
        const transform = (
          a: number,
          b: number,
          c: number,
          d: number,
          e: number,
          f: number,
        ) => {
          const [A, B, C, D, E, F] = m;
          m = [
            A * a + C * b,
            B * a + D * b,
            A * c + C * d,
            B * c + D * d,
            A * e + C * f + E,
            B * e + D * f + F,
          ];
        };
        const ctx = {
          save() {
            saved = [...m];
          },
          restore() {
            m = saved;
          },
          transform,
          translate(x: number, y: number) {
            transform(1, 0, 0, 1, x, y);
          },
          scale(x: number, y: number) {
            transform(x, 0, 0, y, 0, 0);
          },
          drawImage(
            _image: unknown,
            sx: number,
            sy: number,
            sw: number,
            sh: number,
            dx: number,
            dy: number,
            dw: number,
            dh: number,
          ) {
            const x = dx + ((sourceX * 1920 - sx) / sw) * dw,
              y = dy + ((sourceY * 1080 - sy) / sh) * dh;
            drawn = [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
          },
        };
        drawSource(
          ctx as unknown as CanvasRenderingContext2D,
          {} as CanvasImageSource,
          1920,
          1080,
          g,
          1280,
          720,
        );
        const [x, y] = transformPoint(sourceX, sourceY, g);
        assert.ok(
          Math.abs(drawn[0] - x * 1280) < 1e-8,
          `x aligns for ${rotation}/${mirror}`,
        );
        assert.ok(
          Math.abs(drawn[1] - y * 720) < 1e-8,
          `y aligns for ${rotation}/${mirror}`,
        );
        assert.deepEqual(
          m,
          [1, 0, 0, 1, 0, 0],
          "Source drawing restores caller transforms",
        );
      }
    }
});
