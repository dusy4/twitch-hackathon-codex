using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RaidRift.EditorTools
{
    /// <summary>Checks that CameraFeel really changes the final image: renders a test scene calm and mid-impact and
    /// compares them (and writes both PNGs to Builds/preview). Run without -nographics:
    /// Unity.exe -batchmode -projectPath . -executeMethod RaidRift.EditorTools.CameraFeelSelfTest.Run</summary>
    public static class CameraFeelSelfTest
    {
        public static void Run()
        {
            int code = 0;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var cam = new GameObject("Cam").AddComponent<Camera>();
                cam.transform.position = new Vector3(0, 1, -3);
                cam.backgroundColor = new Color(0.2f, 0.2f, 0.25f);
                cam.clearFlags = CameraClearFlags.SolidColor;
                // A checker of cubes so offsets/zoom/chroma are measurable.
                for (int x = -4; x <= 4; x++)
                    for (int y = -2; y <= 4; y++)
                    {
                        if ((x + y) % 2 != 0) continue;
                        var c = GameObject.CreatePrimitive(PrimitiveType.Cube);
                        c.transform.position = new Vector3(x * 0.5f, y * 0.5f, 0);
                        c.transform.localScale = Vector3.one * 0.45f;
                        var m = new Material(Shader.Find("Unlit/Color")) { color = (x + y) % 4 == 0 ? Color.white : new Color(0.9f, 0.3f, 1f) };
                        c.GetComponent<Renderer>().sharedMaterial = m;
                    }
                var feel = cam.gameObject.AddComponent<CameraFeel>();
                var dir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", "preview"));
                Directory.CreateDirectory(dir);
                var calm = Render(cam, Path.Combine(dir, "feel-calm.png"));
                CameraFeel.Impact(1f);
                var hit = Render(cam, Path.Combine(dir, "feel-impact.png"));
                double diff = 0;
                for (int i = 0; i < calm.Length; i++) diff += Mathf.Abs(calm[i].r - hit[i].r) + Mathf.Abs(calm[i].g - hit[i].g) + Mathf.Abs(calm[i].b - hit[i].b);
                diff /= calm.Length;
                bool pass = diff > 0.02;
                Debug.Log($"[RaidRift] camerafeel mean abs diff calm vs impact = {diff:0.0000} {(pass ? "PASS" : "FAIL (impact did not change the image)")}");
                if (!pass) code = 2;
            }
            catch (System.Exception e) { Debug.LogError("[RaidRift] camerafeel selftest: " + e); code = 2; }
            if (Application.isBatchMode) EditorApplication.Exit(code);
        }

        static Color[] Render(Camera cam, string path)
        {
            const int w = 960, h = 540;
            var rt = new RenderTexture(w, h, 24);
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
            tex.Apply();
            RenderTexture.active = null;
            cam.targetTexture = null;
            File.WriteAllBytes(path, tex.EncodeToPNG());
            return tex.GetPixels();
        }
    }
}
