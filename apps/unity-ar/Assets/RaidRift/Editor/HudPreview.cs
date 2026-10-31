using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

namespace RaidRift.EditorTools
{
    /// <summary>Renders the phone HUD over a room photo for design review (no phone needed):
    /// Unity.exe -batchmode -projectPath . -executeMethod RaidRift.EditorTools.HudPreview.Render (without -nographics).
    /// PNGs (landscape 2340x1080) go to Builds/preview/hud-*.png.</summary>
    public static class HudPreview
    {
        public static void Render()
        {
            int code = 0;
            try
            {
                var dir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", "preview"));
                Directory.CreateDirectory(dir);
                Shot(dir, "hud-scanning", hud => { hud.SetMode(false, "DEMO"); hud.SetStatus("Offline demo · 0 heroes", "diag", "Sweep the phone over the floor and furniture"); hud.SetScan(0.42f, "Scanning"); });
                Shot(dir, "hud-demo", hud =>
                {
                    hud.SetMode(false, "DEMO");
                    hud.SetStatus("Test raid · 3 heroes", "diag", "");
                    hud.SetScan(1f, "");
                    hud.SetButton("follow", "Following", true);
                    hud.SetFeed(new[] {
                        new ChatLine { Speaker = "pixelknight", Text = "go go go!" }, new ChatLine { Speaker = "mothmage", Text = "!jump on 3" },
                        new ChatLine { Speaker = "RaidRift", Text = "mothmage → jump on spot 3", System = true }, new ChatLine { Speaker = "greenbean", Text = "portal time" },
                        new ChatLine { Speaker = "lunarfox", Text = "sit on the sofa" } });
                });
                Shot(dir, "hud-live", hud =>
                {
                    hud.SetMode(true, "● LIVE 24:17");
                    hud.SetLiveStats(5, 4200);
                    hud.SetStatus("Live", "diag", "");
                    hud.SetScan(1f, "");
                    hud.Toast("RAID from Streamer · 42 viewers", 10f);
                    hud.SetFeed(new[] { new ChatLine { Speaker = "voidturtle", Text = "RAID!!!" }, new ChatLine { Speaker = "mothmage", Text = "42 strong" } });
                });
                Shot(dir, "hud-setup", hud => { hud.SetMode(false, "DEMO"); hud.SetStatus("Offline demo", "v0.19 · 3D map · 21 pieces · floor 1.3 m below", ""); hud.SetScan(1f, ""); hud.ToggleSetup("https://raidrift-pc.tail7252b4.ts.net"); hud.SetLiveInfo("Streams the AR view (no buttons) + mic + game sound to Twitch.", "Quality · HD · 4.5 Mbps", "dusyaaaaaaaa"); });
            }
            catch (System.Exception e) { Debug.LogError("[RaidRift] hud preview failed: " + e); code = 2; }
            if (Application.isBatchMode) EditorApplication.Exit(code);
        }

        static void Shot(string dir, string name, System.Action<Hud> setup)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            const int w = 2340, h = 1080;
            var camGo = new GameObject("Cam");
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.25f, 0.2f, 0.18f);
            var rt = new RenderTexture(w, h, 24, RenderTextureFormat.ARGB32);
            cam.targetTexture = rt;
            var hud = new GameObject("HudHost").AddComponent<Hud>();
            hud.Build();
            var canvas = Object.FindFirstObjectByType<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceCamera;
            canvas.worldCamera = cam;
            canvas.planeDistance = 1f;
            // Room photo backdrop (local test frame; not committed).
            var photo = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Tools", "testimages", "bed2.jpg"));
            if (File.Exists(photo))
            {
                var tex = new Texture2D(2, 2);
                tex.LoadImage(File.ReadAllBytes(photo));
                hud.SetBackdrop(tex);
            }
            setup(hud);
            Canvas.ForceUpdateCanvases();
            cam.Render();
            RenderTexture.active = rt;
            var outTex = new Texture2D(w, h, TextureFormat.RGB24, false);
            outTex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
            outTex.Apply();
            RenderTexture.active = null;
            File.WriteAllBytes(Path.Combine(dir, name + ".png"), outTex.EncodeToPNG());
            Debug.Log("[RaidRift] hud preview " + name);
        }
    }
}
