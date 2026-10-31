// Rift sky dome (inside of a sphere): deep violet zenith, pink/teal horizon, twinkling stars.
Shader "RaidRift/RiftSky"
{
    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Opaque" }
        Pass
        {
            ZWrite Off
            Cull Front
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float3 dir : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };
            float hash(float3 p) { return frac(sin(dot(p, float3(12.9898, 78.233, 37.719))) * 43758.5453); }
            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.dir = normalize(v.vertex.xyz);
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float y = i.dir.y;
                float3 zenith = float3(0.12, 0.05, 0.28);
                float3 horizon = lerp(float3(0.95, 0.45, 0.75), float3(0.45, 0.95, 0.9), saturate(i.dir.x * 0.5 + 0.5));
                float3 col = lerp(horizon, zenith, saturate(pow(saturate(y + 0.05), 0.55)));
                float3 cell = floor(i.dir * 140);
                float star = step(0.993, hash(cell)) * saturate(y * 3);
                star *= 0.6 + 0.4 * sin(_Time.y * 3 + hash(cell + 1) * 30);
                return fixed4(col + star, 1);
            }
            ENDCG
        }
    }
}
