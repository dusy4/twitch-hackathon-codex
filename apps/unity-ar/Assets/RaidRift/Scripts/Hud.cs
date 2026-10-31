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
    ///   top-left   account chip (demo) or LIVE · timer · heroes · network chips (live)
    ///   top-centre scan progress chip while the room is being mapped
    ///   top-right  mic + red end-stream (live)
    ///   right      vertical rail of round glass icon buttons
    ///   bottom     hint pill, big round primary action (test raid), reset; chat lines fading bottom-left
    /// Icons: Lucide (ISC) font; text: Inter + Space Grotesk (OFL). Diagnostics live in the Setup sheet.
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

        // Lucide codepoints (lucide-static info.json)
        const string IconUsers = "", IconScan = "", IconChat = "", IconMap = "", IconSettings = "",
            IconMic = "", IconMicOff = "", IconEnd = "", IconReset = "", IconZap = "", IconWifi = "",
            IconSwords = "", IconX = "", IconSparkles = "", IconFootprints = "";

        Font _font, _bold, _display, _icons;
        RectTransform _root, _safe;
        Text _title, _subtitle, _hint, _toast, _liveInfo, _quality, _diag, _scanLabel, _livePill, _liveTimer, _liveHeroes, _liveNet;
        Image _scanBar;
        GameObject _account, _liveChips, _liveActions, _primary, _scanChip, _hintPill, _toastPill, _chatRow, _setup;
        readonly List<Text> _feedLines = new List<Text>();
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

        static readonly string[] DemoRail = { "follow", "scan", "chat", "trail", "setup" };
        static readonly string[] LiveRail = { "follow", "scan", "chat", "setup" };

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
            _primary.SetActive(!live && !_scanning);
            if (live && _livePill != null)
            {
                // chip arrives as "● LIVE 12:03" / "● CONNECTING" / "● OFFLINE"
                var parts = (chip ?? "").Replace("●", "").Trim().Split(' ');
                bool on = parts.Length > 0 && parts[0] == "LIVE";
                _livePill.text = on ? "LIVE" : (parts.Length > 0 ? parts[0] : "");
                _livePill.transform.parent.GetComponent<Image>().color = on ? LiveRed : new Color(0.3f, 0.3f, 0.36f, 0.9f);
                _liveTimer.text = on && parts.Length > 1 ? parts[1] : "--:--";
            }
        }

        public void SetLiveStats(int heroes, int kbps)
        {
            if (_liveHeroes != null) _liveHeroes.text = heroes.ToString();
            if (_liveNet != null) _liveNet.text = kbps > 0 ? $"{kbps / 1000f:0.0} Mbps" : "—";
        }

        public void SetLiveInfo(string info, string quality, string channel)
        {
            if (_liveInfo != null) _liveInfo.text = info;
            if (_quality != null) _quality.text = quality;
            if (_channelInput != null && !_channelInput.isFocused && string.IsNullOrEmpty(_channelInput.text)) _channelInput.text = channel;
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
            if (id == "mic") b.icon.text = title != null && title.Contains("off") ? IconMicOff : IconMic;
            b.icon.color = on ? Mint : Color.white;
            if (b.ring != null) b.ring.color = on ? new Color(Mint.r, Mint.g, Mint.b, 0.75f) : Edge;
        }

        public void SetFeed(IList<ChatLine> lines)
        {
            int n = _feedLines.Count;
            for (int i = 0; i < n; i++)
            {
                int li = lines.Count - n + i;
                var t = _feedLines[i];
                if (li < 0) { t.text = ""; continue; }
                var l = lines[li];
                var color = l.System ? (l.Ok ? "#c79bff" : "#ff8a9a") : NameColor(l.Speaker);
                t.text = $"<color={color}>{Escape(l.Speaker)}</color>  {Escape(l.Text)}";
                // Older lines fade out like a stream chat overlay.
                t.color = new Color(1f, 1f, 1f, Mathf.Lerp(0.35f, 1f, (float)(i + 1) / n));
            }
        }

        public void Toast(string text, float seconds = 2.5f)
        {
            _toast.text = text;
            _toastPill.SetActive(!string.IsNullOrEmpty(text));
            _toastUntil = Time.time + seconds;
        }

        public void ToggleChat()
        {
            _chatRow.SetActive(!_chatRow.activeSelf);
            if (_chatRow.activeSelf) _chatInput.ActivateInputField();
        }

        public void ToggleSetup(string server) { _serverInput.text = server; _setup.SetActive(!_setup.activeSelf); }

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
            _icons = Resources.Load<Font>("Fonts/Lucide") ?? _bold;
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

            // Live chips row: [● LIVE] [00:24] [heroes] [network]
            var row = Rect("LiveChips", _safe);
            Anchor(row, new Vector2(0, 1), new Vector2(0, 1), new Vector2(0, -76), new Vector2(760, 0));
            var h = row.gameObject.AddComponent<HorizontalLayoutGroup>();
            h.spacing = 18; h.childControlWidth = true; h.childControlHeight = true; h.childForceExpandWidth = false; h.childForceExpandHeight = true;
            _liveChips = row.gameObject;
            _livePill = ChipText(row, null, "LIVE", LiveRed, 130, true);
            _liveTimer = ChipText(row, null, "--:--", Glass, 140, false);
            _liveHeroes = ChipText(row, IconUsers, "0", Glass, 130, false);
            _liveNet = ChipText(row, IconWifi, "—", Glass, 200, false);
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
        }

        void BuildRail()
        {
            var rail = Rect("Rail", _safe);
            Anchor(rail, new Vector2(1, 0.5f), new Vector2(1, 0.5f), new Vector2(-104, -330), new Vector2(0, 330));
            var v = rail.gameObject.AddComponent<VerticalLayoutGroup>();
            v.spacing = 22; v.childAlignment = TextAnchor.MiddleCenter;
            v.childControlWidth = false; v.childControlHeight = false; v.childForceExpandHeight = false; v.childForceExpandWidth = false;
            RoundButton("follow", rail, IconUsers, 104, Glass);
            RoundButton("scan", rail, IconScan, 104, Glass);
            RoundButton("chat", rail, IconChat, 104, Glass);
            RoundButton("trail", rail, IconMap, 104, Glass);
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
            // Stream-style chat: no panel, text shadow, five lines fading upward, bottom-left.
            var feed = Rect("Feed", _safe);
            Anchor(feed, new Vector2(0, 0), new Vector2(0.42f, 0), new Vector2(8, 24), new Vector2(0, 300));
            var v = feed.gameObject.AddComponent<VerticalLayoutGroup>();
            v.childAlignment = TextAnchor.LowerLeft; v.spacing = 4;
            v.childControlHeight = true; v.childControlWidth = true; v.childForceExpandHeight = false; v.childForceExpandWidth = true;
            for (int i = 0; i < 5; i++)
            {
                var t = Label(Rect("Line", feed), "", 24, FontStyle.Normal, Color.white, TextAnchor.LowerLeft, Vector2.zero, Vector2.zero);
                t.rectTransform.parent.gameObject.AddComponent<LayoutElement>().preferredHeight = 52;
                var sh = t.gameObject.AddComponent<Shadow>(); sh.effectColor = new Color(0, 0, 0, 0.75f); sh.effectDistance = new Vector2(1.5f, -1.5f);
                _feedLines.Add(t);
            }

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
            _setup = Box("Setup", _safe, GlassStrong, true).gameObject;
            var setupRect = _setup.GetComponent<RectTransform>();
            Anchor(setupRect, new Vector2(0.02f, 0.02f), new Vector2(0.98f, 0.98f), Vector2.zero, Vector2.zero);
            Border(setupRect);
            var close = RoundButton("close-setup", setupRect, IconX, 80, Glass);
            close.anchorMin = close.anchorMax = new Vector2(1, 1); close.anchoredPosition = new Vector2(-56, -56);
            close.GetComponent<Button>().onClick.RemoveAllListeners();
            close.GetComponent<Button>().onClick.AddListener(() => _setup.SetActive(false));

            var liveCol = Column(setupRect, 0f, 0.5f);
            var demoCol = Column(setupRect, 0.5f, 1f);

            Heading(liveCol, "GO LIVE ON TWITCH", LiveRed);
            _channelInput = Row(Input(liveCol, "your Twitch channel (chat + raids)", Vector2.zero, Vector2.zero, true).GetComponent<RectTransform>()).GetComponent<InputField>();
            _keyInput = Row(Input(liveCol, "stream key · stays on this phone", Vector2.zero, Vector2.zero, true).GetComponent<RectTransform>()).GetComponent<InputField>();
            _keyInput.contentType = InputField.ContentType.Password;
            var quality = SheetButton(liveCol, "Quality", "quality", false);
            _quality = quality.GetComponentInChildren<Text>();
            var go = SheetButton(liveCol, "Go live", null, true);
            go.onClick.AddListener(() => { OnGoLive?.Invoke(_channelInput.text.Trim().TrimStart('#').ToLowerInvariant(), _keyInput.text.Trim()); _setup.SetActive(false); });
            SheetButton(liveCol, "End live · back to demo", "end-live", false);
            _liveInfo = Label(Row(Rect("Info", liveCol), 110), "", 22, FontStyle.Normal, Dim, TextAnchor.UpperLeft, Vector2.zero, Vector2.zero);

            Heading(demoCol, "DEMO & DEV", Violet);
            _serverInput = Row(Input(demoCol, ServerConnection.DefaultServer, Vector2.zero, Vector2.zero, true).GetComponent<RectTransform>()).GetComponent<InputField>();
            _tokenInput = Row(Input(demoCol, "pairing token · empty = debug pairing", Vector2.zero, Vector2.zero, true).GetComponent<RectTransform>()).GetComponent<InputField>();
            _tokenInput.contentType = InputField.ContentType.Password;
            string[] actions = { "pair", "offline", "server-raid", "stream", "sound", "motion" };
            string[] titles = { "Pair with server", "Offline test room", "Server test raid", "Stream to PC (WebRTC)", "Sound on/off", "Reduced motion on/off" };
            for (int i = 0; i < actions.Length; i++) SheetButton(demoCol, titles[i], actions[i], false);
            _diag = Label(Row(Rect("Diagnostics", demoCol), 130), "", 20, FontStyle.Normal, new Color(1, 1, 1, 0.45f), TextAnchor.UpperLeft, Vector2.zero, Vector2.zero);
            _setup.SetActive(false);
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
                    OnButton?.Invoke(action);
                    if (action != "quality") _setup.SetActive(false);
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
