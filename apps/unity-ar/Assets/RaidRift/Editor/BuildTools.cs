using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine;
using UnityEngine.InputSystem; // InputActionSetupExtensions.AddBinding
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.Management;
using Unity.XR.CoreUtils;

namespace RaidRift.EditorTools
{
    /// <summary>One-shot project setup and Android build, runnable from the menu or batch mode:
    /// Unity.exe -batchmode -quit -projectPath apps/unity-ar -executeMethod RaidRift.EditorTools.BuildTools.BuildAndroid
    /// Everything the scene needs is generated here, so the repo holds code, not hand-edited YAML.</summary>
    public static class BuildTools
    {
        const string Root = "Assets/RaidRift";
        const string Resources = Root + "/Resources";
        const string ScenePath = Root + "/Scenes/Main.unity";
        const string ChunkPrefab = Root + "/Prefabs/RoomMeshChunk.prefab";
        public const string Version = "0.18.1";
        public const int VersionCode = 14;

        [MenuItem("RaidRift/Set up project")]
        public static void SetupMenu() => Setup();

        public static bool Setup()
        {
            Folders();
            ImportCharacters();
            Materials();
            ChunkPrefabAsset();
            bool xr = ConfigureXR();
            ConfigurePlayer();
            BuildScene();
            AssetDatabase.SaveAssets();
            Debug.Log("[RaidRift] Setup complete" + (xr ? "" : " · XR loader NOT configured"));
            return xr;
        }

