import{AppWebsocket,WsClient,SignalType,encodeHashToBase64,decodeHashFromBase64}from'@holochain/client';
export type EventView={hash:string,data:{community:string,membership:string,body:any,authority?:string|null},sequence:number,timestamp_us:number};
export type MemberView={hash:string,data:{community:string,member_id:string,generation:number,previous:string|null,previous_cutoff:number|null,invitation:string|null,gate:string|null,name:string,recovery_signature:number[]},device:string,sequence:number,timestamp_us:number};
export type GovState={community:{name:string,founder:string},created_us:number,members:MemberView[],excluded_members:string[],joins:{member_id:string,invited_by:string,at_us:number}[],events:EventView[],sample_percent:number,raiunyt_enabled:boolean};
export type SummaryView={hash:string,member_id:string,data:{community:string,membership:string,offer:string,hours:any[]},timestamp_us:number};
/** The merged, cached view the screens read (same shape as the 0.3 snapshot plus 0.4 fields). */
export type Snapshot=GovState&{summaries:SummaryView[]};
// Fields that carry a single hash on the wire.
const hashFields=new Set(['community','membership','previous','invitation','gate','task','x_verification','claim','role','offer','sampling','channel','authority','checker','checker_authority','settings','quota','hash']);
// Fields that carry a list of hashes.
const hashLists=new Set(['references','storage']);
function fromWire(value:any):any{if(value instanceof Uint8Array){if(value.length===39)return encodeHashToBase64(value);return Array.from(value);}if(Array.isArray(value))return value.map(v=>fromWire(v));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fromWire(v)]));return value;}
function toWire(value:any,key=''):any{if(value instanceof Uint8Array)return value;if(typeof value==='string'&&hashFields.has(key))return decodeHashFromBase64(value);if(Array.isArray(value))return hashLists.has(key)?value.map(v=>decodeHashFromBase64(v)):value.map(v=>toWire(v));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,toWire(v,k)]));return value;}
const reads=['identity','locate_memberships','binding_challenge','governance_state','tasks','goals','host_offers','messages','channel_updates','member_activity','review_feed','review_queue','hosting_summaries','invitation_info'];
export class API{
 private constructor(public client:AppWebsocket,private roleName='community'){}
 static async connect(url?:string,token?:string){const options=url?{url:new URL(url),token:Array.from(atob(token??''),c=>c.charCodeAt(0))}:{};return new API(await AppWebsocket.connect(options));}
 async call<T=any>(fn_name:string,payload:any=null,timeoutMs=120000):Promise<T>{const deadline=Date.now()+timeoutMs;for(;;){try{return fromWire(await this.client.callZome({role_name:this.roleName,zome_name:'rai_community',fn_name,payload:toWire(payload)},Math.max(1,Math.min(60000,deadline-Date.now()))));}catch(error){const transient=/DepMissingFromDht|Record is not available yet|Membership not synchronized|Connection attempted before home relay URL is known|response channel dropped|database is locked/.test(String(error))||(reads.includes(fn_name)&&/Request timed out in \d+ ms: call_zome/.test(String(error)));if(Date.now()>=deadline||!transient)throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(1200,Math.max(0,deadline-Date.now()))));}}}
 /** Local app signals: refresh hints, covered hours and hosting attestations. */
 onSignal(handler:(payload:any)=>void){return this.client.on('signal',(signal:any)=>{if(signal?.type===SignalType.App)handler(fromWire(signal.value.payload));});}
 identity(){return this.call<string>('identity');}
 runtimeConnected(){
   const transport = this.client.client;
   return transport instanceof WsClient && transport.socket.readyState === WebSocket.OPEN;
 }
 governance(community:string,timeoutMs?:number){return this.call<GovState>('governance_state',decodeHashFromBase64(community),timeoutMs);}
 tasks(community:string){return this.call<EventView[]>('tasks',decodeHashFromBase64(community));}
 goals(community:string){return this.call<EventView[]>('goals',decodeHashFromBase64(community));}
 hostOffers(community:string){return this.call<EventView[]>('host_offers',decodeHashFromBase64(community));}
 messages(community:string,channel:string|null,before_us:number|null=null,since_us:number|null=null,limit=50){return this.call<{events:EventView[],more:boolean}>('messages',{community,channel,before_us,since_us,limit});}
 channelUpdates(community:string,since_us:number){return this.call<EventView[]>('channel_updates',{community,since_us});}
 activity(community:string,member_id:string){return this.call<{events:EventView[],invites:any[]}>('member_activity',{community,member_id});}
 feed(community:string,from_us:number|null,to_us:number|null=null){return this.call<EventView[]>('review_feed',{community,from_us,to_us});}
 summaries(community:string,member_ids:string[],months:string[]){return this.call<SummaryView[]>('hosting_summaries',{community,member_ids,months});}
 create(name:string,founder:string){return this.call<string>('create_community',{name,founder});}
 challenge(m:any){return this.call<string>('binding_challenge',m);}
 bind(m:any){return this.call<string>('bind_member',m);}
 publish(community:string,membership:string,body:any){return this.call<string>('publish',{community,membership,body});}
 post(community:string,membership:string,text:string,channel:string|null){return this.call<string>('post_message',{community,membership,text,channel});}
 ensureHosting(community:string,membership:string){return this.call<string>('ensure_hosting',{community,membership});}
 queue(community:string){return this.call<any[]>('review_queue',decodeHashFromBase64(community));}
 probe(community:string,membership:string,offer:string,storage:string[]){return this.call<any>('probe_host',{community,membership,offer,storage},20000);}
 publishSummary(community:string,membership:string,hours:any[]){return this.call<string[]>('publish_hosting_summary',{community,membership,hours});}
 invite(community:string,membership:string){return this.call<{community:string,invitation:string,expires_at_us:number}>('create_invite',{community,membership});}
 invitationInfo(invitation:string){return this.call<any>('invitation_info',decodeHashFromBase64(invitation),15000);}
}
