// Scan feedback: a faint world-space grid over the measured room. Horizontal surfaces tint with
// _Color, walls/furniture sides with _SideColor, so the streamer sees what the phone has measured.
Shader "RaidRift/ScanMesh"
{
    Properties
    {
        _Color ("Top colour", Color) = (0.62, 0.45, 1, 0.30)
        _SideColor ("Side colour", Color) = (1, 0.45, 0.65, 0.30)
        _Grid ("Grid cells per metre", Float) = 10
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" }
        Pass
        {
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            fixed4 _Color, _SideColor;
            float _Grid;
            struct appdata { float4 vertex : POSITION; float3 normal : NORMAL; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float3 world : TEXCOORD0; float3 normal : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };
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
                float3 g = abs(frac(i.world * _Grid) - 0.5);
                float gridLine = saturate((0.06 - min(min(g.x, g.y), g.z)) * 30.0);
                float up = saturate(abs(normalize(i.normal).y) * 1.4 - 0.4);
                fixed4 c = lerp(_SideColor, _Color, up);
                // Mostly grid lines with a faint fill, so the room stays readable while scanning.
                c.a *= 0.15 + 0.85 * gridLine;
                return c;
            }
            ENDCG
        }
    }
}
