using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;

namespace RaidRift.EditorTools
{
    /// <summary>Opened interactively (not batch builds) without a Niantic editor token: start NSDK's own
    /// browser login once, and log the outcome (the SDK itself fails silently unless its debug define is set).
    /// Tokens are never logged, only whether one arrived.</summary>
    [InitializeOnLoad]
    static class OpenNianticSignIn
    {
        const string Key = "RaidRift.NianticLoginStarted";
        const string SettingsPage = "Project/XR Plug-in Management/Niantic Spatial Development Kit";

        static OpenNianticSignIn()
        {
            if (Application.isBatchMode || SessionState.GetBool(Key, false)) return;
            SessionState.SetBool(Key, true);
            EditorApplication.delayCall += () =>
            {
                SettingsService.OpenProjectSettings(SettingsPage);
                if (!HasEditorToken()) _ = Login();
            };
        }

        [MenuItem("RaidRift/Niantic sign-in (retry)")]
        static void Retry() => _ = Login();

        static Type T(string name) => AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType(name, false)).FirstOrDefault(t => t != null);

        static bool HasEditorToken()
        {
            var settings = T("NianticSpatial.NSDK.AR.Editor.Auth.AuthEditorSettings")?.GetProperty("Instance")?.GetValue(null);
            var token = settings?.GetType().GetProperty("EditorAccessToken")?.GetValue(settings) as string;
            return !string.IsNullOrEmpty(token);
        }

        static async Task Login()
        {
            var type = T("NianticSpatial.NSDK.AR.Editor.Auth.AuthEditorLoginCommand");
            var command = type?.GetProperty("Instance")?.GetValue(null);
            var execute = command?.GetType().GetMethod("ExecuteAsync");
            if (execute == null) { Debug.LogError("[RaidRift] NSDK login command not found"); return; }
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                Debug.Log($"[RaidRift] Niantic sign-in attempt {attempt}: finish the login in the browser that just opened on this PC.");
                try { await (Task)execute.Invoke(command, new object[] { CancellationToken.None }); }
                catch (Exception e) { Debug.LogError("[RaidRift] Niantic sign-in error: " + e.GetBaseException().Message); }
                if (HasEditorToken())
                {
                    Debug.Log("[RaidRift] Niantic sign-in OK: editor token received.");
                    return;
                }
                Debug.LogWarning("[RaidRift] Niantic sign-in finished without a token (browser step timed out or the token exchange failed).");
            }
        }
    }
}
