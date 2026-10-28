# ADR 002: opt-in image-space surface estimation

Observed in actual licensed dog footage: a bounding box can include a raised tail, so placing a character at its top-center produces an obvious floating contact. A bounding box alone is insufficient evidence for silhouette contact.

Add an optional local-only segmentation worker. It receives an ephemeral ImageBitmap, segments one permitted animal/furniture target, extracts a confident upper contour near the target center, and returns only an anchor. Raw masks/frames are not transmitted or stored. Cache anchors relative to tracked boxes for a short interval. Reset epoch and dispose worker/bitmaps on disconnect. No human segmentation or re-identification is performed.

Official current MediaPipe documentation recommends the v2 stateful InteractiveSegmenter. On this workstation, v2 initialized and encoded an image but stalled at native decoding for the tested window. The packaged runtime also declares BrushMode as an enum without exporting a runtime value. A tested fallback uses InteractiveSegmenterLegacy with the exact 6,227,884-byte MagicTouch float32 checkpoint, SHA-256 `e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25`. Google's model card identifies the original checkpoint architecture and Apache-2.0 terms. Preserve its notices. V2 is not the active pipeline.

This is a deliberate, evidence-driven compatibility choice. Reassess the stateful API after upstream/runtime/device changes. Segmentation is experimental, defaults off, and is not calibrated visual quest proof. Native AR anchors/depth remain a separate implementation path. Detector misses, low light, near-overlapping targets and camera movement still need broader evaluation.

Sources: [current web API](https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter/web_js), [legacy comparison](https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter), [MagicTouch model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf). Exact runtime signatures were also checked in the installed official package's declaration and source files.
