Shader "Hidden/RaidRift/LiveNv12"
{
    Properties { _MainTex ("Clean camera", 2D) = "black" {} }
    SubShader
    {
        Cull Off ZWrite Off ZTest Always
        Pass
        {
            CGPROGRAM
            #pragma vertex vert_img
            #pragma fragment frag
            #pragma target 3.0
            #include "UnityCG.cginc"
            sampler2D _MainTex;
            float4 _MainTex_TexelSize;
            float4 _Size; // video width, video height, packed width, packed height
            float4 _Crop; // scale.xy, offset.xy (centre crop)
            float _FlipY;

            float3 rgb(float x, float y)
            {
                // Memory row 0 is the TOP of the encoded image. GLES texture UV
                // row 0 is bottom; invert exactly once here, never mirror X.
                float2 uv = float2((x + 0.5) / _Size.x, 1 - (y + 0.5) / _Size.y);
                uv = uv * _Crop.xy + _Crop.zw;
                #if UNITY_UV_STARTS_AT_TOP
                if (_MainTex_TexelSize.y < 0) uv.y = 1 - uv.y;
                #endif
                if (_FlipY > 0.5) uv.y = 1 - uv.y;
                float3 c = tex2Dlod(_MainTex, float4(uv, 0, 0)).rgb;
                #ifndef UNITY_COLORSPACE_GAMMA
                c = LinearToGammaSpace(c);
                #endif
                return saturate(c);
            }
            float component(float index)
            {
                float luma = _Size.x * _Size.y;
                if (index < luma)
                {
                    float y = floor(index / _Size.x), x = index - y * _Size.x;
                    return 16.0/255 + dot(rgb(x, y), float3(0.2126, 0.7152, 0.0722)) * (219.0/255);
                }
                float chroma = index - luma;
                float row = floor(chroma / _Size.x);
                float column = chroma - row * _Size.x;
                float x = floor(column / 2) * 2, y = row * 2;
                float3 c = (rgb(x,y) + rgb(x+1,y) + rgb(x,y+1) + rgb(x+1,y+1)) * 0.25;
                float u = dot(c, float3(-0.114572, -0.385428, 0.5));
                float v = dot(c, float3(0.5, -0.454153, -0.045847));
                return 128.0/255 + (fmod(column, 2) < 1 ? u : v) * (224.0/255);
            }
            float4 frag(v2f_img i) : SV_Target
            {
                // SV_POSITION follows the native readback row order on GLES
                // and D3D. Four adjacent bytes occupy one linear RGBA8 pixel.
                float index = (floor(i.pos.y) * _Size.z + floor(i.pos.x)) * 4;
                return float4(component(index), component(index+1), component(index+2), component(index+3));
            }
            ENDCG
        }
    }
}
