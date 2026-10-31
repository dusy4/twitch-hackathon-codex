// Invisible occluder for the scanned room mesh: writes depth, no colour. Drawn after the AR camera
// background (which Unity renders first) and before heroes, so a hero behind the bed is hidden and
// the camera image is never covered.
Shader "RaidRift/DepthOnly"
{
    SubShader
    {
        Tags { "Queue" = "Geometry-10" "RenderType" = "Opaque" }
        Pass
        {
            ZWrite On
            ColorMask 0
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; UNITY_VERTEX_OUTPUT_STEREO };
            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                // A tiny push away from the camera so noisy floor triangles never cut off a hero's feet.
                float4 p = UnityObjectToClipPos(v.vertex);
                #if defined(UNITY_REVERSED_Z)
                p.z -= 0.0005 * p.w;
                #else
                p.z += 0.0005 * p.w;
                #endif
                o.pos = p;
                return o;
            }
            fixed4 frag (v2f i) : SV_Target { return 0; }
            ENDCG
        }
    }
}
