using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RaidRift.EditorTools
{
    /// <summary>Play Mode smoke test of the real scene on the PC (no AR tracking in the editor): starts the app,
    /// presses every HUD/settings button, toggles live-only paths (caption, LiveTick) and offline chat, and fails on
    /// any exception or error log. Never pairs, goes live or opens WebRTC (no server/Twitch side effects).
    /// Unity.exe -batchmode -projectPath . -executeMethod RaidRift.EditorTools.PlaySmoke.Run (without -nographics)</summary>
    [InitializeOnLoad]
    public static class PlaySmoke
    {
        const string Flag = "rr.playsmoke";
        static readonly List<string> Problems = new List<string>();
        static int _frame;

        static readonly string[] Buttons =
        {
            "raid", "follow", "follow", "trail", "trail", "scan", "scan", "scan", "chat", "chat", "setup", "setup",
            "sound", "sound", "motion", "motion", "caption", "caption", "quality", "quality", "quality",
            "selfie", "reset-room", "end-live", "mic", "raid",
        };

        static PlaySmoke()
        {
            if (!SessionState.GetBool(Flag, false)) return;
            Application.logMessageReceived += OnLog;
            EditorApplication.update += Tick;
        }

        public static void Run()
        {
            SessionState.SetBool(Flag, true);
            EditorSceneManager.OpenScene("Assets/RaidRift/Scenes/Main.unity");
            Application.logMessageReceived += OnLog;
            EditorApplication.update += Tick;
            EditorApplication.isPlaying = true;
        }

        static void OnLog(string message, string stack, LogType type)
        {
            if (type != LogType.Exception && type != LogType.Error && type != LogType.Assert) return;
            // Editor-only noise unrelated to the app (licensing, XR without a loader, GPU queries).
            if (message.Contains("Licensing") || message.Contains("d3d12") || message.Contains("XR") || message.Contains("Niantic") || message.Contains("NSDK")) return;
            if (stack != null && stack.Contains("NianticSpatial")) return; // NSDK without an XR loader in the editor
            Problems.Add($"{type}: {message}\n{stack}");
        }

        static void Tick()
        {
            if (!EditorApplication.isPlaying) return;
            _frame++;
            var app = Object.FindFirstObjectByType<RaidRiftApp>();
            if (app == null) { if (_frame > 300) Finish("RaidRiftApp not found in the scene"); return; }
            var button = typeof(RaidRiftApp).GetMethod("Button", BindingFlags.Instance | BindingFlags.NonPublic);
            int step = (_frame - 60) / 8; // one press every 8 frames after warm-up
            if (_frame >= 60 && (_frame - 60) % 8 == 0 && step < Buttons.Length)
            {
                Debug.Log("[RaidRift] playsmoke press " + Buttons[step]);
                try { button.Invoke(app, new object[] { Buttons[step] }); }
                catch (TargetInvocationException e) { Problems.Add("press " + Buttons[step] + ": " + e.InnerException); }
            }
            int after = 60 + Buttons.Length * 8;
            if (_frame == after)
            {
                // Live-only paths without a broadcast: caption + LiveTick + live hint, then back.
                typeof(RaidRiftApp).GetField("_liveMode", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(app, true);
                var send = typeof(RaidRiftApp).GetMethod("SendChat", BindingFlags.Instance | BindingFlags.NonPublic);
                try { send.Invoke(app, new object[] { "dance" }); }
                catch (TargetInvocationException e) { Problems.Add("chat: " + e.InnerException); }
            }
            if (_frame == after + 90) typeof(RaidRiftApp).GetField("_liveMode", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(app, false);
            if (_frame >= after + 150) Finish(null);
        }

        static void Finish(string fatal)
        {
            EditorApplication.update -= Tick;
            Application.logMessageReceived -= OnLog;
            SessionState.SetBool(Flag, false);
            if (fatal != null) Problems.Add(fatal);
            foreach (var p in Problems) Debug.Log("[RaidRift] playsmoke PROBLEM " + p);
            Debug.Log(Problems.Count == 0 ? "[RaidRift] playsmoke PASS (" + _frame + " frames)" : "[RaidRift] playsmoke FAIL " + Problems.Count);
            EditorApplication.isPlaying = false;
            if (Application.isBatchMode) EditorApplication.Exit(Problems.Count == 0 ? 0 : 1);
        }
    }
}
