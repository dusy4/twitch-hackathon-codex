using System.Threading;
using UnityEngine;

namespace RaidRift
{
    /// <summary>Attach to the active AudioListener, not an AudioSource. Does not alter monitoring.</summary>
    [DisallowMultipleComponent]
    public sealed class LiveAudioTap : MonoBehaviour
    {
        public LiveAudioRing Ring { get; } = new LiveAudioRing();
        readonly LiveAudioResampler _resampler = new LiveAudioResampler();
        int _sampleRate = 48000;
        void OnEnable()
        {
            _sampleRate = AudioSettings.outputSampleRate;
            AudioSettings.OnAudioConfigurationChanged += ConfigurationChanged;
        }
        void OnDisable() => AudioSettings.OnAudioConfigurationChanged -= ConfigurationChanged;
        void ConfigurationChanged(bool changed) => Volatile.Write(ref _sampleRate, AudioSettings.outputSampleRate);
        void OnAudioFilterRead(float[] data, int channels) =>
            _resampler.Push(data, channels, Volatile.Read(ref _sampleRate), Ring);
    }
}
