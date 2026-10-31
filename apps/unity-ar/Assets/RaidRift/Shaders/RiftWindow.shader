// The rift "window" (reference: Lucas Martinic's Mario 64 MR prototype): a soft-edged opening in the room
// showing the Rift world, which a second camera renders from the phone's exact pose into _RiftTex. Sampling
// it in screen space gives real parallax. Wobbling feathered edge + violet rim.
Shader "RaidRift/RiftWindow"
{
    Properties
    {
        _RiftTex ("Rift view", 2D) = "black" {}
        _Rim ("Rim", Color) = (0.78, 0.5, 1, 1)
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
            sampler2D _RiftTex;
            float4 _RiftTex_TexelSize;
            fixed4 _Rim;
            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; float4 screen : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };
            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.screen = ComputeScreenPos(o.pos);
                o.uv = v.uv;
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float2 suv = i.screen.xy / i.screen.w;
                #if UNITY_UV_STARTS_AT_TOP
                if (_RiftTex_TexelSize.y < 0) suv.y = 1 - suv.y;
                #endif
                fixed4 c = tex2D(_RiftTex, suv);
                float2 d = min(i.uv, 1 - i.uv);
                float edge = min(d.x * 1.3, d.y);
                float wobble = sin(i.uv.y * 23 + _Time.y * 2.1) * 0.012 + sin(i.uv.x * 17 - _Time.y * 1.7) * 0.012;
                edge += wobble;
                float inside = smoothstep(0.02, 0.16, edge);
                float rim = smoothstep(0.0, 0.04, edge) * (1 - smoothstep(0.04, 0.12, edge));
                fixed3 col = lerp(c.rgb, _Rim.rgb, rim * 0.85);
                return fixed4(col, saturate(max(inside, rim * 0.9)));
            }
            ENDCG
        }
    }
}
