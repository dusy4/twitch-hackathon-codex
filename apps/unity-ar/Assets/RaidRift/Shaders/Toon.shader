// Small lit shader for portal blocks, crystals and the shrine: wrapped diffuse from the scene's
// directional light, rim light and emission. Avoids Standard-shader keyword stripping surprises.
Shader "RaidRift/Toon"
{
    Properties
    {
        _Color ("Colour", Color) = (0.2, 0.12, 0.3, 1)
        _Emission ("Emission", Color) = (0, 0, 0, 1)
        _Rim ("Rim", Color) = (0.7, 0.5, 1, 1)
    }
    SubShader
    {
        Tags { "Queue" = "Geometry" "RenderType" = "Opaque" }
        Pass
        {
            Tags { "LightMode" = "ForwardBase" }
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            fixed4 _Color, _Emission, _Rim;
            struct appdata { float4 vertex : POSITION; float3 normal : NORMAL; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float3 normal : TEXCOORD0; float3 view : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };
            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.normal = UnityObjectToWorldNormal(v.normal);
                o.view = normalize(WorldSpaceViewDir(v.vertex));
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float3 n = normalize(i.normal);
                float3 l = normalize(_WorldSpaceLightPos0.xyz + float3(0, 0.001, 0));
                float diffuse = saturate(dot(n, l)) * 0.6 + 0.45;
                float rim = pow(1.0 - saturate(dot(n, normalize(i.view))), 3.0);
                return fixed4(_Color.rgb * diffuse + _Rim.rgb * rim * 0.6 + _Emission.rgb, 1);
            }
            ENDCG
        }
    }
}
