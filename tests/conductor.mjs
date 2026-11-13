import{tooling}from'../tools/env.mjs';
import {spawn,spawnSync} from 'node:child_process';
import{mkdir,mkdtemp,readFile,writeFile}from'node:fs/promises';
import{createServer}from'node:net';import{join,resolve}from'node:path';import{randomBytes}from'node:crypto';
import{AdminWebsocket,AppWebsocket,CellType}from'@holochain/client';
export const root=resolve(import.meta.dirname,'..');
export async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
export async function retry(fn,timeout=30000){const stop=Date.now()+timeout;let last;while(Date.now()<stop){try{return await fn()}catch(e){last=e;await new Promise(r=>setTimeout(r,300))}}throw last}
export async function startConductor(networkSeed='rai-test-'+randomBytes(16).toString('hex'),{arc=1}={}){
  const base=join(root,'.tooling','test-runs');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'run-'));
  const exe=join(tooling,'bin/holochain.exe'),hc=join(tooling,'bin/hc.exe');
  const password=randomBytes(32).toString('hex');
  const init=spawnSync(hc,['sandbox','--piped','create','--root',dir,'--directories','conductor','--in-process-lair'],{cwd:dir,input:password,encoding:'utf8',windowsHide:true});
  if(init.status!==0)throw new Error('Conductor creation failed: '+init.stdout+' '+init.stderr);
  const configPath=join(dir,'conductor/conductor-config.yaml');
  let child,admin,appPort,output='';const clients=[];
  // Writes the config and starts the conductor; used again by `restart`.
  async function launch(arcFactor){
    const adminPort=await port();let config=await readFile(configPath,'utf8');
    config=config.replace(/port: \d+/,`port: ${adminPort}`);
    // Match the pinned desktop shell's relay; hc sandbox's historical default
    // points to a different public relay and is not the pilot configuration.
    config=config.replace(/relay_url: .*/, 'relay_url: https://dev-test-bootstrap2.holochain.org/');
    // 0.4: light clients (arc 0) keep no copy of other members' records.
    config=config.replace(/target_arc_factor: \d+/,'target_arc_factor: '+arcFactor);
    await writeFile(configPath,config);
    child=spawn(exe,['--config-path',configPath,'--piped'],{cwd:dir,env:{...process.env,RUST_LOG:'error'},stdio:['pipe','pipe','pipe'],windowsHide:true});
    child.stdin.end(password);child.stdout.on('data',d=>{output+=d.toString()});child.stderr.on('data',d=>{output+=d.toString()});
    try{admin=await retry(()=>AdminWebsocket.connect({url:new URL(`ws://127.0.0.1:${adminPort}`),wsClientOptions:{origin:'rai-test'}}),45000)}
    catch(e){child.kill();throw new Error('Conductor did not start: '+output.slice(-12000)+' '+e.message)}
    appPort=await port();await admin.attachAppInterface({port:appPort,allowed_origins:'rai-test'});
  }
  async function connectApp(id,cell){
    // After a restart the cell starts a moment after the admin interface.
    await retry(()=>admin.authorizeSigningCredentials(cell),60000);
    const auth=await admin.issueAppAuthenticationToken({installed_app_id:id});
    const app=await AppWebsocket.connect({url:new URL(`ws://127.0.0.1:${appPort}`),token:auth.token,wsClientOptions:{origin:'rai-test'}});clients.push(app);
    return{app,cell,call:(fn_name,payload=null)=>app.callZome({role_name:'community',zome_name:'rai_community',fn_name,payload},45000)};
  }
  async function closeClients(){
    // An already closed socket never emits a second close event.
    for(const client of [...clients.splice(0).map(c=>c.client),admin.client]){
      if(client.socket.readyState===3)continue;
      let timer;await Promise.race([client.close().catch(()=>{}),new Promise(r=>{timer=setTimeout(r,1500)})]);clearTimeout(timer);
      client.socket.terminate?.();
    }
  }
  await launch(arc);
  const run={dir,get admin(){return admin},get child(){return child},output:()=>output,async install(id,bundle=join(root,'workdir/rai-community.happ')){
    const agent_key=await admin.generateAgentPubKey();
    const info=await admin.installApp({source:{type:'path',value:bundle},agent_key,installed_app_id:id,network_seed:networkSeed});
    await admin.enableApp({installed_app_id:id});
    const cell=info.cell_info.community.find(c=>c.type===CellType.Provisioned).value.cell_id;
    return{...await connectApp(id,cell),agent_key};
  },
  /** Stops and starts the same conductor (same data), e.g. to switch a light client to a full copy. */
  async restart({arc:next=arc}={}){
    await closeClients();child.kill();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(r,5000);});
    await launch(next);
  },
  async reconnect(id){
    const apps=await admin.listApps({});const info=apps.find(a=>a.installed_app_id===id);
    const cell=info.cell_info.community.find(c=>c.type===CellType.Provisioned).value.cell_id;
    return connectApp(id,cell);
  },
  async close(){
    await closeClients();
    child.kill();await writeFile(join(dir,'conductor.log'),output);
  }};
  return run;
}
