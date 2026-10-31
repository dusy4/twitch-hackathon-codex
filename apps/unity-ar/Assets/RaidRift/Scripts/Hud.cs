using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RaidRift
{
    /// <summary>Compact phone HUD built in code: a slim status pill on top, a 3-line chat feed and one
    /// button row at the bottom, small screen-space name tags over heroes. The camera stays visible.</summary>
    public class Hud : MonoBehaviour
    {
        static readonly Color Panel = new Color(0.06f, 0.07f, 0.11f, 0.78f);
        static readonly Color Violet = new Color(0.78f, 0.6f, 1f);
        static readonly Color Mint = new Color(0.57f, 1f, 0.88f);

        Font _font;
        RectTransform _root;
        Text _title, _status, _hint, _feed, _toast;
        RectTransform _labels;
        GameObject _chatRow, _setup;
        InputField _chatInput, _serverInput, _tokenInput;
        RawImage _backdrop;
        readonly Dictionary<string, (RectTransform rect, Text text)> _tags = new Dictionary<string, (RectTransform, Text)>();
        readonly Dictionary<string, Text> _buttons = new Dictionary<string, Text>();
        float _toastUntil;

        public event Action<string> OnButton;
        public event Action<string> OnChat;
        public event Action<string, string> OnServer;

        public bool Typing => (_chatInput != null && _chatInput.isFocused) || (_serverInput != null && _serverInput.isFocused) || (_tokenInput != null && _tokenInput.isFocused);

        Image _flash;
        RawImage _vignette;
        float _flashAmount, _vignetteAmount;
        Color _flashColor = Color.white;

        /// <summary>Camera "hit": a coloured flash plus a vignette pulse that fade out (portal opening, hops).</summary>
        public void Flash(Color color, float strength)
        {
            EnsureOverlays();
            _flashColor = color;
            _flashAmount = Mathf.Max(_flashAmount, strength);
            _vignetteAmount = Mathf.Max(_vignetteAmount, strength * 1.4f);
        }

        void EnsureOverlays()
        {
            if (_flash != null) return;
            var v = Rect("Vignette", _root);
            Stretch(v);
            v.SetSiblingIndex(1);
            _vignette = v.gameObject.AddComponent<RawImage>();
            _vignette.raycastTarget = false;
            const int s = 128;
            var tex = new Texture2D(s, s, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < s; y++)
                for (int x = 0; x < s; x++)
                {
                    float dx = (x + 0.5f) / s * 2 - 1, dy = (y + 0.5f) / s * 2 - 1;
                    float r = Mathf.Sqrt(dx * dx + dy * dy) / 1.414f;
                    tex.SetPixel(x, y, new Color(0.25f, 0.05f, 0.4f, Mathf.SmoothStep(0.45f, 1f, r)));
                }
            tex.Apply();
            _vignette.texture = tex;
            _vignette.color = new Color(1, 1, 1, 0);
            var f = Rect("Flash", _root);
            Stretch(f);
            f.SetSiblingIndex(2);
            _flash = f.gameObject.AddComponent<Image>();
            _flash.raycastTarget = false;
            _flash.color = new Color(1, 1, 1, 0);
        }

        void LateUpdate()
        {
            if (_flash == null) return;
            _flashAmount = Mathf.MoveTowards(_flashAmount, 0f, Time.deltaTime * 1.8f);
            _vignetteAmount = Mathf.MoveTowards(_vignetteAmount, 0f, Time.deltaTime * 0.9f);
            _flash.color = new Color(_flashColor.r, _flashColor.g, _flashColor.b, _flashAmount * 0.55f);
            _vignette.color = new Color(1, 1, 1, Mathf.Clamp01(_vignetteAmount));
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

        public void Build()
        {
            _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
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

            var safe = Rect("Safe", _root);
            var area = Screen.safeArea;
            safe.anchorMin = new Vector2(area.xMin / Screen.width, area.yMin / Screen.height);
            safe.anchorMax = new Vector2(area.xMax / Screen.width, area.yMax / Screen.height);
            safe.offsetMin = safe.offsetMax = Vector2.zero;

            _labels = Rect("Labels", _root);
            Stretch(_labels);
            _labels.SetAsFirstSibling();

            // Top pill
            var top = Box("Top", safe, Panel);
            Anchor(top, new Vector2(0, 1), new Vector2(1, 1), new Vector2(24, -160), new Vector2(-24, -24));
            _title = Label(top, "RAIDRIFT", 40, FontStyle.Bold, Color.white, TextAnchor.UpperLeft, new Vector2(28, -16), new Vector2(-28, -8));
            _status = Label(top, "", 28, FontStyle.Normal, Violet, TextAnchor.LowerLeft, new Vector2(28, 12), new Vector2(-28, -70));

            _hint = Label(safe, "", 32, FontStyle.Bold, Mint, TextAnchor.UpperCenter, Vector2.zero, Vector2.zero);
            Anchor(_hint.rectTransform, new Vector2(0, 1), new Vector2(1, 1), new Vector2(40, -260), new Vector2(-40, -175));
            _hint.gameObject.AddComponent<Shadow>().effectDistance = new Vector2(2, -2);

            _toast = Label(safe, "", 30, FontStyle.Normal, Color.white, TextAnchor.MiddleCenter, Vector2.zero, Vector2.zero);
            Anchor(_toast.rectTransform, new Vector2(0, 0.5f), new Vector2(1, 0.5f), new Vector2(60, -60), new Vector2(-60, 60));
            _toast.gameObject.AddComponent<Shadow>().effectDistance = new Vector2(2, -2);

            // Bottom: feed + buttons
            var feedBox = Box("Feed", safe, Panel);
            Anchor(feedBox, new Vector2(0, 0), new Vector2(1, 0), new Vector2(24, 170), new Vector2(-24, 330));
            _feed = Label(feedBox, "", 26, FontStyle.Normal, new Color(1, 1, 1, .9f), TextAnchor.LowerLeft, new Vector2(24, 12), new Vector2(-24, -12));

            var row = Box("Buttons", safe, Panel);
            Anchor(row, new Vector2(0, 0), new Vector2(1, 0), new Vector2(24, 24), new Vector2(-24, 150));
            var layout = row.gameObject.AddComponent<HorizontalLayoutGroup>();
            layout.padding = new RectOffset(12, 12, 12, 12);
            layout.spacing = 10;
            layout.childForceExpandWidth = true;
            layout.childForceExpandHeight = true;
            foreach (var id in new[] { "raid", "follow", "trail", "scan", "chat", "setup" }) Button(row, id);

            // Chat input row
            _chatRow = Box("ChatRow", safe, Panel).gameObject;
            var chatRect = _chatRow.GetComponent<RectTransform>();
            Anchor(chatRect, new Vector2(0, 0), new Vector2(1, 0), new Vector2(24, 345), new Vector2(-24, 455));
            _chatInput = Input(chatRect, "walk right · стрибни · turn around then dance", new Vector2(16, 12), new Vector2(-200, -12));
            var send = SmallButton(chatRect, "Send", new Vector2(1, 0), new Vector2(1, 1), new Vector2(-185, 12), new Vector2(-16, -12));
            send.onClick.AddListener(SubmitChat);
            // Android's soft keyboard "Done" ends the edit without a Return key event.
            _chatInput.onEndEdit.AddListener(_ => { if (!_chatInput.wasCanceled) SubmitChat(); });
            _chatRow.SetActive(false);

            // Setup panel
            _setup = Box("Setup", safe, Panel).gameObject;
            var setupRect = _setup.GetComponent<RectTransform>();
            Anchor(setupRect, new Vector2(0, 0.5f), new Vector2(1, 0.5f), new Vector2(40, -500), new Vector2(-40, 500));
            Label(setupRect, "Server (Tailscale) · pairing token from Creator Studio (optional)", 28, FontStyle.Bold, Violet, TextAnchor.UpperLeft, new Vector2(30, -30), new Vector2(-30, -20));
            _serverInput = Input(setupRect, ServerConnection.DefaultServer, Vector2.zero, Vector2.zero);
            Anchor(_serverInput.GetComponent<RectTransform>(), new Vector2(0, 1), new Vector2(1, 1), new Vector2(30, -175), new Vector2(-30, -85));
            _tokenInput = Input(setupRect, "paste token · empty = debug pairing", Vector2.zero, Vector2.zero);
            Anchor(_tokenInput.GetComponent<RectTransform>(), new Vector2(0, 1), new Vector2(1, 1), new Vector2(30, -280), new Vector2(-30, -190));
            _tokenInput.contentType = InputField.ContentType.Password;
            string[] actions = { "pair", "stream", "offline", "server-raid", "reset-room", "sound" };
            string[] titles = { "Pair & go live", "Stream to PC (WebRTC)", "Offline test room", "Server test raid", "Reset room scan", "Sound on/off" };
            for (int i = 0; i < actions.Length; i++)
            {
                var a = actions[i];
                var b = SmallButton(setupRect, titles[i], new Vector2(0, 1), new Vector2(1, 1), new Vector2(30, -400 - i * 100), new Vector2(-30, -310 - i * 100));
                b.onClick.AddListener(() =>
                {
                    if (a == "pair") { OnServer?.Invoke(_serverInput.text, _tokenInput.text.Trim()); _tokenInput.text = ""; }
                    OnButton?.Invoke(a);
                    _setup.SetActive(false);
                });
            }
            _setup.SetActive(false);
        }

        void SubmitChat()
        {
            var text = _chatInput.text.Trim();
            if (text.Length == 0) return;
            _chatInput.text = "";
            OnChat?.Invoke(text);
        }

        public void ToggleChat() => _chatRow.SetActive(!_chatRow.activeSelf);
        public void ToggleSetup(string server) { _serverInput.text = server; _setup.SetActive(!_setup.activeSelf); }

        public void SetButton(string id, string title, bool on)
        {
            if (!_buttons.TryGetValue(id, out var t)) return;
            t.text = title;
            t.color = on ? Mint : Color.white;
        }

        public void SetStatus(string title, string status, string hint)
        {
            _title.text = title;
            _status.text = status;
            _hint.text = hint;
        }

        public void SetFeed(IList<ChatLine> lines)
        {
            var sb = new System.Text.StringBuilder();
            for (int i = Mathf.Max(0, lines.Count - 3); i < lines.Count; i++)
            {
                var l = lines[i];
                var color = l.System ? (l.Ok ? "#c79bff" : "#ff8a9a") : "#ffffff";
                sb.Append("<color=").Append(color).Append("><b>").Append(Escape(l.Speaker)).Append("</b></color>  ").Append(Escape(l.Text));
                if (i < lines.Count - 1) sb.Append('\n');
            }
            _feed.text = sb.ToString();
        }

        static string Escape(string s) => (s ?? "").Replace("<", "‹").Replace(">", "›");

        public void Toast(string text, float seconds = 2.5f)
        {
            _toast.text = text;
            _toastUntil = Time.time + seconds;
        }

        void Update()
        {
            if (_toast != null && Time.time > _toastUntil) _toast.text = "";
        }

        /// <summary>Name tags: small pills pinned above each hero's head, hidden when off screen.</summary>
        public void UpdateTags(Camera cam, IEnumerable<Hero> heroes)
        {
            var seen = new HashSet<string>();
            foreach (var hero in heroes)
            {
                if (hero == null || !hero.Spawned) continue;
                seen.Add(hero.Id);
                if (!_tags.TryGetValue(hero.Id, out var tag))
                {
                    var box = Box("Tag " + hero.Id, _labels, new Color(0.06f, 0.07f, 0.11f, 0.65f));
                    box.sizeDelta = new Vector2(320, 64);
                    var fit = box.gameObject.AddComponent<ContentSizeFitter>();
                    fit.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
                    fit.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
                    var lay = box.gameObject.AddComponent<HorizontalLayoutGroup>();
                    lay.padding = new RectOffset(14, 14, 6, 6);
                    var text = Label(box, "", 24, FontStyle.Bold, Color.white, TextAnchor.MiddleCenter, Vector2.zero, Vector2.zero);
                    tag = (box, text);
                    _tags[hero.Id] = tag;
                }
                var world = hero.transform.position + Vector3.up * (Hero.Height + 0.06f);
                var screen = cam.WorldToScreenPoint(world);
                bool visible = screen.z > 0.05f && screen.x > -50 && screen.x < Screen.width + 50 && screen.y > 0 && screen.y < Screen.height;
                tag.rect.gameObject.SetActive(visible);
                if (!visible) continue;
                float scale = _root.localScale.x;
                tag.rect.anchoredPosition = new Vector2(screen.x / scale, screen.y / scale);
                var msg = string.IsNullOrEmpty(hero.Message) ? "" : "\n<color=#c79bff>" + Escape(Truncate(hero.Message, 28)) + "</color>";
                tag.text.text = Escape(hero.DisplayName) + msg;
            }
            var stale = new List<string>();
            foreach (var k in _tags.Keys) if (!seen.Contains(k)) stale.Add(k);
            foreach (var k in stale) { Destroy(_tags[k].rect.gameObject); _tags.Remove(k); }
        }

        static string Truncate(string s, int n) => s.Length <= n ? s : s.Substring(0, n - 1) + "…";

        // ---- tiny uGUI helpers ----
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

        RectTransform Box(string name, Transform parent, Color color)
        {
            var r = Rect(name, parent);
            var img = r.gameObject.AddComponent<Image>();
            img.color = color;
            img.sprite = Rounded();
            img.type = Image.Type.Sliced;
            r.pivot = name.StartsWith("Tag ") ? new Vector2(0.5f, 0f) : new Vector2(0.5f, 0.5f);
            if (name.StartsWith("Tag ")) { r.anchorMin = r.anchorMax = Vector2.zero; img.raycastTarget = false; }
            return r;
        }

        Text Label(Transform parent, string text, int size, FontStyle style, Color color, TextAnchor align, Vector2 offMin, Vector2 offMax)
        {
            var r = Rect("Text", parent);
            Stretch(r);
            r.offsetMin = offMin; r.offsetMax = offMax;
            var t = r.gameObject.AddComponent<Text>();
            t.font = _font; t.fontSize = size; t.fontStyle = style; t.color = color; t.alignment = align;
            t.text = text; t.supportRichText = true; t.raycastTarget = false;
            t.horizontalOverflow = HorizontalWrapMode.Wrap; t.verticalOverflow = VerticalWrapMode.Overflow;
            return t;
        }

        void Button(Transform parent, string id)
        {
            var r = Box("Button " + id, parent, new Color(1, 1, 1, 0.06f));
            var b = r.gameObject.AddComponent<Button>();
            var t = Label(r, id, 26, FontStyle.Bold, Color.white, TextAnchor.MiddleCenter, Vector2.zero, Vector2.zero);
            _buttons[id] = t;
            b.onClick.AddListener(() => OnButton?.Invoke(id));
        }

        Button SmallButton(Transform parent, string title, Vector2 min, Vector2 max, Vector2 offMin, Vector2 offMax)
        {
            var r = Box("Button " + title, parent, new Color(0.78f, 0.6f, 1f, 0.25f));
            Anchor(r, min, max, offMin, offMax);
            var b = r.gameObject.AddComponent<Button>();
            Label(r, title, 30, FontStyle.Bold, Color.white, TextAnchor.MiddleCenter, Vector2.zero, Vector2.zero);
            return b;
        }

        InputField Input(Transform parent, string placeholder, Vector2 offMin, Vector2 offMax)
        {
            var r = Box("Input", parent, new Color(1, 1, 1, 0.08f));
            Stretch(r);
            r.offsetMin = offMin; r.offsetMax = offMax;
            var field = r.gameObject.AddComponent<InputField>();
            var text = Label(r, "", 30, FontStyle.Normal, Color.white, TextAnchor.MiddleLeft, new Vector2(20, 0), new Vector2(-20, 0));
            text.supportRichText = false;
            var hint = Label(r, placeholder, 28, FontStyle.Italic, new Color(1, 1, 1, .4f), TextAnchor.MiddleLeft, new Vector2(20, 0), new Vector2(-20, 0));
            field.textComponent = text;
            field.placeholder = hint;
            field.lineType = InputField.LineType.SingleLine;
            return field;
        }

        static Sprite _rounded;
        static Sprite Rounded()
        {
            if (_rounded != null) return _rounded;
            const int s = 64, rad = 24;
            var tex = new Texture2D(s, s, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < s; y++)
            for (int x = 0; x < s; x++)
            {
                float dx = Mathf.Max(0, Mathf.Max(rad - x, x - (s - 1 - rad)));
                float dy = Mathf.Max(0, Mathf.Max(rad - y, y - (s - 1 - rad)));
                float a = Mathf.Clamp01(rad - Mathf.Sqrt(dx * dx + dy * dy) + 0.5f);
                tex.SetPixel(x, y, new Color(1, 1, 1, a));
            }
            tex.Apply();
            _rounded = Sprite.Create(tex, new Rect(0, 0, s, s), new Vector2(.5f, .5f), 100, 0, SpriteMeshType.FullRect, new Vector4(rad, rad, rad, rad));
            return _rounded;
        }
    }
}
