using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RaidRift.EditorTools
{
    /// <summary>Renders the rift effect in a stand-in room on the build PC's GPU (no phone needed):
    /// Unity.exe -batchmode -projectPath . -executeMethod RaidRift.EditorTools.RiftPreview.Render -quit
    /// (without -nographics). PNGs go to Builds/preview.</summary>
    public static class RiftPreview
    {
        public static void Render()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var outDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", "preview"));
            Directory.CreateDirectory(outDir);

            // Stand-in "real room": dark floor, a bed, a wall. In the app these are the scanned mesh, drawn
            // as an invisible occluder + Rift paint; here they also get a plain colour to stand for the camera image.
            var plain = new Material(Shader.Find("Unlit/Color")) { color = new Color(0.55f, 0.52f, 0.48f) };
            var bedMat = new Material(Shader.Find("Unlit/Color")) { color = new Color(0.78f, 0.8f, 0.85f) };
            var paint = AssetDatabase.LoadAssetAtPath<Material>("Assets/RaidRift/Resources/Materials/RiftPaint.mat");
            GameObject Room(PrimitiveType type, Vector3 pos, Vector3 scale, Material m)
            {
                var g = GameObject.CreatePrimitive(type);
                g.transform.position = pos;
                g.transform.localScale = scale;
                g.GetComponent<Renderer>().sharedMaterials = new[] { m, paint };
                return g;
            }
            Room(PrimitiveType.Cube, new Vector3(0, -0.05f, 0), new Vector3(8, 0.1f, 8), plain);
            Room(PrimitiveType.Cube, new Vector3(1.6f, 0.25f, 0.3f), new Vector3(1.0f, 0.5f, 2.0f), bedMat);
            Room(PrimitiveType.Cube, new Vector3(0, 1.3f, 2.6f), new Vector3(8, 2.6f, 0.1f), plain);

            var camGo = new GameObject("Phone");
            var cam = camGo.AddComponent<Camera>();
            cam.fieldOfView = 62f;
            cam.nearClipPlane = 0.03f;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Color.gray;
            cam.cullingMask = ~(1 << RiftWorld.Layer);
            camGo.transform.position = new Vector3(0, 1.25f, -1.6f);
            camGo.transform.LookAt(new Vector3(0, 0.35f, 1.2f));

            var rift = RiftWorld.Create(new Vector3(0, 0, 1.2f), camGo.transform.position, cam);
            rift.transform.Find("Rift Window").localScale = new Vector3(RiftWorld.WindowWidth, RiftWorld.WindowHeight, 1f);
            Shader.SetGlobalVector("_RiftCenter", rift.transform.position);
            Shader.SetGlobalFloat("_RiftRadius", 1.25f);

            // A KayKit hero standing on the real floor in front of the rift, one still inside.
            foreach (var (model, pos, inside) in new[] { ("Mage", new Vector3(-0.2f, 0, 0.75f), false), ("Rogue", new Vector3(0.15f, 0, 2.1f), true) })
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"Assets/RaidRift/Resources/Characters/{model}.glb");
                if (prefab == null) continue;
                var h = (GameObject)Object.Instantiate(prefab);
                h.transform.position = pos;
                h.transform.rotation = Quaternion.LookRotation(Vector3.back);
                h.transform.localScale = Vector3.one * (Hero.Height / 2.19f);
                if (inside) foreach (var t in h.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = RiftWorld.Layer;
            }

            var riftCam = cam.transform.Find("Rift Camera").GetComponent<Camera>();
            var shots = new[]
            {
                (new Vector3(0, 1.25f, -1.6f), new Vector3(0, 0.35f, 1.2f), "front"),
                (new Vector3(-1.3f, 1.1f, -1.0f), new Vector3(0.1f, 0.4f, 1.4f), "left"),
                (new Vector3(0.9f, 0.6f, -0.6f), new Vector3(-0.1f, 0.35f, 1.4f), "low-right"),
            };
            var rt = new RenderTexture(1080, 1920, 24);
            foreach (var (pos, look, name) in shots)
            {
                camGo.transform.position = pos;
                camGo.transform.LookAt(look);
                cam.aspect = 1080f / 1920f;
                riftCam.aspect = cam.aspect;
                riftCam.fieldOfView = cam.fieldOfView;
                riftCam.projectionMatrix = cam.projectionMatrix;
                riftCam.Render();
                cam.targetTexture = rt;
                cam.Render();
                RenderTexture.active = rt;
                var tex = new Texture2D(rt.width, rt.height, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
                tex.Apply();
                File.WriteAllBytes(Path.Combine(outDir, $"rift-{name}.png"), tex.EncodeToPNG());
                RenderTexture.active = null;
                cam.targetTexture = null;
                Debug.Log("[RaidRift] preview " + name);
            }
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
    }
}
