// "The game paints over reality": the scanned room mesh near the rift becomes Rift terrain (voxel moss on
// tops, stone bricks on sides) with a soft spreading edge and a glowing front. Driven by globals set by
// RiftWorld: _RiftCenter (xyz, w unused) and _RiftRadius (0 = invisible).
Shader "RaidRift/RiftPaint"
{
    SubShader
    {
        Tags { "Queue" = "Transparent-5" "RenderType" = "Transparent" }
        Pass
        {
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Offset -1, -1
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float4 _RiftCenter;
            float _RiftRadius;
            struct appdata { float4 vertex : POSITION; float3 normal : NORMAL; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float3 world : TEXCOORD0; float3 normal : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };
            float hash(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.world = mul(unity_ObjectToWorld, v.vertex).xyz;
                o.normal = UnityObjectToWorldNormal(v.normal);
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                if (_RiftRadius <= 0.001) discard;
                float3 w = i.world;
                float d = distance(w.xz, _RiftCenter.xz) + (hash(floor(w.xz * 6)) - 0.5) * 0.12;
                float reach = _RiftRadius;
                float a = 1 - smoothstep(reach * 0.6, reach, d);
                a *= 1 - smoothstep(0.7, 1.1, w.y - _RiftCenter.y);
                float up = saturate(abs(normalize(i.normal).y) * 1.5 - 0.5);
                float2 cell = floor(w.xz * 10);
                float h = hash(cell);
                float3 moss = lerp(float3(0.36, 0.17, 0.52), float3(0.22, 0.62, 0.56), step(0.9, h)) * (0.7 + 0.4 * h);
                float2 g = abs(frac(w.xz * 10) - 0.5);
                moss *= 0.85 + 0.15 * step(0.45, max(g.x, g.y));
                float brick = hash(floor(float2(w.x * 8 + w.z * 8 + floor(w.y * 12) * 0.5, w.y * 12)));
                float3 stone = float3(0.2, 0.14, 0.28) * (0.8 + 0.4 * brick);
                float3 col = lerp(stone, moss, up);
                float lowEnough = 1 - smoothstep(0.7, 1.1, w.y - _RiftCenter.y);
                float front = smoothstep(reach - 0.14, reach - 0.03, d) * (1 - smoothstep(reach - 0.03, reach + 0.04, d)) * lowEnough;
                // The glowing front sells the spread; once the paint stops (reach ~1.3 m) it fades out, and it only
                // runs over flat surfaces — on a noisy bed/wall mesh it smeared into mint bands (great.mp4).
                front *= (1 - smoothstep(0.85, 1.25, reach)) * up;
                col += float3(0.5, 1.0, 0.85) * front * 1.2;
                float sparkle = step(0.995, hash(floor(w.xz * 40) + floor(_Time.y * 3))) * a;
                col += sparkle;
                // Fades toward the edge so the real room shows through: painted, not replaced.
                float density = 0.55 + 0.3 * (1 - smoothstep(0, reach * 0.7, d));
                return fixed4(col, saturate(a * density + front * 0.8));
            }
            ENDCG
        }
    }
}
