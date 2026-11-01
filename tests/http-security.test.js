// Codex: isolated HTTP regression checks; external APIs and trader startup are disabled.
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'toss-http-'));
const probe=net.createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r)); const port=probe.address().port; await new Promise(r=>probe.close(r));
const child=spawn(process.execPath,['--input-type=module','-e',`
import { Trader } from './src/trader.js';
Trader.prototype.start = function() {};
globalThis.fetch=async()=>{throw new Error('External API disabled by test');};
await import('./server.js');
`],{cwd:process.cwd(),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dir,LIVE_TRADING:'false',TOSS_CLIENT_ID:'',TOSS_CLIENT_SECRET:'',DASHBOARD_PASSWORD:'synthetic-test',TOSS_BASE_URL:'https://openapi.tossinvest.com'},stdio:['ignore','pipe','pipe']});
let errors='';child.stderr.on('data',s=>errors+=s);
try {
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout '+errors)),6000); child.stdout.on('data',s=>{if(s.toString().includes('running on')){clearTimeout(timer);resolve();}});child.on('exit',c=>{clearTimeout(timer);reject(new Error('Unexpected exit '+c+' '+errors));});});
 const base=`http://127.0.0.1:${port}`;
 const auth={Authorization:'Basic '+Buffer.from('user:synthetic-test').toString('base64')};
 let r=await fetch(base);assert.equal(r.status,401);
 r=await fetch(base,{headers:auth});assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(r.headers.get('cache-control'),'no-store');
 r=await fetch(base+'/safeUrl.js',{headers:auth});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);
 r=await fetch(base+'/api/engine/toggle',{method:'POST',headers:{...auth,Origin:'https://attacker.example','Content-Type':'application/json'},body:'{"enabled":true}'});assert.equal(r.status,403);
 r=await fetch(base+'/api/engine/toggle',{method:'POST',headers:{...auth,'Content-Type':'text/plain'},body:'{"enabled":true}'});assert.equal(r.status,415);
 r=await fetch(base+'/api/engine/toggle',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({padding:'x'.repeat(65537)})});assert.equal(r.status,413);
 r=await fetch(base+'/api/engine/toggle',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:'{"enabled":false}'});assert.equal(r.status,200);assert.equal((await r.json()).settings.monitoringEnabled,false);
 console.log('HTTP integration passed: auth, CSP, module asset, foreign Origin, content type, body limit, authorized API. External API and trader start disabled.');
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('close',r));await rm(dir,{recursive:true,force:true});}
