// Rift world voxels: vertex colours, simple key/fill light, vertex alpha < 1 = emissive (crystals).
Shader "RaidRift/VoxelLit"
{
    SubShader
    {
        Tags { "Queue" = "Geometry" "RenderType" = "Opaque" }
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            struct appdata { float4 vertex : POSITION; float3 normal : NORMAL; float4 color : COLOR; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float3 normal : TEXCOORD0; float4 color : COLOR; float fog : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };
            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.normal = UnityObjectToWorldNormal(v.normal);
                o.color = v.color;
                float dist = length(WorldSpaceViewDir(v.vertex));
                o.fog = saturate((dist - 5.0) / 14.0);
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float3 n = normalize(i.normal);
                float key = saturate(dot(n, normalize(float3(0.4, 0.85, -0.35))));
                float fill = saturate(dot(n, normalize(float3(-0.5, 0.3, 0.6)))) * 0.25;
                float3 lit = i.color.rgb * (0.38 + key * 0.75 + fill);
                float glow = 1 - i.color.a;
                float3 col = lerp(lit, i.color.rgb * 1.5, glow);
                col = lerp(col, float3(0.62, 0.5, 0.88), i.fog * 0.45 * (1 - glow));
                return fixed4(col, 1);
            }
            ENDCG
        }
    }
}
