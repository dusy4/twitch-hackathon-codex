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
                    LiveHealthy(hud);
                    hud.Toast("RAID from Streamer · 42 viewers", 10f);
                    hud.SetFeed(new[] { new ChatLine { Speaker = "voidturtle", Text = "RAID!!!" }, new ChatLine { Speaker = "mothmage", Text = "42 strong" } });
                });
                Shot(dir, "hud-setup", hud => { hud.SetMode(false, "DEMO"); hud.SetStatus("Offline demo", "v0.19 · 3D map · 21 pieces · floor 1.3 m below", ""); hud.SetScan(1f, ""); hud.ToggleSetup("https://raidrift-pc.tail7252b4.ts.net"); hud.SetLiveInfo("Streams the AR view (no buttons) + mic + game sound to Twitch.", "Quality · HD · 4.5 Mbps", "dusyaaaaaaaa"); });
            }
            catch (System.Exception e) { Debug.LogError("[RaidRift] hud preview failed: " + e); code = 2; }
            try
            {
                var dir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", "preview"));
                _w = 1080; _h = 2340; // portrait, as the owner streams
                Shot(dir, "hud-portrait-demo", hud => { hud.SetMode(false, "DEMO"); hud.SetStatus("Test raid · 3 heroes", "diag", ""); hud.SetScan(1f, ""); hud.SetFeed(new[] { new ChatLine { Speaker = "pixelknight", Text = "go go go!" }, new ChatLine { Speaker = "mothmage", Text = "!jump on 3" } }); });
                Shot(dir, "hud-portrait-setup", hud => { hud.SetMode(false, "DEMO"); hud.SetStatus("Offline demo", "v0.20 · 3D map · 21 pieces · floor 1.3 m below", ""); hud.SetScan(1f, ""); hud.ToggleSetup("https://raidrift-pc.tail7252b4.ts.net"); hud.SetLiveInfo("Streams the AR view (no buttons) + mic + game sound to Twitch.", "HD · 4.5 Mbps", "dusyaaaaaaaa"); hud.SetSetting("scan", "Hidden"); hud.SetSetting("sound", "On"); hud.SetSetting("motion", "Off"); });
                Shot(dir, "hud-portrait-live", hud =>
                {
                    LiveHealthy(hud);
                    hud.Toast("RAID from Streamer · 42 viewers", 10f);
                    hud.SetFeed(new[] { new ChatLine { Speaker = "voidturtle", Text = "RAID!!!" }, new ChatLine { Speaker = "mothmage", Text = "42 strong" },
                        new ChatLine { Speaker = "RaidRift", Text = "mothmage joined as a hero", System = true } });
                });
                // Bad network on a hot phone: amber/red bars, drop warning, low battery, muted mic.
                Shot(dir, "hud-portrait-live-weak", hud =>
                {
                    hud.SetMode(true, "● LIVE 1:02:41");
                    hud.SetLiveInfo("live", "HD · 4.5 Mbps", "");
                    hud.SeedBitrateHistory(new[] { 4400, 4300, 4500, 4100, 3900, 3600, 3000, 2600, 2400, 2100, 1900, 2300, 2000, 1600, 1500, 1300, 1400, 1100, 1200, 900, 1000, 1300, 1200, 1100, 900, 800, 1000, 1100, 900, 1200 });
                    hud.SetLiveStats(2, 1200);
                    hud.SetStreamHealth(30, 40);
                    hud.SetStreamHealth(22, 77);
                    hud.SetDeviceStatus(0.14f, false);
                    hud.SetThermal(44.2f);
                    hud.SetMicLevel(0.4f);
                    hud.SetButton("mic", "Mic off", false);
                    hud.SetStatus("Live", "diag", "");
                    hud.SetScan(1f, "");
                });
                Shot(dir, "hud-portrait-connecting", hud =>
                {
                    hud.SetMode(true, "● CONNECTING");
                    hud.SetLiveStats(0, 0);
                    hud.SetDeviceStatus(0.67f, true);
                    hud.SetThermal(33f);
                    hud.SetStatus("Live", "diag", "");
                    hud.SetScan(0.3f, "Scanning");
                    hud.Toast("Connecting to Twitch…", 10f);
                });
            }
            catch (System.Exception e) { Debug.LogError("[RaidRift] hud preview failed: " + e); code = 2; }
            if (Application.isBatchMode) EditorApplication.Exit(code);
        }

        static int _w = 2340, _h = 1080;

        /// <summary>A healthy live stream: steady ~4.2 Mbps on the HD target, warm-ish phone, mic talking.</summary>
        static void LiveHealthy(Hud hud)
        {
            hud.SetMode(true, "● LIVE 24:17");
            hud.SetLiveInfo("live", "HD · 4.5 Mbps", "");
            hud.SeedBitrateHistory(new[] { 4300, 4400, 4200, 4500, 4400, 4100, 3900, 4200, 4400, 4500, 4300, 4200, 4400, 4300, 3800, 3500, 3900, 4200, 4400, 4500, 4400, 4300, 4200, 4400, 4500, 4300, 4100, 4300, 4400, 4200 });
            hud.SetLiveStats(5, 4200);
            hud.SetStreamHealth(30, 0);
            hud.SetDeviceStatus(0.82f, false);
            hud.SetThermal(37.6f);
            hud.SetMicLevel(0.62f);
            hud.SetButton("mic", "Mic on", true);
            hud.SetStatus("Live", "diag", "");
            hud.SetScan(1f, "");
        }

        static void Shot(string dir, string name, System.Action<Hud> setup)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            int w = _w, h = _h;
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
                // The photo is an old phone screenshot: keep only the middle band so its old HUD panels
                // (title card top, button row bottom) don't read as overlaps in the preview.
                int y0 = Mathf.RoundToInt(tex.height * 0.15f), y1 = Mathf.RoundToInt(tex.height * 0.87f);
                var band = new Texture2D(tex.width, y1 - y0, TextureFormat.RGB24, false);
                band.SetPixels(tex.GetPixels(0, y0, tex.width, y1 - y0));
                band.Apply();
                hud.SetBackdrop(band);
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
