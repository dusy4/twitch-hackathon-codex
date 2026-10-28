import {createApp} from '../apps/api/server.js';
import {Database} from '../apps/api/db.js';
import {Security} from '../apps/api/security.js';
const {app}=await createApp({db:Database.memory(),security:new Security(Buffer.alloc(32,21)),demo:true,origin:'http://127.0.0.1:3401'});
await app.listen({host:'127.0.0.1',port:3401});
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>void app.close().then(()=>process.exit(0)));
