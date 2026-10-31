# On-device object detector

Attach `RaidRift.ObjectDetector` and assign the full-screen AR camera with
`ARCameraBackground`. Subscribe to `OnDetections`; results carry that rendered
frame's camera-to-world and projection matrices. This capture path supports the
built-in render pipeline used by this project.

- **Model:** COCO-80 YOLOX-S (Apache-2.0), loaded only from
  `Resources.Load<ModelAsset>("Models/yolox_s")`, input `[1,3,640,640]`, raw output
  `[1,8400,85]`. `ObjectDetector.InputSize` remains 640.
- **Synchronized capture:** on selected camera renders, `Camera.onPreRender`
  records the render pose/projection and installs a one-render command buffer at
  `CameraEvent.AfterForwardOpaque`. Its background-material blit into a linear,
  480-wide RT follows ARFoundation's background pass and ARCore's render-thread
  fence wait. It is appended after the background commands, including when the
  background uses AfterOpaques. `Camera.onPostRender` removes it and submits
  letterboxing and tensor conversion/readback from the owned RT in graphics-queue
  order. Update never samples an external AR camera texture. Disable/destroy
  removes the command buffer and render callbacks. At most one capture per Unity
  frame and one inference are in flight; `interval` limits capture starts.
- **Preprocessing:** the material applies the displayed camera crop/rotation.
  Bilinear resize to `floor(width*r), floor(height*r)`, top-left on a 640-square
  canvas filled with 114. Linear RTs preserve display bytes. TextureConverter
  emits BGR/NCHW floats in 0..1; the model wrapper multiplies by 255 before YOLOX.
  There is no mean/std normalization. CPU fallback asynchronously reads the same
  padded RT and packs BGR/NCHW using a reusable input array; its tensor is created
  per inference. GPU/OpenCV interpolation can differ by a byte at boundaries.
- **Orientation:** GLES RT row 0 is bottom. TextureConverter explicitly uses
  `CoordOrigin.TopLeft`; CPU packing reverses RT rows. Decode returns Unity
  bottom-left viewport rectangles, undoing letterbox scale and clipping to the
  source. No additional camera rotation/mirroring is applied. Results are dropped
  if screen dimensions change during inference. The camera must fill the screen.
- **Decoding:** stride 8/16/32, `xy=(raw+grid)*stride`, `wh=exp(raw)*stride`;
  score = objectness times best class. Threshold 0.3, class-wise NMS IoU 0.45
  before clipping, plus cross-class suppression when IoU > 0.8. Runtime uses the
  bundled model's already-sigmoided obj/class output, rejecting low-objectness
  rows before scanning classes. Public `Decode(output, srcW, srcH, inputSize)` is
  still pure and retains group-wide sigmoid fallback if finite obj/class values
  leave [0,1]; `GetScoreRanges` remains available for diagnostics/self-tests.
- **Lifecycle and reset:** an independent hidden GameObject polls the session
  while the detector component or its GameObject is disabled. Disabled results
  are discarded; re-enable can capture once the previous request drains, without
  rebuilding a healthy worker. Native readback views are consumed immediately in
  completion callbacks into owned arrays, so a delayed Tick cannot read expired
  data. Transient runtime errors dispose the affected session and retry after
  two seconds while enabled, rather than permanently stopping detection.
  Destruction drains the outstanding request before releasing its source RT;
  session disposal defers worker/RT cleanup until any native readback completes.
  Call **`ResetDetections()` before starting a new room**. It increments a
  generation, cancels queued capture, clears diagnostics, and prevents old-room
  in-flight results from firing `OnDetections`. Disable also invalidates results.
- **Performance and ownership:** GPUCompute when supported, otherwise CPU.
  Scheduling remains limited to 24 GPU / 4 CPU layers and about 3 ms per pump
  update (one layer is indivisible). GPU output readback requests exactly 714,000
  floats (~2.86 MB), copies them in its completion callback to a pooled,
  exact-sized `float[]`, and reuses it for subsequent inferences. CPU output is
  copied directly from its completed tensor view. No `DownloadToArray` or full
  managed output allocation per inference. `InferenceSession.Tick` returns a
  **borrowed buffer valid until the next Begin or Dispose**; copy it if retaining
  raw outputs. `LastInferenceMs` measures inference wall latency including
  preprocessing, scheduling slices and readback; `LastDecodeMs` measures the
  published result's synchronous main-thread decode/NMS. Decoding is still one
  call; profile dense scenes. Startup model compilation and CPU input packing
  also have costs. Async GPU readback is required on both backends.

**Integrator validation (Unity was not launched for this change):**

1. Compile and run `RaidRift.EditorTools.DetectorSelfTest.Run` with graphics
   enabled. `InferenceSession`, `Begin/Tick/Busy/OutputShape/LastInferenceMs`,
   `Letterbox`, `InputTransform`, `GetScoreRanges`, and `Decode` remain compatible.
   Optional `-detectorCPU` exercises CPU inference. Existing synthetic checks cover
   landscape/portrait boxes, logits, class-wise and cross-class suppression;
   preprocessing probes cover pad/BGR/y orientation. Real-image annotations are
   written to `Builds/detector/`.
2. On GLES3 ARM64, verify the complete **command-buffer background blit -> RT ->
   letterbox -> tensor** path in portrait and both landscape orientations. Check
   asymmetric top/bottom and left/right details, crop, BGR, pad 114, and absence
   of gamma changes on GPUCompute and CPU. The editor probe starts at a texture;
   it does not prove external-camera blit orientation or ARCore synchronization.
3. Disable/re-enable the component and its GameObject during CPU input readback,
   sliced scheduling, and GPU output readback. Repeat with screen rotation and
   owner destruction. Verify no expired readback, stale event, duplicate capture
   buffer, or permanent stop; inspect the independent pump's eventual cleanup.
4. Reset rooms during queued capture and each inference phase. Confirm no old-room
   event fires and the next result uses the new room/render pose. Wire
   `ResetDetections()` into the integrator's room-reset flow.
5. Profile `LastInferenceMs`, `LastDecodeMs`, callbacks, and GC allocations on
   device, including dense detections and tracking loss. No device timings are
   claimed here.
