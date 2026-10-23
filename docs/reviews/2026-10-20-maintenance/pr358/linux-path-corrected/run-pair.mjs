import {spawnSync} from 'node:child_process';
import {openSync,closeSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
const root='/work';mkdirSync(root,{recursive:true});
process.env.npm_config_cache=root+'/npm-cache';
process.env.PATH='/tooling/node_modules/.bin:'+process.env.PATH;
const result={schemaVersion:1,environment:{node:process.version,pnpm:'10.30.3',platform:process.platform,arch:process.arch,kernel:os.release(),cpuCount:os.cpus().length,availableParallelism:os.availableParallelism(),image:'node:24.19.0-bookworm',imageDigest:'sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b'},policy:{focusedRunsPerTree:0,fullRunsPerTree:1,priorAttempt:'both full checks stopped before tests because pnpm was absent from PATH; retained in parent evidence directory',concurrencyOverrides:[],timeoutOverrides:[],productionChanges:false,rerunUntilGreen:false},runs:[]};
function run(label,exe,args,cwd){const filename='/evidence/'+label+'.log';const fd=openSync(filename,'w');const start=Date.now();let r;try{r=spawnSync(exe,args,{cwd,env:process.env,stdio:['ignore',fd,fd],timeout:1200000});}finally{closeSync(fd);}
const data=readFileSync(filename);const item={label,command:[exe,...args],exitCode:r.status,signal:r.signal,durationSeconds:(Date.now()-start)/1000,log:label+'.log',sha256:createHash('sha256').update(data).digest('hex'),summary:data.toString().split('\n').filter(x=>/Test Files|Tests |Tests:|FAIL |timed out waiting|ENOTEMPTY|Error:/.test(x)).slice(-15)};if(r.error)item.processError=r.error.code;result.runs.push(item);writeFileSync('/evidence/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(item));return r.status===0;}
if(!run('setup-pnpm','npm',['install','--prefix','/tooling','pnpm@10.30.3','--ignore-scripts','--no-audit','--no-fund'],root))process.exit(1);
const pnpm='/tooling/node_modules/.bin/pnpm';
const sources=[['main','e5579b71339ba932dec7dfba497fc97df8fbf124'],['candidate','eec7c892f5dfba21009bcaa71db8f626cbbfa9df']];
let ready=true;
for(const [name,commit] of sources){const cwd=root+'/'+name;mkdirSync(cwd,{recursive:true});if(!run(name+'-extract','tar',['-xf','/evidence/'+name+'.tar','-C',cwd],root)){ready=false;continue;}
const hashes={};for(const path of ['pnpm-lock.yaml','vitest.config.ts','src/adaptive-task-store.ts','tests/adaptive-task-store.spec.ts'])hashes[path]=createHash('sha256').update(readFileSync(cwd+'/'+path)).digest('hex');
result[name]={commit,sourceSha256:hashes};
if(!run(name+'-install',pnpm,['install','--frozen-lockfile','--ignore-scripts'],cwd))ready=false;}
if(!ready){result.blocked='dependency preparation failed; no test comparison attempted';writeFileSync('/evidence/result.json',JSON.stringify(result,null,2)+'\n');process.exit(1);}
for(const [name] of sources){run(name+'-full-check',pnpm,['run','check'],root+'/'+name);}
result.completed=true;writeFileSync('/evidence/result.json',JSON.stringify(result,null,2)+'\n');process.exitCode=result.runs.every(x=>x.exitCode===0)?0:1;