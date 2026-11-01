using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RaidRift
{
    /// <summary>
    /// Camera-first phone HUD built in code (concept: Unity/vfx-incoming/ui-concept-1.png). The camera view is the
    /// hero; chrome is small, frosted and out of the centre:
    ///   top-left   account chip (demo) or, live, an IRL-Pro-style status cluster (vfx-incoming/irlpro/NOTES.md):
    ///              [LIVE | timer] [heroes] / stream health strip (signal bars, Mbps, bitrate history, fps) /
    ///              dropped-frames warning (only while frames are being dropped)
    ///   top-centre scan progress chip while the room is being mapped
    ///   top-right  mic + red end-stream, device chip (battery %, temperature) under them (live)
    ///   right      vertical rail of round glass icon buttons
    ///   left edge  segmented mic level meter (live, once the app feeds SetMicLevel)
    ///   bottom     hint pill, big round primary action (test raid), reset; chat lines fading bottom-left
    /// Icons: Phosphor Fill (MIT) font; text: Inter + Space Grotesk (OFL). Diagnostics live in the Setup sheet.
    /// </summary>
    public class Hud : MonoBehaviour
    {
        static readonly Color Glass = new Color(0.035f, 0.03f, 0.07f, 0.58f);
        static readonly Color GlassStrong = new Color(0.03f, 0.025f, 0.06f, 0.9f);
        static readonly Color Edge = new Color(1f, 1f, 1f, 0.14f);
        static readonly Color Violet = new Color(0.78f, 0.6f, 1f);
        static readonly Color Hot = new Color(0.647f, 0.169f, 1f);   // #A52BFF
        static readonly Color Mint = new Color(0.35f, 0.945f, 0.784f); // #59F1C8
        static readonly Color LiveRed = new Color(1f, 0.25f, 0.33f);
        static readonly Color Dim = new Color(1f, 1f, 1f, 0.62f);
        static readonly Color Amber = new Color(1f, 0.74f, 0.25f);

        // Phosphor Fill codepoints (solid icons, MIT; @phosphor-icons/web fill/style.css)
        const string IconUsers = "\ue68e", IconScan = "\uebb6", IconChat = "\ue168", IconMap = "\ue31a", IconSettings = "\ue272",
            IconMic = "\ue326", IconMicOff = "\ue328", IconEnd = "\ue46e", IconReset = "\ue038", IconZap = "\ue2de", IconWifi = "\ue4ea",
            IconSwords = "\ue5ba", IconX = "\ue4f6", IconSparkles = "\ue6a2", IconFootprints = "\ue73a", IconSelfie = "\ue7a4",
            IconBroadcast = "\ue0f2", IconTwitch = "\ue5ce", IconKey = "\ue2d6", IconGauge = "\ue628", IconLink = "\ue2e2", IconPlug = "\ue946",
            IconMonitor = "\ue32e", IconSpeaker = "\ue44a", IconCube = "\ue1da", IconFlask = "\ue79e", IconInfo = "\ue2ce", IconEyeSlash = "\ue224",
            IconBatteryFull = "\ue0c0", IconBatteryHigh = "\ue0c2", IconBatteryMedium = "\ue0c6", IconBatteryLow = "\ue0c4",
            IconBatteryWarning = "\ue0c8", IconBatteryCharging = "\ue0ba", IconThermometer = "\ue5cc", IconWarning = "\ue4e0",
            IconSignalFull = "\ue142", IconSignalHigh = "\ue144", IconSignalMedium = "\ue148", IconSignalLow = "\ue146",
            IconSignalX = "\ue14e", IconCaret = "\ue13a";

        Font _font, _bold, _display, _icons;
        RectTransform _root, _safe;
        Text _title, _subtitle, _hint, _toast, _liveInfo, _quality, _diag, _scanLabel, _livePill, _liveTimer, _liveHeroes;
        Image _scanBar;
        GameObject _account, _liveChips, _liveActions, _primary, _scanChip, _hintPill, _toastPill, _chatRow, _setup;
        readonly List<Text> _feedLines = new List<Text>();
        GameObject _feedCard;
        RectTransform _labels;
        InputField _chatInput, _serverInput, _tokenInput, _channelInput, _keyInput;
        RawImage _backdrop;
        readonly Dictionary<string, (GameObject go, Text icon, Image ring)> _buttons = new Dictionary<string, (GameObject, Text, Image)>();
        float _toastUntil;
        bool _live, _scanning;

        public event Action<string> OnButton;
        public event Action<string> OnChat;
        public event Action<string, string> OnServer;
        public event Action<string, string> OnGoLive;

        static readonly string[] DemoRail = { "follow", "scan", "chat", "trail", "selfie", "setup" };
        static readonly string[] LiveRail = { "follow", "scan", "chat", "selfie", "setup" };

        public bool Typing => Focused(_chatInput) || Focused(_serverInput) || Focused(_tokenInput) || Focused(_channelInput) || Focused(_keyInput);
        static bool Focused(InputField f) => f != null && f.isFocused;

        // ---------------- public API (used by RaidRiftApp) ----------------
        /// <summary>Demo = test room / stub chat / dev tools. Live = real Twitch channel + stream from the phone.</summary>
        public void SetMode(bool live, string chip)
        {
            _live = live;
            foreach (var kv in _buttons)
                if (Array.IndexOf(DemoRail, kv.Key) >= 0 || Array.IndexOf(LiveRail, kv.Key) >= 0)
                    kv.Value.go.SetActive(Array.IndexOf(live ? LiveRail : DemoRail, kv.Key) >= 0);
            _account.SetActive(!live);
            _liveChips.SetActive(live);
            _liveActions.SetActive(live);
            _health.SetActive(live);
            _device.SetActive(live && _deviceKnown);
            if (!live) _dropWarn.SetActive(false);
            _micMeter.SetActive(live && _micSeen);
            _primary.SetActive(!live && !_scanning);
            if (live != _laidOutLive) LayoutForMode(live);
            if (live && _livePill != null)
            {
                // chip arrives as "● LIVE 12:03" / "● CONNECTING" / "● OFFLINE"
                var parts = (chip ?? "").Replace("●", "").Trim().Split(' ');
                bool on = parts.Length > 0 && parts[0] == "LIVE";
                if (on != _onAir || _livePill.text.Length == 0 || !on && _livePill.text != parts[0])
                {
                    _onAir = on;
                    _livePill.text = on ? "LIVE" : (parts.Length > 0 && parts[0].Length > 0 ? parts[0] : "OFFLINE");
                    _livePillBg.color = on ? LiveRed : new Color(0.32f, 0.32f, 0.4f, 0.95f);
                    // On air: red [● LIVE] + timer; otherwise the state word fills the whole pill.
                    float w = on ? 252 : Mathf.Max(200, 64 + _livePill.text.Length * 17);
                    _livePillLayout.preferredWidth = _livePillLayout.minWidth = w;
                    _livePillBg.rectTransform.offsetMax = on ? new Vector2(116 - w + 6, -6) : new Vector2(-6, -6);
                    _liveTimer.gameObject.SetActive(on);
                    _liveDot.gameObject.SetActive(on);
                    _livePill.rectTransform.offsetMin = new Vector2(on ? 30 : 0, 0);
                    RefreshNetwork();
                }
                if (on) _liveTimer.text = parts.Length > 1 ? parts[1] : "00:00";
            }
        }

        public void SetLiveStats(int heroes, int kbps)
        {
            if (_liveHeroes != null) _liveHeroes.text = heroes.ToString(Inv);
            if (kbps != _kbps) { _kbps = kbps; RefreshNetwork(); }
        }

        public void SetLiveInfo(string info, string quality, string channel)
        {
            if (_liveInfo != null) _liveInfo.text = info;
            if (_quality != null) _quality.text = quality;
            if (_channelInput != null && !_channelInput.isFocused && string.IsNullOrEmpty(_channelInput.text)) _channelInput.text = channel;
            // Network quality is judged against the selected quality's bitrate ("HD · 4.5 Mbps") unless the app sets it.
            if (!_targetSet && quality != null)
            {
                var m = System.Text.RegularExpressions.Regex.Match(quality, @"(\d+(?:[.,]\d+)?)\s*Mbps");
                if (m.Success && float.TryParse(m.Groups[1].Value.Replace(',', '.'), System.Globalization.NumberStyles.Float, Inv, out var mbps))
                    _targetKbps = Mathf.RoundToInt(mbps * 1000f);
            }
            // Until the app calls SetStreamHealth, read fps / dropped frames from the live diagnostics line
            // ("… · 30 fps · dropped 12 · …") so the health strip and drop warning work without app changes.
            if (!_healthSet && info != null)
            {
                var m = System.Text.RegularExpressions.Regex.Match(info, @"([\d.,]+) fps · dropped (\d+)");
                if (m.Success && float.TryParse(m.Groups[1].Value.Replace(',', '.'), System.Globalization.NumberStyles.Float, Inv, out var fps))
                    ApplyStreamHealth(fps, int.Parse(m.Groups[2].Value, Inv));
            }
        }

        // ---------------- live health (IRL-Pro-style stats) ----------------
        static readonly System.Globalization.CultureInfo Inv = System.Globalization.CultureInfo.InvariantCulture;
        const int HistoryLength = 30;
        const float SampleEvery = 0.5f;
        readonly int[] _history = new int[HistoryLength];
        Image[] _historyBars;
        int _kbps, _targetKbps = 4500, _dropped = -1, _dropBurst;
        float _fps = -1f, _dropUntil, _nextSample, _micLevel, _micShown, _battery = -1f, _celsius = float.NaN, _nextDevicePoll;
        bool _targetSet, _healthSet, _batteryOverride, _thermalOverride, _charging, _micSeen, _micOn = true, _deviceKnown, _onAir, _laidOutLive;
        Text _kbpsText, _fpsText, _signalIcon, _batteryIcon, _batteryText, _thermoIcon, _thermoText, _dropText;
        Image _livePillBg, _liveDot;
        LayoutElement _livePillLayout;
        GameObject _health, _device, _dropWarn, _micMeter;
        Image[] _micSegments;

        /// <summary>Bitrate the stream is aiming for; network quality = current / target (default: parsed from the quality name).</summary>
        public void SetTargetBitrate(int kbps)
        {
            _targetSet = kbps > 0;
            if (kbps > 0) _targetKbps = kbps;
            RefreshNetwork();
        }

        /// <summary>Encoder fps + total dropped frames since the stream started (LivePublisher.SendFps / DroppedFrames).
        /// A rising drop count shows the amber "frames dropped" chip for a few seconds.</summary>
        public void SetStreamHealth(float fps, int droppedTotal)
        {
            _healthSet = true;
            ApplyStreamHealth(fps, droppedTotal);
        }

        void ApplyStreamHealth(float fps, int droppedTotal)
        {
            _fps = fps;
            if (_dropped >= 0 && droppedTotal > _dropped)
            {
                if (Time.unscaledTime > _dropUntil) _dropBurst = 0;
                _dropBurst += droppedTotal - _dropped;
                _dropUntil = Time.unscaledTime + 6f;
            }
            _dropped = droppedTotal;
            RefreshNetwork();
            RefreshDropWarning();
        }

        /// <summary>Microphone input level 0..1 (peak or RMS of the streamed mic). The left-edge meter appears on the first call.</summary>
        public void SetMicLevel(float level01)
        {
            _micLevel = Mathf.Clamp01(level01);
            _micShown = Mathf.Max(_micShown, _micLevel);
            if (!_micSeen) { _micSeen = true; if (_micMeter != null) _micMeter.SetActive(_live); }
            RefreshMicMeter();
        }

        /// <summary>Device temperature in °C (e.g. from Android thermal / battery temperature). Overrides the built-in
        /// battery-temperature read; NaN = unknown.</summary>
        public void SetThermal(float celsius)
        {
            _thermalOverride = !float.IsNaN(celsius);
            _celsius = celsius;
            RefreshDevice();
        }

        /// <summary>Battery level 0..1 + charging; overrides SystemInfo (used by previews / when the app knows better).</summary>
        public void SetDeviceStatus(float battery01, bool charging)
        {
            _batteryOverride = battery01 >= 0f;
            _battery = battery01;
            _charging = charging;
            RefreshDevice();
        }

        /// <summary>Fills the bitrate history graph at once (previews / restoring after a scene reload).</summary>
        public void SeedBitrateHistory(IList<int> kbps)
        {
            if (kbps == null) return;
            for (int i = 0; i < HistoryLength; i++)
            {
                int src = kbps.Count - HistoryLength + i;
                _history[i] = src >= 0 ? kbps[src] : 0;
            }
            RefreshNetwork();
        }

        void TickLive()
        {
            if (Time.unscaledTime >= _nextSample)
            {
                _nextSample = Time.unscaledTime + SampleEvery;
                Array.Copy(_history, 1, _history, 0, HistoryLength - 1);
                _history[HistoryLength - 1] = _onAir ? _kbps : 0;
                RefreshNetwork();
            }
            if (_dropWarn.activeSelf && Time.unscaledTime > _dropUntil) RefreshDropWarning();
            if (_micSeen)
            {
                // Quick fall towards the latest level, like a hardware meter.
                _micShown = Mathf.Max(_micLevel, _micShown - Time.unscaledDeltaTime * 1.6f);
                RefreshMicMeter();
            }
            if (_liveDot != null && _liveDot.gameObject.activeSelf)
                _liveDot.color = new Color(1, 1, 1, 0.55f + 0.45f * Mathf.Abs(Mathf.Sin(Time.unscaledTime * 2.2f)));
        }

        /// <summary>Signal bars + Mbps + bitrate history + fps, coloured by current/target bitrate.</summary>
        void RefreshNetwork()
        {
            if (_kbpsText == null) return;
            float ratio = _targetKbps > 0 ? _kbps / (float)_targetKbps : 1f;
            bool on = _onAir && _kbps > 0;
            Color c = !on ? LiveRed : ratio >= 0.7f ? Mint : ratio >= 0.4f ? Amber : LiveRed;
            _signalIcon.text = !on ? IconSignalX : ratio >= 0.85f ? IconSignalFull : ratio >= 0.6f ? IconSignalHigh : ratio >= 0.35f ? IconSignalMedium : IconSignalLow;
            _signalIcon.color = c;
            _kbpsText.text = !on ? "<color=#ffffff88>—</color>"
                : _kbps >= 1000 ? $"{(_kbps / 1000f).ToString("0.0", Inv)}<size=18><color=#ffffffaa> Mbps</color></size>"
                : $"{_kbps.ToString(Inv)}<size=18><color=#ffffffaa> kbps</color></size>";
            _fpsText.text = _fps >= 0 && on ? $"{Mathf.RoundToInt(_fps).ToString(Inv)}<size=17> fps</size>" : "";
            _fpsText.color = _fps >= 0 && _fps < 24 ? Amber : Dim;
            float top = _targetKbps * 1.25f;
            foreach (var k in _history) top = Mathf.Max(top, k);
            for (int i = 0; i < HistoryLength; i++)
            {
                int k = _history[i];
                float r = _targetKbps > 0 ? k / (float)_targetKbps : 1f;
                var bar = _historyBars[i];
                var rt = bar.rectTransform;
                rt.anchorMax = new Vector2(rt.anchorMax.x, Mathf.Max(0.08f, k / top));
                var col = k <= 0 ? new Color(1, 1, 1, 0.18f) : r >= 0.7f ? Mint : r >= 0.4f ? Amber : LiveRed;
                col.a = k <= 0 ? 0.18f : Mathf.Lerp(0.35f, 1f, i / (float)(HistoryLength - 1)); // older samples fade
                bar.color = col;
            }
        }

        void RefreshDropWarning()
        {
            if (_dropWarn == null) return;
            bool show = _live && Time.unscaledTime <= _dropUntil && _dropBurst > 0;
            if (_dropWarn.activeSelf != show) _dropWarn.SetActive(show);
            if (show) _dropText.text = $"{_dropBurst.ToString(Inv)} frame{(_dropBurst == 1 ? "" : "s")} dropped <color=#ffffff99>· weak upload</color>";
        }

        void RefreshMicMeter()
        {
            if (_micSegments == null) return;
            int n = _micSegments.Length;
            int lit = _micOn ? Mathf.RoundToInt(_micShown * n) : 0;
            for (int i = 0; i < n; i++)
            {
                float t = i / (float)(n - 1);
                var c = t > 0.85f ? LiveRed : t > 0.65f ? Amber : Mint;
                c.a = i < lit ? 1f : 0.2f;
                if (!_micOn) c = new Color(1, 1, 1, 0.12f);
                _micSegments[i].color = c;
            }
        }

        void PollDevice()
        {
            if (Time.unscaledTime < _nextDevicePoll) return;
            _nextDevicePoll = Time.unscaledTime + 5f;
            if (!_batteryOverride)
            {
                _battery = SystemInfo.batteryLevel; // -1 where unknown (editor / desktop)
                var s = SystemInfo.batteryStatus;
                _charging = s == BatteryStatus.Charging || s == BatteryStatus.Full;
            }
            if (!_thermalOverride) _celsius = ReadBatteryCelsius();
            RefreshDevice();
        }

        bool _thermalReadFailed;

        /// <summary>Android battery temperature (sticky ACTION_BATTERY_CHANGED intent, tenths of °C) — the
        /// temperature IRL streamers watch; NaN elsewhere or if the read fails.</summary>
        float ReadBatteryCelsius()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (_thermalReadFailed) return float.NaN;
            try
            {
                using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
                using (var filter = new AndroidJavaObject("android.content.IntentFilter", "android.intent.action.BATTERY_CHANGED"))
                {
                    // registerReceiver(null, filter) returns the sticky intent; raw JNI because a null receiver
                    // can't be matched by AndroidJavaObject.Call's signature lookup.
                    var cls = AndroidJNI.GetObjectClass(activity.GetRawObject());
                    var mid = AndroidJNI.GetMethodID(cls, "registerReceiver",
                        "(Landroid/content/BroadcastReceiver;Landroid/content/IntentFilter;)Landroid/content/Intent;");
                    var raw = AndroidJNI.CallObjectMethod(activity.GetRawObject(), mid,
                        new[] { new jvalue { l = IntPtr.Zero }, new jvalue { l = filter.GetRawObject() } });
                    AndroidJNI.DeleteLocalRef(cls);
                    if (raw == IntPtr.Zero) return float.NaN;
                    using (var intent = new AndroidJavaObject(raw))
                    {
                        AndroidJNI.DeleteLocalRef(raw);
                        int tenths = intent.Call<int>("getIntExtra", "temperature", int.MinValue);
                        return tenths == int.MinValue ? float.NaN : tenths / 10f;
                    }
                }
            }
            catch (Exception e)
            {
                _thermalReadFailed = true;
                Debug.LogWarning("[RaidRift] battery temperature unavailable: " + e.Message);
                return float.NaN;
            }
#else
            return float.NaN;
#endif
        }

        void RefreshDevice()
        {
            if (_batteryText == null) return;
            bool hasBattery = _battery >= 0f, hasTemp = !float.IsNaN(_celsius);
            _deviceKnown = hasBattery || hasTemp;
            if (_device.activeSelf != (_live && _deviceKnown)) _device.SetActive(_live && _deviceKnown);
            if (!_deviceKnown) return;
            int pct = Mathf.RoundToInt(_battery * 100f);
            var bc = !hasBattery ? Dim : _charging ? Mint : pct <= 15 ? LiveRed : pct <= 30 ? Amber : Color.white;
            _batteryIcon.text = _charging ? IconBatteryCharging : pct <= 15 ? IconBatteryWarning : pct <= 35 ? IconBatteryLow : pct <= 65 ? IconBatteryMedium : pct <= 90 ? IconBatteryHigh : IconBatteryFull;
            _batteryIcon.color = bc == Color.white ? Mint : bc;
            _batteryText.text = hasBattery ? pct.ToString(Inv) + "<size=17>%</size>" : "—";
            _batteryText.color = bc;
            var tc = !hasTemp ? Dim : _celsius >= 43f ? LiveRed : _celsius >= 39f ? Amber : Color.white;
            _thermoIcon.color = tc == Color.white ? Dim : tc;
            _thermoText.text = hasTemp ? Mathf.RoundToInt(_celsius).ToString(Inv) + "<size=17>°C</size>" : "—";
            _thermoText.color = tc;
            _thermoIcon.gameObject.SetActive(hasTemp);
            _thermoText.gameObject.SetActive(hasTemp);
            var r = _device.GetComponent<RectTransform>();
            r.offsetMin = new Vector2(hasTemp ? -262 : -136, r.offsetMin.y);
        }

        /// <summary>Toast / scan chip / chat feed move out of the way of the live status cluster.</summary>
        void LayoutForMode(bool live)
        {
            _laidOutLive = live;
            var toast = _toastPill.GetComponent<RectTransform>();
            toast.offsetMin = new Vector2(-380, live ? -450 : -214); toast.offsetMax = new Vector2(380, live ? -366 : -130);
            var scan = _scanChip.GetComponent<RectTransform>();
            scan.offsetMin = new Vector2(-230, live ? -346 : -96); scan.offsetMax = new Vector2(230, live ? -250 : 0);
            var feed = _feedCard.GetComponent<RectTransform>();
            feed.offsetMin = new Vector2(live ? 44 : 8, 24);
        }

        /// <summary>Room mapping progress 0..1 (chip hidden at ≥ 1 or &lt; 0).</summary>
        public void SetScan(float progress, string label)
        {
            bool show = progress >= 0f && progress < 1f;
            _scanChip.SetActive(show);
            _scanning = show;
            if (_primary != null) _primary.SetActive(!_live && !show); // nothing to start until the room is mapped
            if (!show) return;
            _scanLabel.text = $"{label}  <color=#ffffffaa>{Mathf.RoundToInt(progress * 100)}%</color>";
            var r = _scanBar.rectTransform;
            r.anchorMax = new Vector2(Mathf.Clamp01(progress), 1f);
        }

        public void SetStatus(string title, string status, string hint)
        {
            _subtitle.text = title;
            if (_diag != null) _diag.text = status;
            _hint.text = hint ?? "";
            _hintPill.SetActive(!string.IsNullOrEmpty(hint));
        }

        public void SetButton(string id, string title, bool on)
        {
            if (!_buttons.TryGetValue(id, out var b) || b.icon == null) return;
            if (id == "mic")
            {
                b.icon.text = title != null && title.Contains("off") ? IconMicOff : IconMic;
                if (_micOn != on) { _micOn = on; RefreshMicMeter(); }
            }
            b.icon.color = on ? Mint : Color.white;
            if (b.ring != null) b.ring.color = on ? new Color(Mint.r, Mint.g, Mint.b, 0.75f) : Edge;
        }

        public void SetFeed(IList<ChatLine> lines)
        {
            int n = _feedLines.Count;
            if (_feedCard != null && _feedCard.activeSelf != (lines.Count > 0)) _feedCard.SetActive(lines.Count > 0);
            for (int i = 0; i < n; i++)
            {
                int li = lines.Count - n + i;
                var t = _feedLines[i];
                if (t.gameObject.activeSelf != (li >= 0)) t.gameObject.SetActive(li >= 0);
                if (li < 0) { t.text = ""; continue; }
                var l = lines[li];
                var color = l.System ? (l.Ok ? "#c79bff" : "#ff8a9a") : NameColor(l.Speaker);
                // At most ~2 wrapped lines per message so the card can't grow over the chat composer / view.
                var said = l.Text ?? "";
                if (said.Length > 64) said = said.Substring(0, 63) + "…";
                t.text = $"<color={color}>{Escape(l.Speaker)}</color>  {Escape(said)}";
                // Older lines fade out like a stream chat overlay.
                t.color = new Color(1f, 1f, 1f, Mathf.Lerp(0.35f, 1f, (float)(i + 1) / n));
            }
        }

        public void Toast(string text, float seconds = 2.5f)
        {
            _toast.text = text;
            _toastPill.SetActive(!string.IsNullOrEmpty(text));
            _toastPill.transform.SetAsLastSibling(); // above the settings sheet ("Tap End again" is shown there too)
            _toastUntil = Time.time + seconds;
        }

        public void ToggleChat()
        {
            _chatRow.SetActive(!_chatRow.activeSelf);
            if (_chatRow.activeSelf) _chatInput.ActivateInputField();
        }

        // The settings sheet is translucent glass: the account chip, orb and hint pill showed through it with their
        // labels colliding with the sheet's title and last row (hud-portrait-setup preview). Hide them while it is open
        // (alpha + no raycast, so SetMode keeps owning their active state).
        CanvasGroup[] _underSheet;
        bool _sheetCovered;

        void CoverUnderSheet()
        {
            if (_setup == null) return;
            bool open = _setup.activeSelf;
            if (open == _sheetCovered) return;
            _sheetCovered = open;
            if (_underSheet == null)
            {
                var gos = new[] { _account, _primary, _hintPill, _scanChip, _liveChips, _health, _device, _dropWarn, _micMeter };
                _underSheet = new CanvasGroup[gos.Length];
                for (int i = 0; i < gos.Length; i++)
                {
                    if (gos[i] == null) continue;
                    var g = gos[i].GetComponent<CanvasGroup>(); // not ?? : Unity's fake null
                    _underSheet[i] = g != null ? g : gos[i].AddComponent<CanvasGroup>();
                }
            }
            foreach (var g in _underSheet)
            {
                if (g == null) continue;
                g.alpha = open ? 0f : 1f;
                g.blocksRaycasts = !open;
            }
        }

        bool _keepSheet;
        /// <summary>Called by the app when a settings tap only armed a two-tap confirmation: keep the sheet open.</summary>
        public void KeepSheetOpen() { _keepSheet = true; }

        public void ToggleSetup(string server) { _serverInput.text = server; _setup.SetActive(!_setup.activeSelf); CoverUnderSheet(); }

        /// <summary>Name tags are drawn in the scene now (WorldTags) so they reach the stream; kept for API compatibility.</summary>
        public void UpdateTags(Camera cam, IEnumerable<Hero> heroes) { }

        // ---------------- flash / backdrop ----------------
        Image _flash;
        float _flashAmount;
        Color _flashColor = Color.white;

        public void Flash(Color color, float strength)
        {
            // On the composited image (phone + stream) when CameraFeel is present; UI overlay as a fallback.
            if (FindFirstObjectByType<CameraFeel>() != null)
            {
                CameraFeel.Flash(color, strength);
                CameraFeel.Vignette(new Color(color.r * 0.3f, color.g * 0.08f, color.b * 0.5f), strength * 0.5f);
                return;
            }
            if (_flash == null)
            {
                var f = Rect("Flash", _root);
                Stretch(f);
                f.SetSiblingIndex(1);
                _flash = f.gameObject.AddComponent<Image>();
                _flash.raycastTarget = false;
            }
            _flashColor = color;
            _flashAmount = Mathf.Max(_flashAmount, strength);
        }

        /// <summary>While streaming the AR camera renders into a texture; it is shown full screen under the HUD.</summary>
        public void SetBackdrop(Texture texture)
        {
            if (_backdrop == null)
            {
                var r = Rect("Backdrop", _root);
                Stretch(r);
                r.SetAsFirstSibling();
                _backdrop = r.gameObject.AddComponent<RawImage>();
                _backdrop.raycastTarget = false;
            }
            _backdrop.texture = texture;
            _backdrop.enabled = texture != null;
        }

        void Update()
        {
            if (_toastPill != null && _toastPill.activeSelf && Time.time > _toastUntil) _toastPill.SetActive(false);
            CoverUnderSheet();
            PollDevice();
            if (_live) TickLive();
            if (_flash != null)
            {
                _flashAmount = Mathf.MoveTowards(_flashAmount, 0f, Time.deltaTime * 1.8f);
                _flash.color = new Color(_flashColor.r, _flashColor.g, _flashColor.b, _flashAmount * 0.5f);
            }
            // Gentle breathing on the primary action so first-time streamers find it.
            if (_primary != null && _primary.activeSelf)
                _primary.transform.localScale = Vector3.one * (1f + Mathf.Sin(Time.unscaledTime * 2.4f) * 0.025f);
        }

        // ---------------- layout ----------------
        public void Build()
        {
            var builtin = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _font = Resources.Load<Font>("Fonts/Inter-Regular") ?? builtin;
            _bold = Resources.Load<Font>("Fonts/Inter-SemiBold") ?? _font;
            _display = Resources.Load<Font>("Fonts/SpaceGrotesk-Bold") ?? _bold;
            _icons = Resources.Load<Font>("Fonts/PhosphorFill") ?? Resources.Load<Font>("Fonts/Lucide") ?? _bold;
            if (FindFirstObjectByType<EventSystem>() == null)
            {
                var es = new GameObject("EventSystem");
                es.AddComponent<EventSystem>();
                es.AddComponent<UnityEngine.InputSystem.UI.InputSystemUIInputModule>();
            }
            var canvasGo = new GameObject("HUD");
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1080, 2340);
            scaler.matchWidthOrHeight = 0.5f;
            canvasGo.AddComponent<GraphicRaycaster>();
            _root = canvasGo.GetComponent<RectTransform>();

            _safe = Rect("Safe", _root);
            var area = Screen.safeArea;
            if (Screen.width > 0 && Screen.height > 0 && area.width > 0)
            {
                _safe.anchorMin = new Vector2(area.xMin / Screen.width, area.yMin / Screen.height);
                _safe.anchorMax = new Vector2(area.xMax / Screen.width, area.yMax / Screen.height);
            }
            else { _safe.anchorMin = Vector2.zero; _safe.anchorMax = Vector2.one; }
            _safe.offsetMin = new Vector2(28, 28);
            _safe.offsetMax = new Vector2(-28, -28);

            _labels = Rect("Labels", _root);
            Stretch(_labels);
            _labels.SetAsFirstSibling();

            BuildTopLeft();
            BuildTopCenter();
            BuildTopRight();
            BuildRail();
            BuildBottom();
            BuildChat();
            BuildSetup();
            SetMode(false, "DEMO");
        }

        void BuildTopLeft()
        {
            // Account chip: avatar, wordmark, context line. Tapping it opens Setup.
            var chip = Pill("Account", _safe, new Vector2(0, 1), new Vector2(0, 1), new Vector2(0, -100), new Vector2(470, 0));
            _account = chip.gameObject;
            var avatar = Circle("Avatar", chip, 76, Hot);
            avatar.anchorMin = avatar.anchorMax = new Vector2(0, 0.5f);
            avatar.anchoredPosition = new Vector2(50, 0);
            Icon(avatar, IconSwords, 38, Color.white);
            _title = Label(chip, "RaidRift", 32, FontStyle.Bold, Color.white, TextAnchor.UpperLeft, new Vector2(104, -12), new Vector2(-20, -10));
            _title.font = _display;
            _subtitle = Label(chip, "", 22, FontStyle.Normal, Dim, TextAnchor.LowerLeft, new Vector2(104, 14), new Vector2(-20, -50));
            _subtitle.horizontalOverflow = HorizontalWrapMode.Overflow;
            var b = chip.gameObject.AddComponent<Button>();
            b.onClick.AddListener(() => Press("setup"));

            // Live row 1: [● LIVE | 24:17] [heroes]   (IRL Pro keeps status as small outlined chips at the edges)
            var row = Rect("LiveChips", _safe);
            Anchor(row, new Vector2(0, 1), new Vector2(0, 1), new Vector2(0, -76), new Vector2(600, 0));
            var h = row.gameObject.AddComponent<HorizontalLayoutGroup>();
            h.spacing = 12; h.childControlWidth = true; h.childControlHeight = true; h.childForceExpandWidth = false; h.childForceExpandHeight = true;
            _liveChips = row.gameObject;
            var pill = Box("LivePill", row, Glass, true);
            Border(pill);
            _livePillLayout = pill.gameObject.AddComponent<LayoutElement>();
            _livePillLayout.preferredWidth = _livePillLayout.minWidth = 252;
            var red = Box("OnAir", pill, LiveRed, true);
            Anchor(red, Vector2.zero, Vector2.one, new Vector2(6, 6), new Vector2(116 - 252 + 6, -6));
            _livePillBg = red.GetComponent<Image>();
            _liveDot = Circle("Dot", red, 14, Color.white).GetComponent<Image>();
            _liveDot.rectTransform.anchorMin = _liveDot.rectTransform.anchorMax = new Vector2(0, 0.5f);
            _liveDot.rectTransform.anchoredPosition = new Vector2(24, 0);
            _livePill = Label(red, "LIVE", 25, FontStyle.Bold, Color.white, TextAnchor.MiddleCenter, new Vector2(30, 0), new Vector2(-6, 0));
            _livePill.font = _display;
            _liveTimer = Label(pill, "00:00", 27, FontStyle.Bold, Color.white, TextAnchor.MiddleCenter, new Vector2(126, 0), new Vector2(-8, 0));
            _liveTimer.font = _display;
            _liveHeroes = ChipText(row, IconUsers, "0", Glass, 118, false);

            // Live row 2: stream health strip — signal bars · Mbps · bitrate history · fps.
            var health = Pill("Health", _safe, new Vector2(0, 1), new Vector2(0, 1), new Vector2(0, -158), new Vector2(476, -90));
            _health = health.gameObject;
            _signalIcon = Icon(health, IconSignalFull, 30, Mint);
            Anchor(_signalIcon.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(16, 0), new Vector2(56, 0));
            _kbpsText = Label(health, "—", 26, FontStyle.Bold, Color.white, TextAnchor.MiddleLeft, new Vector2(64, 0), Vector2.zero);
            Anchor(_kbpsText.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(64, 0), new Vector2(196, 0));
            _kbpsText.font = _display;
            _kbpsText.horizontalOverflow = HorizontalWrapMode.Overflow;
            var graph = Rect("BitrateGraph", health);
            Anchor(graph, new Vector2(0, 0), new Vector2(0, 1), new Vector2(200, 16), new Vector2(380, -16));
            _historyBars = new Image[HistoryLength];
            for (int i = 0; i < HistoryLength; i++)
            {
                var bar = Rect("Bar", graph);
                bar.anchorMin = new Vector2(i / (float)HistoryLength, 0); bar.anchorMax = new Vector2((i + 1) / (float)HistoryLength, 0.08f);
                bar.offsetMin = Vector2.zero; bar.offsetMax = new Vector2(-1.5f, 0);
                var img = bar.gameObject.AddComponent<Image>(); img.raycastTarget = false;
                _historyBars[i] = img;
            }
            _fpsText = Label(health, "", 24, FontStyle.Bold, Dim, TextAnchor.MiddleRight, new Vector2(384, 0), new Vector2(-18, 0));
            _fpsText.horizontalOverflow = HorizontalWrapMode.Overflow;

            // Live row 3: dropped-frames warning (amber), only while frames are being dropped.
            var warn = Box("DropWarning", _safe, new Color(0.16f, 0.1f, 0.02f, 0.78f), true);
            Anchor(warn, new Vector2(0, 1), new Vector2(0, 1), new Vector2(0, -228), new Vector2(476, -170));
            var wb = Rect("Border", warn); Stretch(wb);
            var wbi = wb.gameObject.AddComponent<Image>();
            wbi.sprite = RoundedRing(); wbi.type = Image.Type.Sliced; wbi.color = new Color(Amber.r, Amber.g, Amber.b, 0.7f); wbi.raycastTarget = false;
            _dropWarn = warn.gameObject;
            var wi = Icon(warn, IconWarning, 28, Amber);
            Anchor(wi.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(16, 0), new Vector2(56, 0));
            _dropText = Label(warn, "", 23, FontStyle.Bold, Color.white, TextAnchor.MiddleLeft, new Vector2(64, 0), new Vector2(-16, 0));
            _dropWarn.SetActive(false);
            RefreshNetwork();
        }

        Text ChipText(RectTransform row, string icon, string text, Color fill, float width, bool strong)
        {
            var c = Box("Chip", row, fill, true);
            var le = c.gameObject.AddComponent<LayoutElement>();
            le.preferredWidth = width; le.minWidth = width * 0.8f;
            float left = 20;
            if (icon != null)
            {
                var ic = Icon(c, icon, 26, Dim);
                Anchor(ic.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(16, 0), new Vector2(52, 0));
                left = 56;
            }
            var t = Label(c, text, 26, FontStyle.Bold, Color.white, icon == null ? TextAnchor.MiddleCenter : TextAnchor.MiddleLeft, new Vector2(icon == null ? 8 : left, 0), new Vector2(-8, 0));
            if (strong) t.font = _display;
            return t;
        }

        void BuildTopCenter()
        {
            var chip = Pill("Scan", _safe, new Vector2(0.5f, 1), new Vector2(0.5f, 1), new Vector2(-230, -96), new Vector2(230, 0));
            _scanChip = chip.gameObject;
            var ic = Icon(chip, IconScan, 30, Mint);
            Anchor(ic.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(26, 0), new Vector2(66, 0));
            _scanLabel = Label(chip, "Scanning", 25, FontStyle.Bold, Color.white, TextAnchor.UpperLeft, new Vector2(74, -14), new Vector2(-24, -12));
            var track = Box("Track", chip, new Color(1, 1, 1, 0.14f), false);
            Anchor(track, new Vector2(0, 0), new Vector2(1, 0), new Vector2(74, 18), new Vector2(-26, 26));
            var bar = Box("Bar", track, Hot, false);
            bar.anchorMin = Vector2.zero; bar.anchorMax = new Vector2(0.1f, 1f); bar.offsetMin = bar.offsetMax = Vector2.zero;
            _scanBar = bar.GetComponent<Image>();
        }

        void BuildTopRight()
        {
            var group = Rect("LiveActions", _safe);
            Anchor(group, new Vector2(1, 1), new Vector2(1, 1), new Vector2(-224, -100), new Vector2(0, 0));
            _liveActions = group.gameObject;
            var mic = RoundButton("mic", group, IconMic, 100, Glass);
            mic.anchorMin = mic.anchorMax = new Vector2(0, 0.5f); mic.anchoredPosition = new Vector2(50, 0);
            var end = RoundButton("end-live", group, IconEnd, 100, LiveRed);
            end.anchorMin = end.anchorMax = new Vector2(1, 0.5f); end.anchoredPosition = new Vector2(-50, 0);

            // Device chip under them: battery % + temperature (IRL Pro shows both top-right; phones throttle when hot).
            var dev = Pill("Device", _safe, new Vector2(1, 1), new Vector2(1, 1), new Vector2(-262, -184), new Vector2(0, -116));
            _device = dev.gameObject;
            _batteryIcon = Icon(dev, IconBatteryHigh, 32, Mint);
            Anchor(_batteryIcon.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(14, 0), new Vector2(54, 0));
            _batteryText = Label(dev, "—", 25, FontStyle.Bold, Color.white, TextAnchor.MiddleLeft, Vector2.zero, Vector2.zero);
            Anchor(_batteryText.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(60, 0), new Vector2(124, 0));
            _batteryText.font = _display; _batteryText.horizontalOverflow = HorizontalWrapMode.Overflow;
            _thermoIcon = Icon(dev, IconThermometer, 28, Dim);
            Anchor(_thermoIcon.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(132, 0), new Vector2(166, 0));
            _thermoText = Label(dev, "—", 25, FontStyle.Bold, Color.white, TextAnchor.MiddleLeft, Vector2.zero, Vector2.zero);
            Anchor(_thermoText.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(170, 0), new Vector2(250, 0));
            _thermoText.font = _display; _thermoText.horizontalOverflow = HorizontalWrapMode.Overflow;
            _device.SetActive(false);
        }

        void BuildRail()
        {
            var rail = Rect("Rail", _safe);
            Anchor(rail, new Vector2(1, 0.5f), new Vector2(1, 0.5f), new Vector2(-104, -400), new Vector2(0, 400));
            var v = rail.gameObject.AddComponent<VerticalLayoutGroup>();
            v.spacing = 22; v.childAlignment = TextAnchor.MiddleCenter;
            v.childControlWidth = false; v.childControlHeight = false; v.childForceExpandHeight = false; v.childForceExpandWidth = false;
            RoundButton("follow", rail, IconUsers, 104, Glass);
            RoundButton("scan", rail, IconScan, 104, Glass);
            RoundButton("chat", rail, IconChat, 104, Glass);
            RoundButton("trail", rail, IconMap, 104, Glass);
            RoundButton("selfie", rail, IconSelfie, 104, Glass);
            RoundButton("setup", rail, IconSettings, 104, Glass);
        }

        void BuildBottom()
        {
            // Primary action: test raid. Big violet orb with a soft ring.
            var orb = Rect("Primary", _safe);
            orb.anchorMin = orb.anchorMax = new Vector2(0.5f, 0);
            orb.sizeDelta = new Vector2(176, 176);
            orb.anchoredPosition = new Vector2(0, 104);
            _primary = orb.gameObject;
            var ring = orb.gameObject.AddComponent<Image>();
            ring.sprite = RingSprite(); ring.color = new Color(1, 1, 1, 0.85f);
            var core = Circle("Core", orb, 140, Color.white);
            core.GetComponent<Image>().sprite = OrbSprite();
            Icon(core, IconZap, 54, Color.white);
            var label = Label(orb, "Test raid", 22, FontStyle.Bold, Color.white, TextAnchor.UpperCenter, new Vector2(-60, -50), new Vector2(60, -184));
            label.gameObject.AddComponent<Shadow>().effectDistance = new Vector2(0, -2);
            var b = orb.gameObject.AddComponent<Button>();
            b.targetGraphic = ring;
            b.onClick.AddListener(() => Press("raid"));
            _buttons["raid"] = (orb.gameObject, null, null);

            // Reset room, bottom-right.
            var reset = RoundButton("reset-room", _safe, IconReset, 92, Glass);
            reset.anchorMin = reset.anchorMax = new Vector2(1, 0);
            reset.anchoredPosition = new Vector2(-52, 60);

            // Hint pill above the primary action.
            var hint = Pill("Hint", _safe, new Vector2(0.5f, 0), new Vector2(0.5f, 0), new Vector2(-330, 236), new Vector2(330, 312));
            _hintPill = hint.gameObject;
            var hi = Icon(hint, IconFootprints, 28, Mint);
            Anchor(hi.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(22, 0), new Vector2(62, 0));
            _hint = Label(hint, "", 24, FontStyle.Normal, Color.white, TextAnchor.MiddleCenter, new Vector2(64, 0), new Vector2(-24, 0));

            // Toast / raid banner: top centre, below the scan chip.
            var toast = Pill("Toast", _safe, new Vector2(0.5f, 1), new Vector2(0.5f, 1), new Vector2(-380, -214), new Vector2(380, -130));
            _toastPill = toast.gameObject;
            var ti = Circle("Badge", toast, 56, Hot);
            ti.anchorMin = ti.anchorMax = new Vector2(0, 0.5f); ti.anchoredPosition = new Vector2(44, 0);
            Icon(ti, IconSparkles, 28, Color.white);
            _toast = Label(toast, "", 25, FontStyle.Bold, Color.white, TextAnchor.MiddleLeft, new Vector2(88, 0), new Vector2(-24, 0));
            _toastPill.SetActive(false);
        }

        void BuildChat()
        {
            // Stream-style chat (ui-concept-1): a soft dark card that grows with its lines, bottom-left, so names
            // stay readable over bright rooms; hidden while empty. Five lines fading upward.
            var feed = Box("Feed", _safe, new Color(0.05f, 0.03f, 0.1f, 0.5f), true);
            feed.anchorMin = new Vector2(0, 0); feed.anchorMax = new Vector2(0.39f, 0); feed.pivot = new Vector2(0, 0);
            feed.offsetMin = new Vector2(8, 24); feed.offsetMax = new Vector2(0, 24);
            var v = feed.gameObject.AddComponent<VerticalLayoutGroup>();
            v.childAlignment = TextAnchor.LowerLeft; v.spacing = 6; v.padding = new RectOffset(22, 18, 14, 14);
            v.childControlHeight = true; v.childControlWidth = true; v.childForceExpandHeight = false; v.childForceExpandWidth = true;
            feed.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            _feedCard = feed.gameObject;
            feed.GetComponent<Image>().raycastTarget = false; // decorative: taps go through to the floor
            for (int i = 0; i < 5; i++)
            {
                var t = Label(feed, "", 26, FontStyle.Normal, Color.white, TextAnchor.LowerLeft, Vector2.zero, Vector2.zero);
                var sh = t.gameObject.AddComponent<Shadow>(); sh.effectColor = new Color(0, 0, 0, 0.75f); sh.effectDistance = new Vector2(1.5f, -1.5f);
                _feedLines.Add(t);
            }
            _feedCard.SetActive(false);

            // Mic level meter: a column of segments on the left edge, lit from the bottom (IRL Pro), mic glyph below.
            var meter = Rect("MicMeter", _safe);
            Anchor(meter, Vector2.zero, Vector2.zero, new Vector2(0, 24), new Vector2(34, 24 + 54 + 16 * 19));
            _micMeter = meter.gameObject;
            // Glass backing so unlit segments still read over bright rooms.
            var back = Box("Back", meter, Glass, true);
            Anchor(back, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            back.GetComponent<Image>().raycastTarget = false;
            var mg = Icon(meter, IconMic, 24, Dim);
            Anchor(mg.rectTransform, Vector2.zero, new Vector2(1, 0), new Vector2(0, 8), new Vector2(0, 44));
            _micSegments = new Image[16];
            for (int i = 0; i < _micSegments.Length; i++)
            {
                var seg = Box("Seg", meter, Mint, false);
                Anchor(seg, Vector2.zero, new Vector2(1, 0), new Vector2(9, 50 + i * 19), new Vector2(-9, 50 + i * 19 + 13));
                seg.GetComponent<Image>().raycastTarget = false;
                _micSegments[i] = seg.GetComponent<Image>();
            }
            RefreshMicMeter();
            _micMeter.SetActive(false);

            // Chat input: frosted pill with send button, above the feed.
            var row = Pill("ChatRow", _safe, new Vector2(0, 0), new Vector2(0.62f, 0), new Vector2(0, 320), new Vector2(0, 416));
            _chatRow = row.gameObject;
            _chatInput = Input(row, "walk right · sit on the sofa · стрибни", new Vector2(24, 8), new Vector2(-110, -8), false);
            var send = RoundButton("send", row, IconZap, 76, Hot);
            send.anchorMin = send.anchorMax = new Vector2(1, 0.5f); send.anchoredPosition = new Vector2(-50, 0);
            send.GetComponent<Button>().onClick.RemoveAllListeners();
            send.GetComponent<Button>().onClick.AddListener(SubmitChat);
            _chatInput.onEndEdit.AddListener(_ => { if (!_chatInput.wasCanceled) SubmitChat(); });
            _chatRow.SetActive(false);
        }

        void BuildSetup()
        {
            // Settings sheet: one scrollable column of grouped cards (works in portrait and landscape). Each row is
            // an icon tile + label + current value; tapping cycles/acts. Inputs sit in their own rows.
            _setup = Box("Setup", _safe, GlassStrong, true).gameObject;
            var sheet = _setup.GetComponent<RectTransform>();
            Anchor(sheet, new Vector2(0.03f, 0.02f), new Vector2(0.97f, 0.98f), Vector2.zero, Vector2.zero);
            Border(sheet);
            var title = Label(sheet, "Settings", 40, FontStyle.Bold, Color.white, TextAnchor.UpperLeft, new Vector2(40, -40), new Vector2(-140, -30));
            title.font = _display;
            var close = RoundButton("close-setup", sheet, IconX, 80, Glass);
            close.anchorMin = close.anchorMax = new Vector2(1, 1); close.anchoredPosition = new Vector2(-60, -64);
            close.GetComponent<Button>().onClick.RemoveAllListeners();
            close.GetComponent<Button>().onClick.AddListener(() => _setup.SetActive(false));

            var viewport = Rect("Viewport", sheet);
            Anchor(viewport, Vector2.zero, Vector2.one, new Vector2(28, 24), new Vector2(-28, -120));
            viewport.gameObject.AddComponent<RectMask2D>();
            var content = Rect("Content", viewport);
            content.anchorMin = new Vector2(0f, 1); content.anchorMax = new Vector2(1f, 1); content.pivot = new Vector2(0.5f, 1);
            content.sizeDelta = new Vector2(0, 0); // full viewport width (portrait and landscape)
            var v = content.gameObject.AddComponent<VerticalLayoutGroup>();
            v.spacing = 10; v.padding = new RectOffset(0, 0, 0, 40);
            v.childControlHeight = true; v.childControlWidth = true; v.childForceExpandHeight = false; v.childForceExpandWidth = true;
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            var scroll = sheet.gameObject.AddComponent<ScrollRect>();
            scroll.viewport = viewport; scroll.content = content; scroll.horizontal = false; scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 40;

            // Grouped like IRL Pro's preference screens: coloured section header, one card per group, rows divided
            // by hairlines, a one-line explanation under the row title, switches for On/Off values.
            var stream = Section(content, "STREAM TO TWITCH", LiveRed);
            _channelInput = InputRow(stream, IconTwitch, "Twitch channel (chat + raids)");
            _keyInput = InputRow(stream, IconKey, "Stream key · stays on this phone");
            _keyInput.contentType = InputField.ContentType.Password;
            _quality = SettingRow(stream, IconGauge, "Quality", "Lower it on mobile data", "quality", "HD");
            var go = Row(Box("Go live", content, new Color(LiveRed.r, LiveRed.g, LiveRed.b, 0.95f), true), 104);
            var goIcon = Icon(go, IconBroadcast, 40, Color.white);
            Anchor(goIcon.rectTransform, new Vector2(0.5f, 0), new Vector2(0.5f, 1), new Vector2(-120, 0), new Vector2(-70, 0));
            Label(go, "Go live", 34, FontStyle.Bold, Color.white, TextAnchor.MiddleCenter, new Vector2(30, 0), Vector2.zero).font = _display;
            go.gameObject.AddComponent<Button>().onClick.AddListener(() => { OnGoLive?.Invoke(_channelInput.text.Trim().TrimStart('#').ToLowerInvariant(), _keyInput.text.Trim()); _setup.SetActive(false); });
            _liveInfo = Label(Row(Rect("Info", content), 76), "", 21, FontStyle.Normal, Dim, TextAnchor.UpperLeft, new Vector2(12, 0), new Vector2(-12, -6));
            var onAir = Section(content, "ON STREAM", LiveRed);
            _settingValues["caption"] = SettingRow(onAir, IconChat, "\"!join\" hint", "Caption telling viewers how to join", "caption", "On");
            SettingRow(onAir, IconEnd, "End stream", "Back to the demo room · tap twice", "end-live", null);

            var room = Section(content, "ROOM", Mint);
            _settingValues["scan"] = SettingRow(room, IconCube, "Room mesh", "How the scanned room looks", "scan", "Floor");
            SettingRow(room, IconSelfie, "Selfie camera", "Front camera with the heroes", "selfie", null);
            SettingRow(room, IconReset, "Reset room scan", "Map the room again", "reset-room", null);

            var comfort = Section(content, "COMFORT", Violet);
            _settingValues["sound"] = SettingRow(comfort, IconSpeaker, "Sound", null, "sound", "On");
            _settingValues["motion"] = SettingRow(comfort, IconEyeSlash, "Reduced motion", "Calmer flashes and shakes", "motion", "Off");

            var dev = Section(content, "SERVER & TESTING", Dim);
            _serverInput = InputRow(dev, IconLink, ServerConnection.DefaultServer);
            _tokenInput = InputRow(dev, IconKey, "Pairing token · empty = debug pairing");
            _tokenInput.contentType = InputField.ContentType.Password;
            SettingRow(dev, IconPlug, "Pair with server", null, "pair", null);
            SettingRow(dev, IconFlask, "Offline test room", null, "offline", null);
            SettingRow(dev, IconZap, "Server test raid", null, "server-raid", null);
            SettingRow(dev, IconMonitor, "Stream to PC (WebRTC)", null, "stream", null);
            var diagRow = Row(Rect("Diagnostics", content), 110);
            var di = Icon(diagRow, IconInfo, 26, new Color(1, 1, 1, 0.4f));
            Anchor(di.rectTransform, new Vector2(0, 1), new Vector2(0, 1), new Vector2(8, -40), new Vector2(44, -4));
            _diag = Label(diagRow, "", 20, FontStyle.Normal, new Color(1, 1, 1, 0.45f), TextAnchor.UpperLeft, new Vector2(52, 0), Vector2.zero);
            _setup.SetActive(false);
        }

        readonly Dictionary<string, Text> _settingValues = new Dictionary<string, Text>();
        readonly Dictionary<string, (Image track, RectTransform knob)> _switches = new Dictionary<string, (Image, RectTransform)>();
        Color _sectionTint = Hot;

        /// <summary>Right-hand value of a settings row (e.g. "scan" → "Hidden", "sound" → "Off").</summary>
        public void SetSetting(string id, string value)
        {
            if (_settingValues.TryGetValue(id, out var t) && t != null) t.text = value;
            if (_switches.TryGetValue(id, out var s)) SetSwitch(s.track, s.knob, value == "On");
        }

        void SetSwitch(Image track, RectTransform knob, bool on)
        {
            track.color = on ? Mint : new Color(1, 1, 1, 0.2f);
            knob.anchoredPosition = new Vector2(on ? 15 : -15, 0);
        }

        /// <summary>Coloured header + a rounded card the following rows go into.</summary>
        RectTransform Section(RectTransform content, string text, Color color)
        {
            var t = Label(Row(Rect("Section", content), 62), text, 22, FontStyle.Bold, color, TextAnchor.LowerLeft, new Vector2(14, 10), Vector2.zero);
            t.font = _display;
            _sectionTint = color;
            var g = Box("Group " + text, content, new Color(1f, 1f, 1f, 0.05f), true);
            Border(g);
            var v = g.gameObject.AddComponent<VerticalLayoutGroup>();
            v.spacing = 0; v.padding = new RectOffset(0, 0, 4, 4);
            v.childControlHeight = true; v.childControlWidth = true; v.childForceExpandHeight = false; v.childForceExpandWidth = true;
            return g;
        }

        /// <summary>Hairline between rows of a group (not above the first).</summary>
        void Divider(RectTransform group, RectTransform row)
        {
            int rows = 0;
            foreach (Transform c in group)
            {
                var le = c.GetComponent<LayoutElement>(); // != null, not `is`: Unity's fake null in the editor
                if (le != null && !le.ignoreLayout) rows++;
            }
            if (rows <= 1) return;
            var d = Box("Divider", row, new Color(1, 1, 1, 0.08f), false);
            Anchor(d, new Vector2(0, 1), new Vector2(1, 1), new Vector2(98, -1), new Vector2(-20, 0));
            d.GetComponent<Image>().raycastTarget = false;
        }

        /// <summary>Icon tile + title (+ grey explanation) + value / switch / chevron. Tapping invokes the action.</summary>
        Text SettingRow(RectTransform group, string icon, string title, string subtitle, string action, string value)
        {
            var r = Row(Box("Row " + title, group, new Color(1f, 1f, 1f, 0f), false), subtitle != null ? 108 : 92);
            Divider(group, r);
            var tile = Box("Tile", r, new Color(_sectionTint.r, _sectionTint.g, _sectionTint.b, 0.26f), true);
            tile.anchorMin = tile.anchorMax = new Vector2(0, 0.5f); tile.sizeDelta = new Vector2(58, 58); tile.anchoredPosition = new Vector2(50, 0);
            Icon(tile, icon, 30, Color.white);
            bool isSwitch = value == "On" || value == "Off";
            float right = value == null ? -76 : isSwitch ? -140 : -250;
            if (subtitle != null)
            {
                Label(r, title, 28, FontStyle.Bold, Color.white, TextAnchor.LowerLeft, new Vector2(98, 54), new Vector2(right, -12));
                var st = Label(r, subtitle, 21, FontStyle.Normal, new Color(1, 1, 1, 0.5f), TextAnchor.UpperLeft, new Vector2(98, 0), new Vector2(right, -58));
                st.horizontalOverflow = HorizontalWrapMode.Wrap;
            }
            else Label(r, title, 28, FontStyle.Bold, Color.white, TextAnchor.MiddleLeft, new Vector2(98, 0), new Vector2(right, 0));
            Text val = null;
            if (value != null)
            {
                val = Label(r, value, 25, FontStyle.Normal, Mint, TextAnchor.MiddleRight, new Vector2(-240, 0), new Vector2(-28, 0));
                val.rectTransform.anchorMin = new Vector2(1, 0);
                if (isSwitch)
                {
                    val.gameObject.SetActive(false); // the switch shows it
                    var track = Box("Switch", r, Mint, true);
                    track.anchorMin = track.anchorMax = new Vector2(1, 0.5f); track.sizeDelta = new Vector2(76, 46); track.anchoredPosition = new Vector2(-66, 0);
                    var knob = Circle("Knob", track, 36, Color.white);
                    knob.anchorMin = knob.anchorMax = new Vector2(0.5f, 0.5f);
                    var trackImg = track.GetComponent<Image>(); trackImg.raycastTarget = false;
                    _switches[action] = (trackImg, knob);
                    SetSwitch(trackImg, knob, value == "On");
                }
            }
            else
            {
                var caret = Icon(r, IconCaret, 24, new Color(1, 1, 1, 0.35f));
                Anchor(caret.rectTransform, new Vector2(1, 0), new Vector2(1, 1), new Vector2(-56, 0), new Vector2(-22, 0));
            }
            var b = r.gameObject.AddComponent<Button>();
            b.onClick.AddListener(() =>
            {
                if (action == "pair") { OnServer?.Invoke(_serverInput.text, _tokenInput.text.Trim()); _tokenInput.text = ""; }
                _keepSheet = false;
                OnButton?.Invoke(action);
                // Toggles stay open so the new value is visible; actions close the sheet, except a first tap that
                // only armed a two-tap confirm (End / Reset / Offline while live): the second tap must land on the row.
                if (value == null && !_keepSheet) _setup.SetActive(false);
            });
            return val;
        }

        InputField InputRow(RectTransform group, string icon, string placeholder)
        {
            var r = Row(Rect("Input row", group), 92);
            Divider(group, r);
            var ic = Icon(r, icon, 30, Dim);
            Anchor(ic.rectTransform, new Vector2(0, 0), new Vector2(0, 1), new Vector2(26, 0), new Vector2(74, 0));
            return Input(r, placeholder, new Vector2(76, 8), new Vector2(-16, -8), false);
        }

        void Press(string id)
        {
            OnButton?.Invoke(id);
        }

        void SubmitChat()
        {
            var text = _chatInput.text.Trim();
            if (text.Length == 0) return;
            _chatInput.text = "";
            OnChat?.Invoke(text);
        }

        // ---------------- building blocks ----------------
        RectTransform Pill(string name, Transform parent, Vector2 aMin, Vector2 aMax, Vector2 offMin, Vector2 offMax)
        {
            var r = Box(name, parent, Glass, true);
            Anchor(r, aMin, aMax, offMin, offMax);
            Border(r);
            return r;
        }

        RectTransform RoundButton(string id, Transform parent, string icon, float size, Color fill)
        {
            var r = Rect("Button " + id, parent);
            r.sizeDelta = new Vector2(size, size);
            var img = r.gameObject.AddComponent<Image>();
            img.sprite = CircleSprite(); img.color = fill;
            var ring = Rect("Ring", r); Stretch(ring);
            var ringImg = ring.gameObject.AddComponent<Image>();
            ringImg.sprite = RingSprite(); ringImg.color = Edge; ringImg.raycastTarget = false;
            var t = Icon(r, icon, size * 0.42f, Color.white);
            var b = r.gameObject.AddComponent<Button>();
            b.targetGraphic = img;
            var colors = b.colors; colors.pressedColor = new Color(0.8f, 0.8f, 0.8f, 1f); b.colors = colors;
            b.onClick.AddListener(() => Press(id));
            _buttons[id] = (r.gameObject, t, ringImg);
            return r;
        }

        RectTransform Circle(string name, Transform parent, float size, Color color)
        {
            var r = Rect(name, parent);
            r.sizeDelta = new Vector2(size, size);
            var img = r.gameObject.AddComponent<Image>();
            img.sprite = CircleSprite(); img.color = color; img.raycastTarget = false;
            return r;
        }

        Text Icon(Transform parent, string glyph, float size, Color color)
        {
            var r = Rect("Icon", parent); Stretch(r);
            var t = r.gameObject.AddComponent<Text>();
            t.font = _icons; t.text = glyph; t.fontSize = Mathf.RoundToInt(size); t.color = color;
            t.alignment = TextAnchor.MiddleCenter; t.raycastTarget = false;
            t.horizontalOverflow = HorizontalWrapMode.Overflow; t.verticalOverflow = VerticalWrapMode.Overflow;
            return t;
        }

        void Border(RectTransform r)
        {
            var b = Rect("Border", r); Stretch(b);
            b.gameObject.AddComponent<LayoutElement>().ignoreLayout = true; // decoration, not a row of a group
            var img = b.gameObject.AddComponent<Image>();
            img.sprite = RoundedRing(); img.type = Image.Type.Sliced; img.color = Edge; img.raycastTarget = false;
        }

        RectTransform Column(RectTransform parent, float xMin, float xMax)
        {
            var c = Rect("Column", parent);
            Anchor(c, new Vector2(xMin, 0), new Vector2(xMax, 1), new Vector2(36, 32), new Vector2(-36, -100));
            var v = c.gameObject.AddComponent<VerticalLayoutGroup>();
            v.spacing = 12;
            v.childControlHeight = true; v.childControlWidth = true;
            v.childForceExpandHeight = false; v.childForceExpandWidth = true;
            return c;
        }

        static RectTransform Row(RectTransform r, float height = 80)
        {
            var le = r.gameObject.AddComponent<LayoutElement>();
            le.preferredHeight = height; le.minHeight = height * 0.75f;
            return r;
        }

        void Heading(RectTransform column, string text, Color color)
        {
            var t = Label(Row(Rect("Heading", column), 56), text, 28, FontStyle.Bold, color, TextAnchor.MiddleLeft, Vector2.zero, Vector2.zero);
            t.font = _display;
        }

        Button SheetButton(RectTransform column, string title, string action, bool primary)
        {
            var r = Row(Box("Button " + title, column, primary ? new Color(LiveRed.r, LiveRed.g, LiveRed.b, 0.95f) : new Color(1f, 1f, 1f, 0.07f), true), primary ? 96 : 76);
            if (!primary) Border(r);
            var b = r.gameObject.AddComponent<Button>();
            Label(r, title, primary ? 32 : 26, FontStyle.Bold, Color.white, TextAnchor.MiddleCenter, Vector2.zero, Vector2.zero);
            if (action != null)
                b.onClick.AddListener(() =>
                {
                    if (action == "pair") { OnServer?.Invoke(_serverInput.text, _tokenInput.text.Trim()); _tokenInput.text = ""; }
                    _keepSheet = false;
                    OnButton?.Invoke(action);
                    if (action != "quality" && !_keepSheet) _setup.SetActive(false);
                });
            return b;
        }

        static string Escape(string s) => (s ?? "").Replace("<", "‹").Replace(">", "›");

        /// <summary>Stable Twitch-like name colour per viewer.</summary>
        static string NameColor(string name)
        {
            string[] palette = { "#ff7aa8", "#7ad7ff", "#ffd36e", "#9dff8a", "#c79bff", "#ff9f5a", "#5af1c8" };
            int h = 0;
            foreach (var c in name ?? "") h = unchecked(h * 31 + c);
            return palette[((h % palette.Length) + palette.Length) % palette.Length];
        }

        static RectTransform Rect(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return go.GetComponent<RectTransform>();
        }

        static void Stretch(RectTransform r) { r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one; r.offsetMin = r.offsetMax = Vector2.zero; }

        static void Anchor(RectTransform r, Vector2 min, Vector2 max, Vector2 offMin, Vector2 offMax)
        {
            r.anchorMin = min; r.anchorMax = max; r.offsetMin = offMin; r.offsetMax = offMax;
        }

        RectTransform Box(string name, Transform parent, Color color, bool rounded)
        {
            var r = Rect(name, parent);
            var img = r.gameObject.AddComponent<Image>();
            img.color = color;
            img.sprite = rounded ? Rounded() : null;
            img.type = rounded ? Image.Type.Sliced : Image.Type.Simple;
            return r;
        }

        Text Label(Transform parent, string text, int size, FontStyle style, Color color, TextAnchor align, Vector2 offMin, Vector2 offMax)
        {
            var r = Rect("Text", parent);
            Stretch(r);
            r.offsetMin = offMin; r.offsetMax = offMax;
            var t = r.gameObject.AddComponent<Text>();
            bool bold = style == FontStyle.Bold && _bold != null;
            t.font = bold ? _bold : _font; t.fontSize = size; t.fontStyle = bold ? FontStyle.Normal : style; t.color = color; t.alignment = align;
            t.text = text; t.supportRichText = true; t.raycastTarget = false;
            t.horizontalOverflow = HorizontalWrapMode.Wrap; t.verticalOverflow = VerticalWrapMode.Overflow;
            return t;
        }

        InputField Input(Transform parent, string placeholder, Vector2 offMin, Vector2 offMax, bool boxed)
        {
            var r = Box("Input", parent, boxed ? new Color(1, 1, 1, 0.07f) : new Color(0, 0, 0, 0), true);
            Stretch(r);
            r.offsetMin = offMin; r.offsetMax = offMax;
            if (boxed) Border(r);
            var field = r.gameObject.AddComponent<InputField>();
            var text = Label(r, "", 28, FontStyle.Normal, Color.white, TextAnchor.MiddleLeft, new Vector2(22, 0), new Vector2(-22, 0));
            text.supportRichText = false;
            var hint = Label(r, placeholder, 26, FontStyle.Normal, new Color(1, 1, 1, .38f), TextAnchor.MiddleLeft, new Vector2(22, 0), new Vector2(-22, 0));
            field.textComponent = text;
            field.placeholder = hint;
            field.lineType = InputField.LineType.SingleLine;
            return field;
        }

        // ---------------- procedural sprites ----------------
        static Sprite _rounded, _roundedRing, _circle, _ring, _orb;

        static Sprite Rounded()
        {
            if (_rounded != null) return _rounded;
            const int s = 96, rad = 46;
            var tex = new Texture2D(s, s, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < s; y++)
                for (int x = 0; x < s; x++)
                    tex.SetPixel(x, y, new Color(1, 1, 1, RoundedAlpha(x, y, s, rad)));
            tex.Apply();
            _rounded = Sprite.Create(tex, new Rect(0, 0, s, s), new Vector2(.5f, .5f), 100, 0, SpriteMeshType.FullRect, new Vector4(rad, rad, rad, rad));
            return _rounded;
        }

        static Sprite RoundedRing()
        {
            if (_roundedRing != null) return _roundedRing;
            const int s = 96, rad = 46;
            var tex = new Texture2D(s, s, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < s; y++)
                for (int x = 0; x < s; x++)
                {
                    float outer = RoundedAlpha(x, y, s, rad);
                    float inner = RoundedAlphaInset(x, y, s, rad, 2.2f);
                    tex.SetPixel(x, y, new Color(1, 1, 1, Mathf.Clamp01(outer - inner)));
                }
            tex.Apply();
            _roundedRing = Sprite.Create(tex, new Rect(0, 0, s, s), new Vector2(.5f, .5f), 100, 0, SpriteMeshType.FullRect, new Vector4(rad, rad, rad, rad));
            return _roundedRing;
        }

        static float RoundedAlpha(int x, int y, int s, int rad)
        {
            float dx = Mathf.Max(0, Mathf.Max(rad - x, x - (s - 1 - rad)));
            float dy = Mathf.Max(0, Mathf.Max(rad - y, y - (s - 1 - rad)));
            return Mathf.Clamp01(rad - Mathf.Sqrt(dx * dx + dy * dy) + 0.5f);
        }

        static float RoundedAlphaInset(int x, int y, int s, int rad, float inset)
        {
            float r = rad - inset;
            float cx = Mathf.Clamp(x, rad, s - 1 - rad), cy = Mathf.Clamp(y, rad, s - 1 - rad);
            float d = Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
            float edge = Mathf.Min(Mathf.Min(x, s - 1 - x), Mathf.Min(y, s - 1 - y));
            if (x >= rad && x <= s - 1 - rad || y >= rad && y <= s - 1 - rad) return Mathf.Clamp01(edge - inset + 0.5f);
            return Mathf.Clamp01(r - d + 0.5f);
        }

        static Sprite CircleSprite()
        {
            if (_circle != null) return _circle;
            _circle = MakeCircle(128, (d, r) => new Color(1, 1, 1, Mathf.Clamp01(r - d + 0.5f)));
            return _circle;
        }

        static Sprite RingSprite()
        {
            if (_ring != null) return _ring;
            _ring = MakeCircle(128, (d, r) => new Color(1, 1, 1, Mathf.Clamp01(r - d + 0.5f) * Mathf.Clamp01(d - (r - 3f) + 0.5f)));
            return _ring;
        }

        /// <summary>Primary orb: hot violet → magenta radial gradient with a soft top highlight.</summary>
        static Sprite OrbSprite()
        {
            if (_orb != null) return _orb;
            _orb = MakeCircle(160, (d, r) =>
            {
                float t = d / r;
                var c = Color.Lerp(new Color(0.78f, 0.36f, 1f), new Color(0.46f, 0.08f, 0.9f), t);
                return new Color(c.r, c.g, c.b, Mathf.Clamp01(r - d + 0.5f));
            });
            return _orb;
        }

        static Sprite MakeCircle(int s, Func<float, float, Color> shade)
        {
            var tex = new Texture2D(s, s, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            float r = s / 2f - 1f, c = (s - 1) / 2f;
            for (int y = 0; y < s; y++)
                for (int x = 0; x < s; x++)
                {
                    float d = Mathf.Sqrt((x - c) * (x - c) + (y - c) * (y - c));
                    tex.SetPixel(x, y, shade(d, r));
                }
            tex.Apply();
            return Sprite.Create(tex, new Rect(0, 0, s, s), new Vector2(.5f, .5f), 100);
        }
    }
}
