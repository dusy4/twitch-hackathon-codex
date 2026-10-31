// Camera feel for the composited AR image (camera background + characters), applied in OnRenderImage so the
// phone screen AND the Twitch stream both get it, while the tracked camera pose stays untouched.
// Pass 0: bloom prefilter + 4-tap downsample. Pass 1: 4-tap downsample. Pass 2: tent upsample (blend One One).
// Pass 3: final: shake/zoom-punch UV transform, radial chromatic aberration, bloom, flash, vignette.
Shader "RaidRift/CameraFeel"
{
    Properties { _MainTex ("Source", 2D) = "black" {} }
    CGINCLUDE
    #include "UnityCG.cginc"
    sampler2D _MainTex; float4 _MainTex_TexelSize;
    sampler2D _BloomTex;
    float4 _Threshold;      // x threshold, y knee, z clamp
    float _BloomIntensity;
    float4 _Shake;          // xy offset (uv), z angle (rad), w zoom (>= 1)
    float _Aspect;
    float _Chroma;          // radial RGB split, uv units at the edge
    float4 _FlashColor;     // rgb, a = amount
    float _Vignette;        // 0..1 extra darkening/tint at the edges
    float4 _VignetteColor;

    struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; };
    v2f vert (appdata_img v) { v2f o; o.pos = UnityObjectToClipPos(v.vertex); o.uv = v.texcoord; return o; }

    half3 Box4(float2 uv, float2 t)
    {
        half3 c = tex2D(_MainTex, uv + t * float2(-1, -1)).rgb + tex2D(_MainTex, uv + t * float2(1, -1)).rgb
                + tex2D(_MainTex, uv + t * float2(-1, 1)).rgb + tex2D(_MainTex, uv + t * float2(1, 1)).rgb;
        return c * 0.25;
    }

    half4 FragPrefilter (v2f i) : SV_Target
    {
        half3 c = min(Box4(i.uv, _MainTex_TexelSize.xy), _Threshold.zzz);
        half br = max(c.r, max(c.g, c.b));
        half soft = clamp(br - _Threshold.x + _Threshold.y, 0, 2 * _Threshold.y);
        soft = soft * soft / (4 * _Threshold.y + 1e-4);
        half contrib = max(soft, br - _Threshold.x) / max(br, 1e-4);
        return half4(c * contrib, 1);
    }

    half4 FragDown (v2f i) : SV_Target { return half4(Box4(i.uv, _MainTex_TexelSize.xy), 1); }

    half4 FragUp (v2f i) : SV_Target
    {
        float2 t = _MainTex_TexelSize.xy;
        half3 c = tex2D(_MainTex, i.uv + t * float2(-1, -1)).rgb + tex2D(_MainTex, i.uv + t * float2(1, -1)).rgb
                + tex2D(_MainTex, i.uv + t * float2(-1, 1)).rgb + tex2D(_MainTex, i.uv + t * float2(1, 1)).rgb
                + 2 * (tex2D(_MainTex, i.uv + t * float2(0, -1)).rgb + tex2D(_MainTex, i.uv + t * float2(0, 1)).rgb
                     + tex2D(_MainTex, i.uv + t * float2(-1, 0)).rgb + tex2D(_MainTex, i.uv + t * float2(1, 0)).rgb)
                + 4 * tex2D(_MainTex, i.uv).rgb;
        return half4(c / 16, 1);
    }

    float2 ShakeUV(float2 uv)
    {
        float2 p = (uv - 0.5) / _Shake.w;          // zoom in (punch + margin that hides shake edges)
        p.x *= _Aspect;                              // rotate in square space
        float s, c; sincos(_Shake.z, s, c);
        p = float2(c * p.x - s * p.y, s * p.x + c * p.y);
        p.x /= _Aspect;
        return p + 0.5 + _Shake.xy;
    }

    half4 FragFinal (v2f i) : SV_Target
    {
        float2 uv = ShakeUV(i.uv);
        float2 d = uv - 0.5;
        float edge = dot(d, d) * 4;                  // 0 centre .. ~2 corners
        float2 ca = d * _Chroma * edge;
        half3 col;
        col.r = tex2D(_MainTex, uv + ca).r;
        col.g = tex2D(_MainTex, uv).g;
        col.b = tex2D(_MainTex, uv - ca).b;
        col += tex2D(_BloomTex, uv).rgb * _BloomIntensity;
        col = lerp(col, _FlashColor.rgb, saturate(_FlashColor.a));
        float v = smoothstep(0.35, 1.6, edge) * _Vignette;
        col = lerp(col, _VignetteColor.rgb, saturate(v));
        return half4(col, 1);
    }
    ENDCG

    SubShader
    {
        Cull Off ZWrite Off ZTest Always
        Pass { CGPROGRAM
            #pragma vertex vert
            #pragma fragment FragPrefilter
            ENDCG }
        Pass { CGPROGRAM
            #pragma vertex vert
            #pragma fragment FragDown
            ENDCG }
        Pass { Blend One One
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment FragUp
            ENDCG }
        Pass { CGPROGRAM
            #pragma vertex vert
            #pragma fragment FragFinal
            ENDCG }
    }
}
