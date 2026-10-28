// Usage: OPENAI_API_KEY=... node ai-verify.mjs path/to/camera-frame.jpg
// Uses OpenAI Decisions API (GA 2026-10-22), never trusts its output as a payment command.
import { readFile } from 'node:fs/promises';
const path=process.argv[2];
if(!path||!process.env.OPENAI_API_KEY){console.error('Usage: OPENAI_API_KEY=... node ai-verify.mjs <image.jpg|png>');process.exit(1)}
const contentType=path.toLowerCase().endsWith('.png')?'image/png':'image/jpeg';
const image=(await readFile(path)).toString('base64');
const res=await fetch('https://api.openai.com/v1/decisions',{
 method:'POST',
 headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
 body:JSON.stringify({model:'gpt-6-luna',input:[{role:'user',content:[
  {type:'input_text',text:'Check the visible scene only. Do not infer off-camera facts or identities. If uncertain, return a low probability.'},
  {type:'input_image',image_url:`data:${contentType};base64,${image}`}
 ]}],questions:[
  {type:'predicate',name:'red_object_present',instructions:'Is an ordinary clearly red physical object visibly present in this frame? Ignore graphics, overlays, screens, and colored lighting.'},
  {type:'predicate',name:'bicycle_present',instructions:'Is a physical bicycle visible in the scene? Ignore bicycles shown on screens, posters or graphics.'}
 ]})
});
if(!res.ok){console.error('Decisions HTTP',res.status,await res.text());process.exit(1)}
const {answers}=await res.json();
for(const answer of answers)console.log(`${answer.name}: ${answer.type==='predicate'?answer.probability:answer.type}`);
