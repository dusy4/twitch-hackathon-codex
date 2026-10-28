import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import type { Detection } from "../../packages/shared/tracker.js";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
let detector: ObjectDetector | null = null;
scope.onmessage = (event) => {
  void (async () => {
    const data = event.data;
    if (data.type === "init") {
      const files = await FilesetResolver.forVisionTasks("/vision/wasm");
      detector = await ObjectDetector.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/vision/efficientdet_lite0.tflite",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        scoreThreshold: 0.6,
        maxResults: 30,
      });
      scope.postMessage({ type: "ready" });
      return;
    }
    if (data.type === "frame") {
      const bitmap = data.bitmap as ImageBitmap;
      try {
        if (!detector) throw Error("Object detector is not initialized");
        const result = detector.detectForVideo(bitmap, data.timestamp);
        const detections: Detection[] = result.detections
          .filter((d) => d.boundingBox && d.categories[0])
          .map((d) => {
            const box = d.boundingBox!,
              label = d.categories[0].categoryName;
            const x = Math.max(0, Math.min(1, box.originX / bitmap.width)),
              y = Math.max(0, Math.min(1, box.originY / bitmap.height));
            return {
              class: label === "dining table" ? "table" : label,
              box: [
                x,
                y,
                Math.max(0, Math.min(1 - x, box.width / bitmap.width)),
                Math.max(0, Math.min(1 - y, box.height / bitmap.height)),
              ],
              confidence: d.categories[0].score,
            };
          });
        scope.postMessage({
          type: "detections",
          id: data.id,
          epoch: data.epoch,
          sourceTime: data.sourceTime,
          durationMs: Date.now() - data.sourceTime,
          detections,
        });
      } finally {
        bitmap.close();
      }
    }
  })().catch((error) =>
    scope.postMessage({ type: "error", message: (error as Error).message }),
  );
};
