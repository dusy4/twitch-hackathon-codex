using UnityEngine;
using UnityEngine.UI;

namespace RaidRift
{
    /// <summary>
    /// A small "how to play" line that is part of the BROADCAST (the phone HUD is not): a Screen Space - Camera
    /// canvas on the AR camera, so it is drawn into the same texture the publisher sends to Twitch. Shown only
    /// while live. Sits in the upper part of the 9:16 stream crop, clear of the phone's top chips.
    /// </summary>
    public class StreamCaption : MonoBehaviour
    {
        Canvas _canvas;
        Camera _cam;
        RectTransform _pill;
        Text _text;
        CanvasGroup _group;
        bool _show;
        int _heroes = -1;

        public static StreamCaption Create(Camera cam)
        {
            var go = new GameObject("Stream caption", typeof(RectTransform));
            var c = go.AddComponent<StreamCaption>();
            c.Build(cam);
            return c;
        }

        void Build(Camera cam)
        {
            _cam = cam;
            _canvas = gameObject.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceCamera;
            _canvas.worldCamera = cam;
            _canvas.planeDistance = Mathf.Max(cam.nearClipPlane * 2f, 0.12f);
            var scaler = gameObject.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1080, 2340);
            scaler.matchWidthOrHeight = 0.5f;
            _group = gameObject.AddComponent<CanvasGroup>();
            _group.alpha = 0f;
            _group.interactable = _group.blocksRaycasts = false;

            var pill = new GameObject("Pill", typeof(RectTransform)).GetComponent<RectTransform>();
            pill.SetParent(transform, false);
            _pill = pill;
            pill.anchorMin = pill.anchorMax = new Vector2(0.5f, 0.84f);
            pill.pivot = new Vector2(0.5f, 0.5f);
            var bg = pill.gameObject.AddComponent<Image>();
            bg.color = new Color(0.05f, 0.03f, 0.1f, 0.55f);
            bg.raycastTarget = false;
            var fit = pill.gameObject.AddComponent<HorizontalLayoutGroup>();
            fit.padding = new RectOffset(34, 34, 14, 16);
            fit.childControlWidth = fit.childControlHeight = true;
            var size = pill.gameObject.AddComponent<ContentSizeFitter>();
            size.horizontalFit = size.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

            _text = new GameObject("Text", typeof(RectTransform)).AddComponent<Text>();
            _text.transform.SetParent(pill, false);
            _text.font = Resources.Load<Font>("Fonts/Inter-SemiBold") ?? Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _text.fontSize = 38;
            _text.alignment = TextAnchor.MiddleCenter;
            _text.supportRichText = true;
            _text.raycastTarget = false;
            _text.horizontalOverflow = HorizontalWrapMode.Overflow;
            var sh = _text.gameObject.AddComponent<Shadow>();
            sh.effectColor = new Color(0f, 0f, 0f, 0.7f);
            sh.effectDistance = new Vector2(2f, -2f);
            Set(0);
        }

        /// <summary>Called every frame by the app: live state and current hero count.</summary>
        public void Tick(bool live, int heroes)
        {
            _show = live;
            if (heroes != _heroes) Set(heroes);
            // Selfie: ARCore mirrors the front projection; un-mirror the caption so it reads on stream.
            if (_cam != null) _pill.localScale = new Vector3(_cam.projectionMatrix.m00 < 0f ? -1f : 1f, 1f, 1f);
            float target = _show ? 1f : 0f;
            _group.alpha = Mathf.MoveTowards(_group.alpha, target, Time.unscaledDeltaTime * 3f);
            if (_canvas.enabled != _group.alpha > 0.001f) _canvas.enabled = _group.alpha > 0.001f;
        }

        void Set(int heroes)
        {
            _heroes = heroes;
            // Nobody in yet: one clear call to action. Party present: the command menu.
            _text.text = heroes == 0
                ? "Type <color=#92ffe0>!join</color> in chat to drop in a hero"
                : "<color=#92ffe0>!join</color>  ·  !wave  ·  !jump  ·  !dance  ·  <color=#c79bff>!rift go to 3</color>";
        }
    }
}
