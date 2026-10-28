// RaidRift Twitch EventSub bridge (prototype): Node 22+, npm install, node bridge.mjs
// Never send OAuth tokens to the browser. Broadcast only public raid/chat events.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8080);
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const USER_TOKEN = process.env.TWITCH_USER_TOKEN;
const BROADCASTER_ID = process.env.TWITCH_BROADCASTER_ID;
const hasTwitch = !!(CLIENT_ID && USER_TOKEN && BROADCASTER_ID);
const WSS = new WebSocketServer({ noServer: true });
let live = false;
const clientList = new Set();
const recentMessages = new Set();
const commandCooldown = new Map();

function send(client, data){if(client.readyState === WebSocket.OPEN)client.send(JSON.stringify(data));}
function broadcast(data){for(const client of clientList)send(client,data);}
function setLive(isLive){live = isLive;broadcast({type:'status',connected:live,configured:hasTwitch});}

const server = createServer(async(req,res)=>{
  const reqPath = (new URL(req.url,`http://${HOST}:${PORT}`)).pathname;
  if (!['/','/index.html'].includes(reqPath)) { res.writeHead(404);return res.end('not found'); }
  const html = await readFile(join(ROOT,'index.html'));
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(html);
});
server.on('upgrade',(req,socket,head)=>{
  if(new URL(req.url,`http://${HOST}:${PORT}`).pathname !== '/events')return socket.destroy();
  WSS.handleUpgrade(req,socket,head,ws=>WSS.emit('connection',ws,req));
});
WSS.on('connection',ws=>{clientList.add(ws);send(ws,{type:'status',connected:live,configured:hasTwitch});ws.on('close',()=>clientList.delete(ws));});
server.listen(PORT,HOST,()=>{console.log(`RaidRift overlay: http://${HOST}:${PORT}/`);console.log(`OBS transparent scene: http://${HOST}:${PORT}/?overlay=1`);console.log(hasTwitch?'Twitch credentials configured; connecting EventSub':'DEMO ONLY: set TWITCH_* env to enable live events');});

async function validateToken(){
 const res=await fetch('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:`OAuth ${USER_TOKEN}`}});
 if(!res.ok)throw new Error(`Twitch token invalid: HTTP ${res.status}`);
 const body=await res.json();
 if(body.client_id !== CLIENT_ID)throw new Error('Token client_id mismatch');
 if(!body.scopes?.includes('user:read:chat'))throw new Error('Token requires user:read:chat scope');
 return body.user_id;
}
async function subscribe(sessionId,type,condition){
 const response=await fetch('https://api.twitch.tv/helix/eventsub/subscriptions',{
  method:'POST',headers:{'Authorization':`Bearer ${USER_TOKEN}`,'Client-Id':CLIENT_ID,'Content-Type':'application/json'},
  body:JSON.stringify({type,version:'1',condition,transport:{method:'websocket',session_id:sessionId}})
 });
 if(!response.ok)throw new Error(`Subscription ${type}: HTTP ${response.status} ${await response.text()}`);
 console.log('Subscribed to',type);
}
async function runTwitch(){
 if(!hasTwitch)return;
 let userId;
 try{userId=await validateToken()}catch(e){console.error(e.message);return}
 const connect=(url='wss://eventsub.wss.twitch.tv/ws',resuming=false)=>{
  let handoff=false;
  const tws=new WebSocket(url);
  tws.on('message',async raw=>{
   try{
    const {metadata,payload}=JSON.parse(String(raw));
    if(metadata.message_type==='session_welcome'){
     if(!resuming){
       await subscribe(payload.session.id,'channel.raid',{to_broadcaster_user_id:BROADCASTER_ID});
       await subscribe(payload.session.id,'channel.chat.message',{broadcaster_user_id:BROADCASTER_ID,user_id:userId});
     }
     setLive(true);
    } else if(metadata.message_type==='session_notification'){
     if(recentMessages.has(metadata.message_id))return;
     recentMessages.add(metadata.message_id);setTimeout(()=>recentMessages.delete(metadata.message_id),60_000);
     const event=payload.event||{};
     if(metadata.subscription_type==='channel.raid'){
       broadcast({type:'raid',count:event.viewers||0,from:event.from_broadcaster_user_name||'Unknown',to:event.to_broadcaster_user_name||''});
       console.log('Raid received:',event.viewers,'from',event.from_broadcaster_user_name);
     }
     if(metadata.subscription_type==='channel.chat.message'){
       const cmd=(event.message?.text||'').trim();
       if(!/^!(join|left|right|jump|wave|dance|follow)(\s|$)/i.test(cmd))return;
       const uid=event.chatter_user_id,now=Date.now();
       if(now-(commandCooldown.get(uid)||0)<400)return;
       commandCooldown.set(uid,now);
       broadcast({type:'chat',text:cmd,user_id:uid,name:event.chatter_user_name||event.chatter_user_login||uid});
     }
    }else if(metadata.message_type==='session_reconnect'){
      const next=payload.session.reconnect_url;
      if(next){console.log('Twitch requested session handoff');handoff=true;connect(next,true);tws.close()}
    }
   }catch(e){console.error('Twitch event handler:',e.message)}
  });
  tws.on('error',e=>console.error('EventSub socket:',e.message));
  tws.on('close',()=>{if(handoff)return;setLive(false);setTimeout(()=>connect(),3000)});
 };
 connect();
}
await runTwitch();
