using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace RaidRift
{
    /// <summary>Lights the characters like the real room: ARCore's environmental light estimate drives the
    /// sun's direction, colour and intensity and the ambient spherical harmonics. A dark room gets dark
    /// heroes; a window on the left lights them from the left.</summary>
    [RequireComponent(typeof(Light))]
    public class LightMatch : MonoBehaviour
    {
        public ARCameraManager cameraManager;
        Light _light;
        /// <summary>Smoothed scene brightness from the AR light estimate (0 dim … 1 sunny street).</summary>
        public static float Brightness01 { get; private set; }

        void Awake()
        {
            _light = GetComponent<Light>();
            if (cameraManager != null)
                cameraManager.requestedLightEstimation = LightEstimation.MainLightDirection | LightEstimation.MainLightIntensity |
                                                         LightEstimation.AmbientSphericalHarmonics | LightEstimation.AmbientIntensity;
        }

        void OnEnable() { if (cameraManager != null) cameraManager.frameReceived += OnFrame; }
        void OnDisable() { if (cameraManager != null) cameraManager.frameReceived -= OnFrame; }

        void OnFrame(ARCameraFrameEventArgs args)
        {
            var e = args.lightEstimation;
            if (e.mainLightDirection.HasValue) _light.transform.rotation = Quaternion.LookRotation(e.mainLightDirection.Value);
            if (e.mainLightColor.HasValue) _light.color = e.mainLightColor.Value;
            if (e.mainLightIntensityLumens.HasValue) _light.intensity = Mathf.Clamp(e.mainLightIntensityLumens.Value / 1000f, 0.3f, 1.6f);
            else if (e.averageBrightness.HasValue) _light.intensity = Mathf.Clamp(e.averageBrightness.Value * 2f, 0.3f, 1.6f);
            // 0 = indoor/dim … 1 = bright daylight (intensity is clamped 0.3–1.6 above). CameraFeel tames bloom/flash.
            Brightness01 = Mathf.MoveTowards(Brightness01, Mathf.InverseLerp(0.8f, 1.6f, _light.intensity), 0.05f);
            if (e.ambientSphericalHarmonics.HasValue)
            {
                RenderSettings.ambientMode = AmbientMode.Skybox;
                RenderSettings.ambientProbe = e.ambientSphericalHarmonics.Value;
            }
        }
    }
}
