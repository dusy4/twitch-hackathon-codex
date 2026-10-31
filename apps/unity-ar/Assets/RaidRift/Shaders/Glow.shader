// Additive glow for trails, sparks, moths and puffs: colour = _Color * vertex colour, soft round falloff
// on quads (uv distance) so particles read as light, not squares.
Shader "RaidRift/Glow"
{
    Properties
    {
        _Color ("Colour", Color) = (0.6, 1, 0.9, 1)
        _Soft ("Round falloff (0 = off)", Float) = 1
    }
    SubShader
    {
        Tags { "Queue" = "Transparent+10" "RenderType" = "Transparent" }
        Pass
        {
            Blend SrcAlpha One
            ZWrite Off
            Cull Off
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            fixed4 _Color;
            float _Soft;
            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; UNITY_VERTEX_OUTPUT_STEREO };
            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                o.color = v.color;
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float r = length(i.uv - 0.5) * 2;
                float fall = lerp(1, saturate(1 - r * r), _Soft);
                fixed4 c = _Color * i.color;
                c.a *= fall;
                return c;
            }
            ENDCG
        }
    }
}
