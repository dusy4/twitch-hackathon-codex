using UnityEngine;

namespace RaidRift
{
    public partial class Hero
    {
        public bool SelfiePerched { get; private set; }
        public float DisplayHeight => Height * (SelfiePerched ? transform.localScale.y : 1f);
        Vector3 _worldScale;

        public void SetSelfiePerch(Vector3 position, Quaternion rotation, float scale)
        {
            string pendingPose = null;
            if (!SelfiePerched)
            {
                _worldScale = transform.localScale;
                Halt();
                Agent.enabled = false;
                Entering = false;
                _linkJump = false;
                pendingPose = _pendingPose;
                _pendingPose = null;
                _rift = null;
                Waiting = false;
                SetLayer(0);
                SelfiePerched = true;
            }
            Spawned = true;
            transform.localScale = Vector3.one * scale;
            transform.SetPositionAndRotation(position, rotation);
            if (pendingPose != null) Apply(pendingPose, true);
            if (_shadow != null) _shadow.gameObject.SetActive(false);
        }

        /// <summary>Return through Place on scanned floor; never Recover from a selfie head position.</summary>
        public void LeaveSelfie()
        {
            if (!SelfiePerched) return;
            SelfiePerched = false;
            transform.localScale = _worldScale;
            Spawned = false;
            Agent.enabled = false;
            _destination = null;
            _linkJump = false;
            _pendingPose = null;
            _airborne = false;
            _jumpStart = -10f;
            _visual.localPosition = Vector3.zero;
            _visual.gameObject.SetActive(false);
        }
    }
}
