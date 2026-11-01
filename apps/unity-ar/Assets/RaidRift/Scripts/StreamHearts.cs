using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace RaidRift
{
    /// <summary>
    /// ui-concept-1 live screen: hearts float up the right edge when chat does something (a command lands, a viewer
    /// joins, a raid arrives). A Screen Space - Camera canvas on the AR camera like StreamCaption, so the BROADCAST
    /// shows them too. Pooled Phosphor Fill glyphs, at most 3.5 new hearts a second (a raid queues up to 12), and the
    /// canvas is off whenever nothing is floating.
    /// </summary>
    public class StreamHearts : MonoBehaviour
    {
        class Heart { public RectTransform r; public Text t; public Color c; public float age, life, sway, x; }

        const string Glyph = ""; // Phosphor "heart"
        const int MaxLive = 10, MaxQueued = 12;
        static readonly Color[] Palette = { new Color(0.70f, 0.42f, 1f), new Color(1f, 0.37f, 0.64f), new Color(0.35f, 0.95f, 0.78f), new Color(0.80f, 0.55f, 1f) };

        static StreamHearts _i;
        Canvas _canvas;
        Camera _cam;
        RectTransform _lane;
        Font _font;
        readonly List<Heart> _live = new List<Heart>();
        readonly Stack<Heart> _free = new Stack<Heart>();
        int _queued;
        float _nextRelease;

        public static StreamHearts Create(Camera cam)
        {
            var go = new GameObject("Stream hearts", typeof(RectTransform));
            var h = go.AddComponent<StreamHearts>();
            h.Build(cam);
            _i = h;
            return h;
        }

        /// <summary>Queue [count] hearts (no-op before Create).</summary>
        public static void Pop(int count = 1)
        {
            if (_i == null) return;
            _i._queued = Mathf.Min(MaxQueued, _i._queued + count);
        }

        void Build(Camera cam)
        {
            _cam = cam;
            _canvas = gameObject.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceCamera;
            _canvas.worldCamera = cam;
            _canvas.planeDistance = Mathf.Max(cam.nearClipPlane * 2f, 0.12f);
            _canvas.sortingOrder = 1;
            var scaler = gameObject.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1080, 2340);
            scaler.matchWidthOrHeight = 0.5f;
            _canvas.enabled = false;
            // The 9:16 stream is a centre crop of the taller phone screen (rows ~9%..91% survive): keep the lane in it.
            _lane = new GameObject("Lane", typeof(RectTransform)).GetComponent<RectTransform>();
            _lane.SetParent(transform, false);
            _lane.anchorMin = new Vector2(0.84f, 0.12f);
            _lane.anchorMax = new Vector2(0.98f, 0.50f);
            _lane.offsetMin = _lane.offsetMax = Vector2.zero;
            _font = Resources.Load<Font>("Fonts/PhosphorFill");
        }

        Heart Take()
        {
            if (_free.Count > 0) { var f = _free.Pop(); f.r.gameObject.SetActive(true); return f; }
            var t = new GameObject("Heart", typeof(RectTransform)).AddComponent<Text>();
            t.transform.SetParent(_lane, false);
            t.font = _font;
            t.text = Glyph;
            t.fontSize = 96;
            t.alignment = TextAnchor.MiddleCenter;
            t.raycastTarget = false;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            var sh = t.gameObject.AddComponent<Shadow>();
            sh.effectColor = new Color(0f, 0f, 0f, 0.45f);
            sh.effectDistance = new Vector2(3f, -4f);
            var r = t.rectTransform;
            r.sizeDelta = new Vector2(130f, 130f);
            return new Heart { r = r, t = t };
        }

        /// <summary>Editor preview (FxPreview): lay out [count] hearts at spread-out ages without waiting for frames.</summary>
        public void PreviewNow(int count)
        {
            for (int n = 0; n < count; n++)
            {
                _queued = 1; _nextRelease = 0f;
                Step(0f, 0f);
                _live[_live.Count - 1].age = _live[_live.Count - 1].life * (0.05f + 0.85f * n / Mathf.Max(1, count - 1));
            }
            Step(0f, 1000f);
        }

        void Update()
        {
            if (_font == null) { _queued = 0; return; }
            Step(Time.unscaledDeltaTime, Time.unscaledTime);
        }

        void Step(float dt, float now)
        {
            if (_queued > 0 && now >= _nextRelease && _live.Count < MaxLive)
            {
                _queued--;
                _nextRelease = now + 0.28f;
                var h = Take();
                h.c = Palette[Random.Range(0, Palette.Length)];
                h.age = 0f;
                h.life = Random.Range(2.0f, 2.6f);
                h.sway = Random.Range(0f, 6.28f);
                h.x = Random.Range(0.3f, 0.7f);
                h.r.localScale = Vector3.zero;
                _live.Add(h);
            }
            for (int n = _live.Count - 1; n >= 0; n--)
            {
                var h = _live[n];
                h.age += dt;
                float k = h.age / h.life;
                if (k >= 1f) { h.r.gameObject.SetActive(false); _free.Push(h); _live.RemoveAt(n); continue; }
                // Pop in with a small overshoot, rise with a gentle sway, fade over the last 40%.
                float pop = k < 0.08f ? Mathf.Lerp(0f, 1.18f, k / 0.08f) : k < 0.16f ? Mathf.Lerp(1.18f, 1f, (k - 0.08f) / 0.08f) : 1f;
                float ease = 1f - (1f - k) * (1f - k);
                h.r.anchorMin = h.r.anchorMax = new Vector2(h.x + Mathf.Sin(h.sway + h.age * 3.2f) * 0.18f * k, ease);
                h.r.anchoredPosition = Vector2.zero;
                h.r.localScale = Vector3.one * pop * Mathf.Lerp(1f, 0.8f, k);
                var c = h.c;
                c.a = 0.9f * (k > 0.6f ? Mathf.Lerp(1f, 0f, (k - 0.6f) / 0.4f) : 1f); // lower right, a little see-through: name tags pass behind
                h.t.color = c;
            }
            bool on = _live.Count > 0;
            if (_canvas.enabled != on) _canvas.enabled = on; // (selfie mirrors the lane to the left edge: hearts are symmetric)
        }

        void OnDestroy() { if (_i == this) _i = null; }
    }
}
