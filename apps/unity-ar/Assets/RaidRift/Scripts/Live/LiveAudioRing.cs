using System;
using System.Threading;

namespace RaidRift
{
    /// <summary>Single audio producer / main-thread consumer. Stereo frame indices,
    /// release/acquire publication; overflow drops new frames without blocking audio.</summary>
    public sealed class LiveAudioRing
    {
        readonly float[] _samples;
        readonly int _mask;
        long _write, _read;
        public LiveAudioRing(int capacityFrames = 8192)
        {
            if (capacityFrames < 2 || (capacityFrames & (capacityFrames - 1)) != 0)
                throw new ArgumentException("Capacity must be a power of two");
            _samples = new float[capacityFrames * 2]; _mask = capacityFrames - 1;
        }
        public int Available => (int)(Volatile.Read(ref _write) - Volatile.Read(ref _read));
        public bool Write(float left, float right)
        {
            long w = _write;
            if (w - Volatile.Read(ref _read) >= _mask + 1) return false;
            int index = ((int)w & _mask) * 2;
            _samples[index] = left; _samples[index + 1] = right;
            Volatile.Write(ref _write, w + 1);
            return true;
        }
        public bool Read(out float left, out float right)
        {
            long r = _read;
            if (r == Volatile.Read(ref _write)) { left = right = 0; return false; }
            int index = ((int)r & _mask) * 2;
            left = _samples[index]; right = _samples[index + 1];
            Volatile.Write(ref _read, r + 1);
            return true;
        }
        public void Trim(int keepFrames)
        {
            long w = Volatile.Read(ref _write), r = _read;
            if (w - r > keepFrames) Volatile.Write(ref _read, w - Math.Max(0, keepFrames));
        }
    }

    /// <summary>Allocation-free streaming linear resampler. State belongs to audio thread.</summary>
    public sealed class LiveAudioResampler
    {
        long _index;
        double _next;
        float _previousLeft, _previousRight;
        int _rate;
        public void Push(float[] samples, int channels, int sampleRate, LiveAudioRing sink)
        {
            if (channels < 1 || sampleRate < 1) return;
            if (_rate != sampleRate) { _rate = sampleRate; _index = 0; _next = 0; }
            double step = sampleRate / 48000.0;
            for (int i = 0; i + channels <= samples.Length; i += channels, _index++)
            {
                float left = samples[i], right = channels > 1 ? samples[i + 1] : left;
                if (_index > 0)
                {
                    while (_next <= _index)
                    {
                        float t = (float)(_next - (_index - 1));
                        sink.Write(_previousLeft + (left - _previousLeft) * t,
                            _previousRight + (right - _previousRight) * t);
                        _next += step;
                    }
                }
                _previousLeft = left; _previousRight = right;
            }
        }
    }
}