        [MenuItem("RaidRift/Build Android APK")]
        public static void BuildAndroid()
        {
            // Android first: the NSDK/ARCore loader types are platform assemblies.
            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android);
            EditorUserBuildSettings.buildAppBundle = false;
            if (!Setup())
            {
                Debug.LogError("[RaidRift] Setup failed; not building.");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
            var output = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", $"RaidRift-unity-{Version}.apk"));
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = output,
                target = BuildTarget.Android,
                options = BuildOptions.None
            });
            Debug.Log($"[RaidRift] Build {report.summary.result} · {report.summary.totalErrors} errors · {output}");
            if (Application.isBatchMode) EditorApplication.Exit(report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded ? 0 : 1);
        }

        static void Folders()
        {
            foreach (var f in new[] { Resources + "/Materials", Resources + "/Characters", Root + "/Prefabs", Root + "/Scenes", "Assets/XR" })
                Directory.CreateDirectory(f);
            AssetDatabase.Refresh();
        }

        // ---------- characters ----------
        static void ImportCharacters()
        {
            // KayKit Character Pack Adventures 1.0 by Kay Lousberg, CC0-1.0 (same files the web/Android apps use).
            var candidates = new[]
            {
                Environment.GetEnvironmentVariable("RAIDRIFT_KAYKIT") ?? "",
                Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "web", "public", "models", "kaykit")),
                @"C:\Users\Andrii PC\Documents\Codex\2026-10-27\extract-the-attached-zip-then-read\raidrift-handoff\raidrift-codex-handoff\apps\web\public\models\kaykit",
            };
            var source = candidates.FirstOrDefault(c => c.Length > 0 && Directory.Exists(c));
            if (source == null)
            {
                if (File.Exists($"{Resources}/Characters/Knight.glb")) return; // already imported
                Debug.LogError("[RaidRift] KayKit models not found; set RAIDRIFT_KAYKIT to apps/web/public/models/kaykit");
                return;
            }
            foreach (var name in new[] { "Knight", "Mage", "Rogue", "Barbarian" })
            {
                var from = Path.Combine(source, name + ".glb");
                var to = $"{Resources}/Characters/{name}.glb";
                if (File.Exists(from) && (!File.Exists(to) || new FileInfo(from).Length != new FileInfo(to).Length)) File.Copy(from, to, true);
            }
            var license = Path.Combine(source, "LICENSE.txt");
            if (File.Exists(license)) File.Copy(license, $"{Resources}/Characters/KAYKIT-LICENSE.txt", true);
            AssetDatabase.Refresh();
            foreach (var name in new[] { "Knight", "Mage", "Rogue", "Barbarian" })
            {
                var path = $"{Resources}/Characters/{name}.glb";
                var importer = AssetImporter.GetAtPath(path);
                if (importer == null) continue;
                // glTFast importer: legacy Animation clips (Hero.cs plays them by name).
                var so = new SerializedObject(importer);
                bool changed = false;
                var it = so.GetIterator();
                while (it.Next(true))
                {
                    if (it.propertyType == SerializedPropertyType.Enum && it.name.IndexOf("animationMethod", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        int legacy = Array.FindIndex(it.enumNames, n => n.Equals("Legacy", StringComparison.OrdinalIgnoreCase));
                        if (legacy >= 0 && it.enumValueIndex != legacy) { it.enumValueIndex = legacy; changed = true; }
                    }
                }
                if (changed) { so.ApplyModifiedPropertiesWithoutUndo(); importer.SaveAndReimport(); }
            }
        }

        // ---------- materials ----------
        static void Materials()
        {
            Mat("ScanMesh", "RaidRift/ScanMesh", m =>
            {
                m.SetColor("_Color", new Color(0.7f, 0.55f, 1f, 0.35f));
                m.SetColor("_SideColor", new Color(1f, 0.55f, 0.75f, 0.30f));
            });
            Mat("Walkable", "RaidRift/ScanMesh", m =>
            {
                m.SetColor("_Color", new Color(0.55f, 1f, 0.85f, 0.45f));
                m.SetColor("_SideColor", new Color(0.55f, 1f, 0.85f, 0.45f));
                m.SetFloat("_Grid", 20f);
                m.renderQueue = 3001;
            });
            Mat("DepthOnly", "RaidRift/DepthOnly", m => { });
            Mat("VoxelLit", "RaidRift/VoxelLit", m => { });
            Mat("Glow", "RaidRift/Glow", m => { m.enableInstancing = true; });
            Mat("BlobShadow", "RaidRift/BlobShadow", m => { m.enableInstancing = true; });
            Mat("RiftSky", "RaidRift/RiftSky", m => { });
            Mat("RiftWindow", "RaidRift/RiftWindow", m => { });
            Mat("RiftPaint", "RaidRift/RiftPaint", m => { });
            Mat("PortalSwirl", "RaidRift/Portal", m => { });
            Mat("CameraFeel", "RaidRift/CameraFeel", m => { });
            Mat("FxAdd", "Mobile/Particles/Additive", m => { });         // RiftFx sparks/rings/flares (Kenney CC0 textures)
            Mat("FxAlpha", "Mobile/Particles/Alpha Blended", m => { });  // RiftFx dust/smoke
            Mat("Obsidian", "RaidRift/Toon", m => { m.SetColor("_Color", new Color(0.13f, 0.08f, 0.22f)); m.SetColor("_Emission", new Color(0.05f, 0.01f, 0.1f)); m.SetColor("_Rim", new Color(0.7f, 0.45f, 1f)); });
            Mat("Crystal", "RaidRift/Toon", m => { m.SetColor("_Color", new Color(0.35f, 0.95f, 0.85f)); m.SetColor("_Emission", new Color(0.12f, 0.45f, 0.4f)); m.SetColor("_Rim", Color.white); });
            Mat("Gold", "RaidRift/Toon", m => { m.SetColor("_Color", new Color(1f, 0.8f, 0.35f)); m.SetColor("_Emission", new Color(0.3f, 0.2f, 0.02f)); m.SetColor("_Rim", new Color(1f, 0.95f, 0.7f)); });
        }

        static void Mat(string name, string shader, Action<Material> configure)
        {
            var path = $"{Resources}/Materials/{name}.mat";
            var s = Shader.Find(shader);
            if (s == null) { Debug.LogError("[RaidRift] Shader missing: " + shader); return; }
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null) { m = new Material(s); AssetDatabase.CreateAsset(m, path); }
            m.shader = s;
            configure(m);
            EditorUtility.SetDirty(m);
        }

        static void ChunkPrefabAsset()
        {
            var go = new GameObject("RoomMeshChunk");
            go.AddComponent<MeshFilter>();
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = AssetDatabase.LoadAssetAtPath<Material>($"{Resources}/Materials/ScanMesh.mat");
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            PrefabUtility.SaveAsPrefabAsset(go, ChunkPrefab);
            UnityEngine.Object.DestroyImmediate(go);
        }

        // ---------- XR ----------
        static bool ConfigureXR()
        {
            if (!EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.k_SettingsKey, out XRGeneralSettingsPerBuildTarget perTarget) || perTarget == null)
            {
                perTarget = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                AssetDatabase.CreateAsset(perTarget, "Assets/XR/XRGeneralSettingsPerBuildTarget.asset");
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, perTarget, true);
            }
            if (!perTarget.HasSettingsForBuildTarget(BuildTargetGroup.Android))
            {
                var general = ScriptableObject.CreateInstance<XRGeneralSettings>();
                general.name = "Android Settings";
                var manager = ScriptableObject.CreateInstance<XRManagerSettings>();
                manager.name = "Android Providers";
                general.Manager = manager;
                AssetDatabase.AddObjectToAsset(general, perTarget);
                AssetDatabase.AddObjectToAsset(manager, perTarget);
                perTarget.SetSettingsForBuildTarget(BuildTargetGroup.Android, general);
                EditorUtility.SetDirty(perTarget);
                AssetDatabase.SaveAssets();
            }
            var settings = perTarget.SettingsForBuildTarget(BuildTargetGroup.Android);
            // Niantic Spatial's loader wraps ARCore and adds meshing; plain ARCore is the fallback.
            // Runtime/Loader/NsdkARCoreLoader.cs in nsdk-library-upm: `public class NsdkARCoreLoader : ARCoreLoader`.
            var nsdk = FindType("NianticSpatial.NSDK.AR.Loader.NsdkARCoreLoader");
            bool nsdkInstalled = FindType("NianticSpatial.NSDK.AR.Meshing.NsdkMeshingExtension") != null;
            const string arcore = "UnityEngine.XR.ARCore.ARCoreLoader";
            bool ok;
            if (nsdk != null)
            {
                XRPackageMetadataStore.RemoveLoader(settings.Manager, arcore, BuildTargetGroup.Android);
                ok = XRPackageMetadataStore.AssignLoader(settings.Manager, nsdk.FullName, BuildTargetGroup.Android)
                     || settings.Manager.activeLoaders.Any(l => l != null && l.GetType() == nsdk);
                if (!ok) Debug.LogError("[RaidRift] Could not assign the NSDK loader; enable 'Niantic Spatial SDK' under XR Plug-in Management > Android.");
            }
            else if (nsdkInstalled)
            {
                // Never silently ship plain ARCore when the room mesh was intended.
                Debug.LogError("[RaidRift] NSDK is installed but its ARCore loader type was not found; check the package's Runtime/Loader.");
                ok = false;
            }
            else
            {
                Debug.LogWarning("[RaidRift] NSDK not installed: building with plain ARCore (planes only, no room mesh).");
                ok = XRPackageMetadataStore.AssignLoader(settings.Manager, arcore, BuildTargetGroup.Android)
                     || settings.Manager.activeLoaders.Any(l => l != null && l.GetType().FullName == arcore);
            }
            EditorUtility.SetDirty(settings.Manager);
            return ok;
        }

        static void SetFloat(SerializedObject so, string name, float value)
        {
            var p = so.FindProperty(name);
            if (p != null) p.floatValue = value;
            else Debug.LogWarning("[RaidRift] missing serialized field " + name);
        }

        static Type FindType(string fullName) =>
            AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType(fullName, false)).FirstOrDefault(t => t != null);

        // ---------- player ----------
        static void ConfigurePlayer()
        {
            var android = NamedBuildTarget.Android;
            PlayerSettings.companyName = "RaidRift";
            PlayerSettings.productName = "RaidRift MR";
            PlayerSettings.SetApplicationIdentifier(android, "world.raidrift.mr");
            PlayerSettings.bundleVersion = Version;
            PlayerSettings.Android.bundleVersionCode = VersionCode;
            PlayerSettings.SetScriptingBackend(android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel25;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.OpenGLES3 });
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            PlayerSettings.Android.forceInternetPermission = true;
            // Classic Activity entry: GameActivity needs CMake in the SDK and buys nothing for ARCore.
            PlayerSettings.Android.applicationEntry = AndroidApplicationEntry.Activity;
            // Everything (camera pose, HUD, taps) uses the Input System package; legacy input is not needed.
            var asset = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset").FirstOrDefault();
            if (asset != null)
            {
                var so = new SerializedObject(asset);
                var p = so.FindProperty("activeInputHandler");
                if (p != null && p.intValue == 0) { p.intValue = 1; so.ApplyModifiedPropertiesWithoutUndo(); }
                // LIVE: enable the repository and credential-safe logging templates for RootEncoder.
                foreach (var name in new[] { "useCustomGradleSettingsTemplate", "useCustomLauncherGradleManifest", "useCustomGradlePropertiesTemplate" })
                {
                    var template = so.FindProperty(name);
                    if (template != null) template.boolValue = true;
                }
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            // Debug server over Tailscale may be plain http to a 100.x address: allow cleartext like the native debug build.
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed;
        }

        // ---------- scene ----------
        static void BuildScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var sessionGo = new GameObject("AR Session");
            var session = sessionGo.AddComponent<ARSession>();
            sessionGo.AddComponent<ARInputManager>();

            var originGo = new GameObject("XR Origin");
            var origin = originGo.AddComponent<XROrigin>();
            var offset = new GameObject("Camera Offset");
            offset.transform.SetParent(originGo.transform, false);
            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            camGo.transform.SetParent(offset.transform, false);
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Color.black;
            cam.nearClipPlane = 0.03f;
            cam.farClipPlane = 30f;
            cam.cullingMask = ~(1 << RiftWorld.Layer); // the rift world is only seen through its window
            camGo.AddComponent<AudioListener>();
            camGo.AddComponent<CameraFeel>(); // shake/flash/bloom on the composited image (phone + stream)
            var cameraManager = camGo.AddComponent<ARCameraManager>();
            camGo.AddComponent<ARCameraBackground>();
            var tpd = camGo.AddComponent<UnityEngine.InputSystem.XR.TrackedPoseDriver>();
            ConfigurePoseDriver(tpd);
            origin.Camera = cam;
            origin.CameraFloorOffsetObject = offset;
            // Phone AR reports real device height; no artificial standing offset (else the camera sits ~1.1 m too high).
            origin.RequestedTrackingOriginMode = XROrigin.TrackingOriginMode.NotSpecified;
            origin.CameraYOffset = 0f;
            var planes = originGo.AddComponent<ARPlaneManager>();
            planes.requestedDetectionMode = UnityEngine.XR.ARSubsystems.PlaneDetectionMode.Horizontal;

            // Room mesh (Niantic Spatial meshing through AR Foundation's meshing subsystem).
            var meshGo = new GameObject("Room Meshing");
            meshGo.transform.SetParent(originGo.transform, false);
            var meshes = meshGo.AddComponent<ARMeshManager>();
            meshes.meshPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(ChunkPrefab).GetComponent<MeshFilter>();
            meshes.density = 0.5f;
            meshes.normals = true;
            var ext = FindType("NianticSpatial.NSDK.AR.Meshing.NsdkMeshingExtension");
            if (ext != null)
            {
                var meshing = new SerializedObject(meshGo.AddComponent(ext));
                // City walks: drop mesh blocks 25 m behind the streamer so memory stays bounded for hours.
                SetFloat(meshing, "_meshCullingDistance", 25f);
                meshing.ApplyModifiedPropertiesWithoutUndo();
            }

            // Live depth occlusion (Niantic depth, fused with the room mesh): real things hide the heroes per pixel.
            var occlusion = camGo.AddComponent<AROcclusionManager>();
            occlusion.requestedEnvironmentDepthMode = UnityEngine.XR.ARSubsystems.EnvironmentDepthMode.Medium;
            occlusion.environmentDepthTemporalSmoothingRequested = true;
            var occExt = FindType("NianticSpatial.NSDK.AR.Occlusion.NsdkOcclusionExtension");
            if (occExt != null)
            {
                var oe = new SerializedObject(camGo.AddComponent(occExt));
                var mm = oe.FindProperty("_meshManager");
                if (mm != null) mm.objectReferenceValue = meshes;
                var fr = oe.FindProperty("_targetFrameRate");
                if (fr != null) fr.longValue = 20; // GPU budget shared with meshing and the detector
                oe.ApplyModifiedPropertiesWithoutUndo();
            }

            var lightGo = new GameObject("Sun");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1f;
            light.shadows = LightShadows.None;
            lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
            lightGo.AddComponent<LightMatch>().cameraManager = cameraManager;

            var appGo = new GameObject("RaidRift");
            var room = appGo.AddComponent<RoomNavigation>();
            room.meshManager = meshes;
            room.planeManager = planes;
            room.cameraTransform = camGo.transform;
            var server = appGo.AddComponent<ServerConnection>();
            var trail = appGo.AddComponent<RiftTrail>();
            trail.room = room;
            trail.cameraTransform = camGo.transform;
            appGo.AddComponent<Sfx>();
            appGo.AddComponent<Fx>();
            var riftFx = appGo.AddComponent<RiftFx>();
            GameObject Cfxr(string p) => AssetDatabase.LoadAssetAtPath<GameObject>("Assets/JMO Assets/Cartoon FX Remaster/CFXR Prefabs/" + p + ".prefab");
            riftFx.impactGlow = Cfxr("Impacts/CFXR Impact Glowing HDR (Blue)");
            riftFx.groundHit = Cfxr("Impacts/CFXR2 Ground Hit");
            riftFx.magicPoof = Cfxr("Misc/CFXR Magic Poof");
            riftFx.hitLight = Cfxr("Light/CFXR3 Hit Light B (Air)");
            riftFx.comicWow = Cfxr("Texts/CFXR3 _WOW_");
            riftFx.firework = Cfxr("Explosions/CFXR4 Firework 1 Cyan-Purple (HDR)");
            if (riftFx.impactGlow == null) Debug.LogWarning("[RaidRift] Cartoon FX Remaster not imported; RiftFx uses its own particles only");
            var moths = new GameObject("Rift Moths").AddComponent<RiftMoths>();
            var hud = appGo.AddComponent<Hud>();
            var app = appGo.AddComponent<RaidRiftApp>();
            app.session = session;
            app.arCamera = cam;
            app.meshManager = meshes;
            app.room = room;
            app.server = server;
            app.trail = trail;
            app.hud = hud;
            var stream = appGo.AddComponent<StreamOutput>();
            stream.arCamera = cam;
            stream.server = server;
            stream.hud = hud;
            app.stream = stream;
            app.moths = moths;
            var sceneTracks = appGo.AddComponent<SceneTracks>();
            sceneTracks.arCamera = cam;
            sceneTracks.server = server;
            sceneTracks.room = room;
            app.sceneTracks = sceneTracks;
            // Live mode: RTMPS straight from the phone to Twitch (clean AR composite + mic + game audio).
            app.publisher = appGo.AddComponent<LivePublisher>();
            app.publisher.arCamera = cam;
            // On-device object understanding: YOLOX-Tiny (COCO) -> labelled surfaces in the 3D map.
            var detector = appGo.AddComponent<ObjectDetector>();
            detector.arCamera = cam;
            var labels = appGo.AddComponent<SurfaceLabels>();
            labels.room = room;
            labels.detector = detector;
            sceneTracks.labels = labels;
            app.detector = detector;
            app.surfaceLabels = labels;

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }

        /// <summary>Camera pose from the handheld AR device (position + rotation), like AR Foundation's
        /// own "XR Origin (Mobile AR)" template.</summary>
        static void ConfigurePoseDriver(UnityEngine.InputSystem.XR.TrackedPoseDriver tpd)
        {
            var position = new UnityEngine.InputSystem.InputAction("Position", UnityEngine.InputSystem.InputActionType.Value, expectedControlType: "Vector3");
            position.AddBinding("<HandheldARInputDevice>/devicePosition");
            position.AddBinding("<XRHMD>/centerEyePosition");
            var rotation = new UnityEngine.InputSystem.InputAction("Rotation", UnityEngine.InputSystem.InputActionType.Value, expectedControlType: "Quaternion");
            rotation.AddBinding("<HandheldARInputDevice>/deviceRotation");
            rotation.AddBinding("<XRHMD>/centerEyeRotation");
            tpd.positionInput = new UnityEngine.InputSystem.InputActionProperty(position);
            tpd.rotationInput = new UnityEngine.InputSystem.InputActionProperty(rotation);
            tpd.trackingType = UnityEngine.InputSystem.XR.TrackedPoseDriver.TrackingType.RotationAndPosition;
            tpd.updateType = UnityEngine.InputSystem.XR.TrackedPoseDriver.UpdateType.UpdateAndBeforeRender;
        }
    }
}
