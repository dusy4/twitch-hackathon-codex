// Contact shadow under each hero (the classic AR grounding trick): soft dark ellipse on the real floor.
// _Strength fades it while the hero is in the air.
Shader "RaidRift/BlobShadow"
{
    Properties { _Strength ("Strength", Range(0, 1)) = 0.55 }
    SubShader
    {
        Tags { "Queue" = "Transparent-20" "RenderType" = "Transparent" }
        Pass
        {
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Offset -2, -2
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"
            UNITY_INSTANCING_BUFFER_START(Props)
                UNITY_DEFINE_INSTANCED_PROP(float, _Strength)
            UNITY_INSTANCING_BUFFER_END(Props)
            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID UNITY_VERTEX_OUTPUT_STEREO };
            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                float r = length(i.uv - 0.5) * 2;
                float a = saturate(1 - r);
                a = a * a * (3 - 2 * a);
                return fixed4(0.05, 0.02, 0.08, a * UNITY_ACCESS_INSTANCED_PROP(Props, _Strength));
            }
            ENDCG
        }
    }
}
