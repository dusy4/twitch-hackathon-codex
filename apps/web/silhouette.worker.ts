import {
  FilesetResolver,
  InteractiveSegmenterLegacy,
} from "@mediapipe/tasks-vision";
import { silhouetteAnchor } from "../../packages/shared/surface.js";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
let segmenter: InteractiveSegmenterLegacy | null = null;
scope.onmessage = (event) => {
  void (async () => {
    const data = event.data;
    if (data.type === "init") {
      const files = await FilesetResolver.forVisionTasks("/vision/wasm");
      segmenter = await InteractiveSegmenterLegacy.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/vision/magic_touch.tflite",
          delegate: "CPU",
        },
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      scope.postMessage({ type: "ready" });
      return;
    }
    if (data.type === "frame") {
      const bitmap = data.bitmap as ImageBitmap;
      try {
        if (!segmenter) throw Error("Segmenter not initialized");
        scope.postMessage({ type: "stage", stage: "segmenting" });
        const [x, y, w, h] = data.box as [number, number, number, number];
        const result = segmenter.segment(bitmap, {
          keypoint: { x: x + w * 0.5, y: y + h * 0.5 },
        });
        try {
          const mask =
            result.confidenceMasks?.[1] || result.confidenceMasks?.[0];
          if (!mask) throw Error("No foreground mask returned");
          const values = mask.getAsFloat32Array();
          const anchor = silhouetteAnchor(
            values,
            mask.width,
            mask.height,
            data.box,
          );
          const diagnostic = {
            width: mask.width,
            height: mask.height,
            center:
              values[
                Math.floor((y + h * 0.5) * mask.height) * mask.width +
                  Math.floor((x + w * 0.5) * mask.width)
              ],
          };
          scope.postMessage({
            type: "anchor",
            epoch: data.epoch,
            id: data.id,
            box: data.box,
            anchor,
            sourceTime: data.sourceTime,
            diagnostic,
            durationMs: Date.now() - data.sourceTime,
          });
        } finally {
          result.close();
        }
      } finally {
        bitmap.close();
      }
    }
  })().catch((error) =>
    scope.postMessage({ type: "error", message: (error as Error).message }),
  );
};
