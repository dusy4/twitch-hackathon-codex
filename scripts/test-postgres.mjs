import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
const bin=resolve('.tools/postgres/pgsql/bin'),data=resolve('.data/native-postgres');
if(!existsSync(`${bin}/initdb.exe`))throw Error('Download and extract the official EDB PostgreSQL archive to .tools/postgres first');
async function run(program,args,extra={}){return new Promise((resolve,reject)=>{const child=spawn(program,args,{stdio:'inherit',windowsHide:true,...extra});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${program} exited ${code}`)));});}
await mkdir('.data',{recursive:true});let password;try{password=await readFile('.data/native-pg-password','utf8');}catch{password=randomBytes(24).toString('base64url');await writeFile('.data/native-pg-password',password,{mode:0o600});}
if(!existsSync(`${data}/PG_VERSION`))await run(`${bin}/initdb.exe`,['-D',data,'-U','raidrift_test','-A','scram-sha-256','--pwfile',resolve('.data/native-pg-password'),'-E','UTF8','--locale=C']);
let started=false;try{await run(`${bin}/pg_ctl.exe`,['-D',data,'-l',resolve('.data/native-postgres.log'),'-o','-p 55432 -h 127.0.0.1','-w','start']);started=true;const dburl=`postgresql://raidrift_test:${encodeURIComponent(password)}@127.0.0.1:55432/postgres`;await run(process.execPath,['--import','tsx','tests/postgres.test.ts'],{env:{...process.env,TEST_DATABASE_URL:dburl}});await run(process.execPath,['--import','tsx','scripts/restore-drill.ts'],{env:{...process.env,TEST_DATABASE_URL:dburl}});await writeFile('artifacts/native-postgres.json',JSON.stringify({runAt:new Date().toISOString(),result:'passed',port:55432,scope:'Native local PostgreSQL; independent pg connections; 100 duplicate credits, concurrent spending/equipment, rollback; isolated synthetic dump/restore',distribution:JSON.parse(await readFile('.tools/postgres-provenance.json','utf8'))},null,2));}finally{if(started)await run(`${bin}/pg_ctl.exe`,['-D',data,'-m','fast','-w','stop']);}
