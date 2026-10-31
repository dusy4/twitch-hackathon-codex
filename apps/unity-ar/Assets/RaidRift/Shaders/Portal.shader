// Original raid-portal membrane: additive purple swirl fading at the edges.
Shader "RaidRift/Portal"
{
    Properties
    {
        _Color ("Colour", Color) = (0.62, 0.25, 1, 1)
        _Accent ("Accent", Color) = (0.55, 1, 0.9, 1)
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" }
        Pass
        {
            Blend SrcAlpha One
            ZWrite Off
            Cull Off
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            fixed4 _Color, _Accent;
            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };
            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float2 p = i.uv - 0.5;
                p.x *= 0.7;
                float r = length(p);
                float a = atan2(p.y, p.x);
                float swirl = sin(a * 5.0 + r * 22.0 - _Time.y * 3.0) * 0.5 + 0.5;
                float sparks = step(0.985, frac(sin(dot(floor(i.uv * 18.0 + float2(0, _Time.y * 2.0)), float2(12.9898, 78.233))) * 43758.5453));
                float glow = saturate(1.0 - r * 1.7);
                fixed3 col = lerp(_Color.rgb, _Accent.rgb, swirl * 0.25) * (0.45 + 0.9 * swirl) + sparks * _Accent.rgb;
                return fixed4(col, glow * 0.9);
            }
            ENDCG
        }
    }
}
