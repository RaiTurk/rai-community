import './style.css';
import{prepareXClaim}from'./x-account.mjs';
import{starterGoals}from'./starter-goals.mjs';
import{API,type Snapshot,type MemberView,type EventView}from'./api';
import{newRecovery,readRecovery,signRecovery,recoveryWarning,memberCurrent,memberFor,removed,currentRole,eligibleEvent,contributionGroups,can,adminPermissions,PERMISSIONS,formatInvite,parseInvite}from'./core.mjs';
import { emptyState, viewOf, loadCache, saveCache, refreshState, olderMessages } from './store.mjs';
import { badgeCounts, badgeProgress, BADGES } from './badges.mjs';
import { dueTargets, limited, storageChallenge, keepAttestation, summaryDue, ACTIVE_MS } from './hosting-schedule.mjs';
import { createHostingClock, formatHostingDuration } from './hosting-clock.mjs';
import { latestDeviceOffer, personalContributions } from './personal-activity.mjs';
import { nameTaken, shortId, currentMembers } from './names.mjs';
import { channelList, messageChannels, newChannelBody, channelBody, visibleGoals, GENERAL } from './channels.mjs';
import { displayedGoal, goalContent, goalTranslations } from './goals.mjs';
import { displayedTask, taskContent, taskDescription, taskTranslations, TASK_DESCRIPTION_CHARS } from './tasks.mjs';
import { ledger, balanceOf, balances, hostingHours, hostingObservations, hostingMonth, hoursInHostingMonth, monthlyHostingTargets, currentMultipliers, multiplierFor, lastFullCopy, RULES_VERSION, HOSTING_HOURLY, FULL_COPY_HOURLY } from './raiunyt.mjs';
import { acceptedTerms, acceptTerms, termsText, termsChecks, TERMS_VERSION } from './terms.mjs';
import { autoReleasePlan, communitySettings, isNewer, orderedTasks, pageOf, releaseUrl, settingBody, versionParts } from './community-settings.mjs';
declare const __APP_VERSION__: string;
const root=document.querySelector<HTMLDivElement>('#app')!;
let language=localStorage.getItem('rai.language')||'tr';
const t=(en:string,tr:string)=>language==='tr'?tr:en;
const e=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const actions={like:()=>t('Like','Beğeni'),repost:()=>t('Repost','Yeniden paylaşım'),quote:()=>t('Quote','Alıntı'),reply:()=>t('Reply','Yanıt'),done:()=>t('Done','Yaptım')};
const permissionLabels:Record<string,()=>string>={tasks:()=>t('Tasks','Görevler'),goals:()=>t('Goals','Hedefler'),channels:()=>t('Channels','Kanallar'),reviewers:()=>t('Assign reviewers','Kontrolcü atama'),membership:()=>t('Membership decisions','Üyelik kararları'),sampling:()=>t('Sample rate','Örneklem oranı'),hosting:()=>t('Hosting settings','Barındırma ayarları'),release:()=>t('Announce staged Windows updates','Hazırlanmış Windows güncellemelerini duyurma')};
// Plan D5: what each organizer permission allows.
const permissionInfo:Record<string,()=>string>={
 tasks:()=>t('Adds, edits, archives and restores tasks. Stars and pins tasks.','Görev ekler, düzenler, arşivler ve geri alır. Görevleri yıldızlar ve başa sabitler.'),
 goals:()=>t('Adds and edits shared goals, marks them complete or reopens them.','Ortak hedef ekler ve düzenler, tamamlandı olarak işaretler veya yeniden açar.'),
 channels:()=>t('Opens, renames, restricts to organizers and closes channels.','Kanal açar, adını değiştirir, yalnız yöneticilerin yazabildiği kanala çevirir ve kapatır.'),
 reviewers:()=>t('Gives and removes the reviewer role. Reviewers check contributions and measure hosting.','Üyelere kontrolcü rolü verir ve geri alır. Kontrolcüler katkıları inceler ve barındırmayı ölçer.'),
 membership:()=>t('Removes a member from the community or restores them. Cannot be used on the founder. Turns member invitations on or off for the whole community or for one member.','Bir üyenin topluluktan çıkarılmasına veya geri alınmasına karar verir. Kurucuya uygulanamaz. Üyelerin davet üretmesini topluluk genelinde veya kişi bazında açar ve kapatır.'),
 sampling:()=>t('Sets what share of reported contributions is randomly checked. Flagged contributions are always checked.','Bildirilen katkıların yüzde kaçının rastgele kontrole gideceğini belirler. Şikâyet edilen katkılar her zaman kontrole gider.'),
 hosting:()=>t('Changes the scarcity bonus in hosting points (e.g. ×3 for a single host, ×2 for two).','Barındırma puanındaki kıtlık bonusunu (tek barındırıcı ×3, iki ×2 gibi) değiştirir.'),
 release:()=>t('Announces the Windows release the founder prepared, when this organizer first connects with it. Cannot prepare or change a release.','Kurucunun hazırladığı Windows sürümünü, bu yönetici yeni sürümle ilk bağlandığında topluluğa duyurur. Sürümü hazırlayamaz veya değiştiremez.'),
};
const MESSAGE_CHARS=400;
const fullCopyText=()=>t('Full-copy members store all shared community records and serve them to newcomers. While they are online, the community works without a central server.','Tam kopya tutan üyeler topluluğun bütün ortak kayıtlarını saklar ve yeni gelenlere sunar. Onlar açık oldukça topluluk merkezi bir sunucuya ihtiyaç duymadan çalışır.');
let state=emptyState();
let api:API|null=null,device='',community=localStorage.getItem('rai.community')||'',snapshot:Snapshot|null=null,membership:MemberView|null=null,queue:any[]=[],screen='home',busy=false,notice='',pending:any=null,backupConfirmed=false,goalDraft:EventView|null=null,goalEditorOpen=false;
let chatChannel=localStorage.getItem('rai.chat.channel')||GENERAL,termsOpen=false;
let settings: ReturnType<typeof communitySettings>;
let selectedTask = '';
let archivedTasks = false;
let taskEditor:EventView|null|undefined;
let taskEditLanguage='tr';
let profileMember = '';
let profileFrom = 'members';
let profileScroll = 0;
let profileChatDraft = '';
const TASKS_PAGE_SIZE = 8;
const CHAT_BATCH = 50;
const CHAT_LIMIT = 200;
const pages = {
  tasks: 0, archived: 0, members: 0, hosts: 0, goals: 0, history: 0, reports: 0,
  campaignLedger: 0, hostingLedger: 0, pastHosting: 0, xHistory: 0, channels: 0, channelSettings: 0,
  pendingAccounts: 0, pendingContributions: 0, completedReviews: 0, assignedAccounts: 0, assignedContributions: 0,
};
type ListName = keyof typeof pages;
const searches = {members:'', hosts:''};
type SearchName = keyof typeof searches;
let chatVisible=CHAT_BATCH, chatEnd='';let poll=false;let dirty=false;let publicChallenge='';let restorePreview:any=null;
root.addEventListener('input',()=>{dirty=true;});
const $=(id:string)=>root.querySelector<HTMLElement>('#'+id)!;
const val=(id:string)=>(root.querySelector<HTMLInputElement|HTMLTextAreaElement>('#'+id)?.value||'').trim();
const btn=(label:string,id:string,primary=false)=>`<button type="button" id="${id}" ${busy?'disabled':''} class="${primary?'primary':''}">${e(label)}</button>`;
const field=(label:string,id:string,value='',type='text')=>`<label>${e(label)}<input id="${id}" type="${type}" value="${e(value)}" autocomplete="off"></label>`;
// Accessible explanation: click or keyboard opens it; not a hover-only tooltip.
const info=(title:string,body:string)=>`<details class="info"><summary aria-label="${e(title)}" title="${e(title)}"><span aria-hidden="true">i</span></summary><div class="info-body"><strong>${e(title)}</strong>${body}</div></details>`;
const bytes=(s:string)=>new TextEncoder().encode(s).length;
/** Plan J3: only https:// links become clickable; anything else is shown as text. */
const safeLink=(url:unknown,label:string)=>{const v=String(url??'');return /^https:\/\/[^\s"'<>]+$/.test(v)?`<a href="${e(v)}" target="_blank" rel="noopener noreferrer">${e(label)}</a>`:`<span class="muted">${e(v)}</span>`;};
function download(name:string,content:string){const url=URL.createObjectURL(new Blob([content],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function message(s:string){notice=s;const n=$('notice');if(n)n.textContent=s;}
function drafts(){return [...root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea')].map(el=>({selector:el.id?'#'+CSS.escape(el.id):el.dataset.actionCode?'input[data-task="'+el.dataset.task+'"][data-action-code="'+el.dataset.actionCode+'"]':'',value:el.value,checked:el instanceof HTMLInputElement?el.checked:false}));}
function restoreDrafts(values:ReturnType<typeof drafts>){for(const d of values){if(!d.selector)continue;const el=root.querySelector<HTMLInputElement>(d.selector);if(el){el.value=d.value;el.checked=d.checked;}}}
async function run(work:()=>Promise<void>,{preserveDrafts=false}={}) {
 if(busy)return;
 const saved=drafts(),wasDirty=dirty;
 let failed=false;
 busy=true;
 notice='';
 root.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
 try { await work(); dirty=preserveDrafts&&wasDirty; }
 catch(err) { failed=true; notice=String((err as Error)?.message||err).slice(0,1200); }
 finally {
  busy=false;
  render();
  if(failed||preserveDrafts){restoreDrafts(saved);updateTaskDescriptionCount();}
  if(failed)$('notice')?.scrollIntoView({block:'nearest'});
  scheduleRelease();
  scheduleHosting();
 }
}
const mine=()=>membership?.data.member_id||'';
// The founder holds every permission; other organizers only what the founder granted.
const founder=()=>!!membership&&snapshot?.community.founder===mine();
const may=(permission:string)=>!!membership&&!!snapshot&&can(snapshot,mine(),permission);
const admin=()=>may('admin');
const role=()=>snapshot?currentRole(snapshot,mine()):null;
const memberRole=(id:string)=>snapshot?.community.founder===id?'founder':adminPermissions(snapshot,id).length?'organizer':snapshot&&currentRole(snapshot,id)?'reviewer':'member';
const roleName=(role:ReturnType<typeof memberRole>)=>({founder:t('Founding organizer','Kurucu yönetici'),organizer:t('Organizer','Yönetici'),reviewer:t('Reviewer','Kontrolcü'),member:t('Member','Üye')})[role];
const roleMarkers = {founder:'★',organizer:'◆',reviewer:'●',member:''};
const roleMarker = (kind: keyof typeof roleMarkers) => `<span class="member-symbol ${kind}" role="img" title="${e(roleName(kind))}" aria-label="${e(roleName(kind))}">${roleMarkers[kind]}</span>`;
const pinMarker = () => `<span class="task-pin" role="img" aria-label="${t('Pinned','Sabitlenmiş')}" title="${t('Pinned','Sabitlenmiş')}">📌</span>`;
const starMarker = () => `<span class="task-star" role="img" aria-label="${t('Starred','Yıldızlı')}" title="${t('Starred','Yıldızlı')}">★</span>`;
const symbols = () => `<details class="symbols"><summary>${t('What the symbols mean','Simgeler ne anlama geliyor?')}</summary><ul>
  ${(['founder','organizer','reviewer'] as const).map(kind=>`<li>${roleMarker(kind)} ${roleName(kind)} · ${kind==='founder'?t('purple star','mor yıldız'):kind==='organizer'?t('blue diamond','mavi elmas'):t('brown dot','kahverengi nokta')}</li>`).join('')}
  <li>${starMarker()} ${t('Gold star: task highlighted by an organizer','Altın yıldız, yöneticinin öne çıkardığı görevi gösterir')}</li>
  <li>${pinMarker()} ${t('Task pinned to the top','Listenin başına sabitlenen görev')}</li>
  <li><span class="member-symbol fullcopy" aria-hidden="true">◈</span> ${t('Turquoise layers: keeps a full copy of the network (verified in the last 24 hours).','Turkuaz katman: ağın tam kopyasını tutuyor (son 24 saatte doğrulandı).')} ${e(fullCopyText())}</li>
</ul></details>`;
let fullCopyFor: Snapshot|null = null;
let fullCopyCache = new Map<string,number>();
/** Time of a member's latest verified full-copy hour when it is within the last 24 hours (plan C1). */
function fullCopyRecent(id:string) {
  if (!snapshot) return 0;
  if (fullCopyFor!==snapshot) {
    fullCopyCache = new Map();
    for (const check of hostingObservations(snapshot)) if (check.fullCopy) fullCopyCache.set(check.host,Math.max(fullCopyCache.get(check.host)??0,check.time));
    fullCopyFor = snapshot;
  }
  const last = fullCopyCache.get(id) ?? 0;
  return Date.now()*1000-last < 24*3_600_000_000 ? last : 0;
}
const fullCopyMarker = (last:number) => `<span class="member-symbol fullcopy" role="img" title="${e(t('Keeps a full copy of the network · last verified: ','Ağın tam kopyasını tutuyor · son doğrulama: ')+new Date(last/1000).toLocaleString(language==='tr'?'tr-TR':'en-GB'))}" aria-label="${e(t('Keeps a full copy of the network','Ağın tam kopyasını tutuyor'))}">◈</span>`;
function memberName(id?:string|null, fallback='') {
  if (!id) return e(fallback || t('Unknown member','Bilinmeyen üye'));
  const name = snapshot && memberCurrent(snapshot,id)?.data.name || fallback;
  const type = memberRole(id);
  const reviewer = type==='organizer' && snapshot && currentRole(snapshot,id);
  const full = fullCopyRecent(id);
  return `<span class="member-name ${type}">${type==='member'?'':roleMarker(type)}${reviewer?roleMarker('reviewer'):''}${full?fullCopyMarker(full):''}${e(name)}${name?' ':''}<span class="member-id">${e(shortId(id,snapshot))}</span></span>`;
}
function profileLink(id?: string, fallback = '') {
  return id ? `<button type="button" class="profile-link" data-page="profile" data-profile="${e(id)}">${memberName(id, fallback)}</button>`
    : memberName(id, fallback);
}
let hostingEnabled = false;
let goalEditLanguage = 'tr';
let networkSettings:any=null;
let networkRead:Promise<void>|undefined;
let hostingDisplayTimer: ReturnType<typeof setInterval> | undefined;
const hostingClock = createHostingClock(localStorage, () => hostingEnabled && navigator.onLine && !!api?.runtimeConnected(), paintHostingTime);

const memberReady = () => !!membership && !!snapshot && !!acceptedTerms(localStorage) && !removed(snapshot, mine());
function updateHostingClock() {
  hostingEnabled = memberReady() && networkSettings?.fullCopy === true;
  hostingClock.select(hostingEnabled ? `rai.full-copy-time.${community}.${mine()}.${device}` : '');
  hostingClock.observe(hostingEnabled);
  updateHostingDisplay();
}

function loadNetworkSettings() {
  if (!shell || networkSettings) return Promise.resolve();
  networkRead ??= shell.getNetwork().then(value => {
    networkSettings = value;
    updateHostingClock();
  }).catch(error => console.debug('Device settings are temporarily unavailable.', error))
    .finally(() => { networkRead = undefined; });
  return networkRead;
}

function paintHostingTime() {
  const state = hostingClock.read();
  const status = $('hosting-status');
  const session = $('hosting-session');

  if (status) {
    status.dataset.active = String(state.active);
    status.textContent = networkSettings?.fullCopy === false ? t('Light mode', 'Hafif mod')
      : state.active ? t('Active', 'Etkin') : hostingEnabled
      ? t('Waiting for connection', 'Bağlantı bekleniyor') : t('Inactive', 'Kapalı');
  }
  if (session) session.textContent = hostingEnabled ? formatHostingDuration(state.sessionMs, language) : '—';

}

function updateHostingDisplay() {
  clearInterval(hostingDisplayTimer);
  hostingDisplayTimer = undefined;
  if (!$('hosting-status')) return;
  paintHostingTime();
  if (hostingEnabled) hostingDisplayTimer = setInterval(paintHostingTime, 1_000);
}

for (const event of ['online', 'offline']) {
  window.addEventListener(event, () => hostingClock.connectionChanged());
}
window.addEventListener('pagehide', () => hostingClock.save());
const publish=async(body:any)=>{if(!api||!membership)throw Error(t('Join this community first.','Önce topluluğa katıl.'));return api.publish(community,membership.hash,body);};
const FULL_SCOPE={gov:true,tasks:true,goals:true,offers:true,feed:true,channels:true,summaries:true,mine:true};
const LIGHT_SCOPE={tasks:true,offers:true,feed:true,channels:true,mine:true};
let stateCommunity='';
function applyView(){
 snapshot=viewOf(state) as Snapshot|null;
 if(!snapshot){membership=null;updateHostingClock();return;}
 settings=communitySettings(snapshot);
 membership=snapshot.members.find(m=>m.device===device&&memberCurrent(snapshot,m.data.member_id)?.hash===m.hash)||null;
 updateHostingClock();
}
/** Narrow reads merged into the cached view; `scope` picks which parts to fetch (plan A4, H3). */
async function refresh(scope:any=FULL_SCOPE){
 if(!api||!community)return;
 if(stateCommunity!==community){state=loadCache(localStorage,community);stateCommunity=community;applyView();}
 const wanted:any={...scope};
 if(screen==='chat'&&!state.messages[chatChannel])wanted.channel=chatChannel;
 if(screen==='goals')wanted.goals=true;
 if(Date.now()*1000-state.govAt>6*60_000_000)wanted.gov=true;
 if(Date.now()*1000-((state as any).summariesAt??0)>30*60_000_000)wanted.summaries=true;
 state=await refreshState(api,community,state,wanted,Date.now()*1000,mine()||'');
 if(wanted.summaries)(state as any).summariesAt=Date.now()*1000;
 applyView();
 if(membership&&!wanted.mine){state=await refreshState(api,community,state,{mine:true},Date.now()*1000,mine());applyView();}
 saveCache(localStorage,community,state);
 queue=screen==='reviews'&&(role()||may('reviewers'))?await api.queue(community):[];
 localStorage.setItem('rai.community',community);
}
let hintTimer:ReturnType<typeof setTimeout>|undefined;
const covered=new Set<string>();
async function connect(){
 api=await API.connect();device=await api.identity();
 await loadNetworkSettings();
 api.onSignal(signal=>{
  if(signal?.type==='hint'&&signal.community===community){clearTimeout(hintTimer);hintTimer=setTimeout(()=>void backgroundRefresh(LIGHT_SCOPE),3000);}
  if(signal?.type==='covered')covered.add(signal.offer+'|'+Math.floor(signal.hour_us/1000));
  if(signal?.type==='attestation'&&signal.community===community&&hostingEnabled)keepProof(signal.proof);
 });
 if(community){state=loadCache(localStorage,community);stateCommunity=community;applyView();render();await refresh();}
}
/** Narrow desktop bridge (absent in a browser). */
const shell=(window as any).raiShell as undefined|{getNetwork():Promise<any>,setNetwork(v:any):Promise<boolean>,restart():Promise<void>,downloadUpdate(url:string,sha256:string):Promise<{ok:boolean,actual:string,file:string}>,openUpdate(file:string):Promise<string>};
function paintReleaseNotice() {
 const release = settings?.release;
 const container = $('release-notice');
 const key = release && isNewer(release.version,__APP_VERSION__) ? JSON.stringify([release,language]) : '';
 if (container.dataset.release === key) return;
 container.dataset.release = key;
 container.innerHTML = key && release ? `<div class="notice warning row between" role="status">
   <div><strong>${t('Update required','Güncelleme gerekli')}</strong>
   ${t('New version','Yeni sürüm')} ${e(release.version)} · ${t('Installed','Kurulu sürüm')} ${e(__APP_VERSION__)}</div>
   ${shell?`<button type="button" id="verified-update" class="primary">${t('Download and verify','İndir ve doğrula')}</button>`:`<a class="download-update" href="${e(release.url)}" target="_blank" rel="noopener noreferrer">${t('Download update','Güncellemeyi indir')}</a>`}
   <p class="muted">SHA-256: <code>${e(release.sha256??'')}</code>${shell?'':' · '+t('Check this value before installing.','Kurmadan önce bu değeri kontrol et.')}</p>
 </div>` : '';
 container.querySelector<HTMLButtonElement>('#verified-update')?.addEventListener('click',()=>void run(async()=>{
   if(!release?.sha256)throw Error(t('This announcement has no SHA-256 value; it cannot be verified.','Bu duyuruda SHA-256 değeri yok; doğrulanamaz.'));
   message(t('Downloading and verifying…','İndiriliyor ve doğrulanıyor…'));
   const result=await shell!.downloadUpdate(release.url,release.sha256);
   if(!result.ok)throw Error(t('The downloaded file does not match the announced SHA-256. Do not install it.','İndirilen dosya duyurulan SHA-256 değeriyle uyuşmuyor. Kurma.'));
   notice=t('Verified. The installer is opening.','Doğrulandı. Kurulum açılıyor.');
   await shell!.openUpdate(result.file);
 }));
}
function render(){
 clearInterval(hostingDisplayTimer);
 const moreOpen = root.querySelector<HTMLDetailsElement>('#more-pages')?.open;
 document.documentElement.lang=language;
 root.innerHTML=`<header><div class="app-brand"><img src="./icon.png" width="36" height="36" alt=""><div><strong>Rai Community</strong><small>${t('Goal: 1 million people using Holochain','Hedef: 1 milyon kişi Holochain kullanıyor')}</small></div></div><label>Language/Dil<select id="language"><option value="en" ${language==='en'?'selected':''}>English</option><option value="tr" ${language==='tr'?'selected':''}>Türkçe</option></select></label></header><main><div id="notice" class="notice error" role="status">${e(notice)}</div><div id="release-notice"></div><section id="content"></section><footer>${t('Community initiative. Not an official Holochain app. Public community records are shared with network peers. No image uploads, social-media automation, or payments. RaiUnyt is a non-transferable recognition score, not money.','Topluluk girişimi. Resmî Holochain uygulaması değildir. Ortak kayıtlar ağdaki eşlerle paylaşılır. Görsel yükleme, otomatik sosyal medya işlemi veya ödeme yoktur. RaiUnyt devredilemeyen bir tanınma puanıdır, para değildir.')} <button type="button" class="link" id="show-terms">${t('Terms of use','Kullanım koşulları')}</button></footer></main>`;
 root.querySelector<HTMLSelectElement>('#language')!.onchange=ev=>{
   const saved=drafts();
   language=(ev.target as HTMLSelectElement).value;
   localStorage.setItem('rai.language',language);
   render();
   restoreDrafts(saved);
   updateTaskDescriptionCount();
 };
 paintReleaseNotice();
 $('show-terms').onclick=()=>{termsOpen=true;render();};
 if(!acceptedTerms(localStorage)||termsOpen){termsScreen();return;}
 if(!api){$('content').innerHTML=`<h1>${t('Open your community hApp','Topluluk hApp’ini aç')}</h1><p>${t('This interface connects to your local Holochain runtime. It does not generate demo records.','Bu arayüz yerel Holochain uygulamana bağlanır. Temsili kayıt üretmez.')}</p>${btn(t('Connect again','Yeniden bağlan'),'connect',true)}`;$('connect').onclick=()=>run(connect);return;}
 if(!membership||pending){onboard();return;}
 const isRemoved=snapshot&&removed(snapshot,mine());
 const navButton = ([id, label]: string[]) => `<button type="button" data-page="${id}" ${screen===id?'class="active" aria-current="page"':''}>${e(label)}</button>`;
 const primary = [
   ['home',t('Home','Ana ekran')],['chat',t('Messages','Mesajlar')],
   ['hosting',t('Hosting','Barındırma')],['goals',t('Shared goals','Ortak hedefler')],
   ['history',t('My contributions','Katkılarım')],
 ];
 const secondary = [
   ['tasks',t('Tasks','Görevler')],['raiunyt','RaiUnyt'],['members',admin()?t('Members and rules','Üyeler ve kurallar'):t('Members','Üyeler')],
   ...(role()||may('reviewers')?[['reviews',t('Peer checks','Üye kontrolleri')]]:[]),
   ['community',t('Community reports','Topluluk katkıları')],['account',t('Account','Hesap')],
 ];
 const communityName = snapshot?.community.name ?? '';
 $('content').innerHTML = `
   <div class="community-heading"><h1>${e(/^rai community$/i.test(communityName)?'Rai Community':communityName)}</h1><span class="tag">${memberName(mine())}</span></div>
   <nav aria-label="${t('Community navigation','Topluluk menüsü')}">
     ${primary.map(navButton).join('')}
     <details id="more-pages" ${moreOpen?'open':''}><summary>${t('More','Diğer')}</summary>
       <div class="more-links">${secondary.map(navButton).join('')}</div>
     </details>
     <button type="button" id="refresh" class="refresh" ${busy?'disabled':''} title="${t('Fetch the latest community records','En güncel topluluk kayıtlarını getir')}">↻ ${t('Refresh','Yenile')}</button>
   </nav><div id="page"></div>`;
 $('refresh').onclick=()=>run(async()=>refresh());
 if(isRemoved&&screen!=='history'){$('page').innerHTML=`<div class="notice warning">${t('Community access is revoked. Your history remains available. Contact the organizer to appeal; your recovery code cannot bypass a membership decision.','Topluluk erişimi iptal edildi. Geçmişin korunuyor. İtiraz için yöneticiyle iletişim kur; kurtarma kodu üyelik kararını aşmaz.')}</div>`;return;}
 if(screen==='home') home();
 if(screen==='profile') profile();
 if(screen==='chat')chat();if(screen==='goals')goals();if(screen==='tasks')tasks();if(screen==='history')history();if(screen==='community')communityReports();if(screen==='account')account();if(screen==='reviews')reviews();if(screen==='members')members();if(screen==='hosting')hosting();if(screen==='raiunyt')raiunyt();
 updateHostingDisplay();
}

document.addEventListener('click', event => {
  for (const open of root.querySelectorAll<HTMLDetailsElement>('details.info[open]'))
    if (!open.contains(event.target as Node)) open.open = false;
});
root.addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLButtonElement>('button[data-page]');
  if (!target) return;
  if (snapshot && removed(snapshot, mine()) && target.dataset.page !== 'history') return;
  if (target.dataset.profile) {
    profileMember = target.dataset.profile;
    if (screen !== 'profile') {
      profileFrom = screen;
      profileScroll = window.scrollY;
      profileChatDraft = screen==='chat' ? root.querySelector<HTMLTextAreaElement>('#chat-text')?.value ?? '' : '';
    }
  }
  if (target.dataset.page==='chat' && screen!=='chat' && screen!=='profile') resetChatHistory();
  const previous = screen;
  screen = target.dataset.page!;
  if(previous==='tasks'&&screen!=='tasks')taskEditor=undefined;
  if (previous==='account'&&screen!=='account') clearInviteWarning();
  const more = root.querySelector<HTMLDetailsElement>('#more-pages');
  if (more) more.open = false;
  if (target.dataset.openTask) {
    taskEditor=undefined;
    selectedTask = target.dataset.openTask;
    if (target.closest('.featured-task')) archivedTasks = false;
    const index = orderedTasks(snapshot!, settings.tasks).findIndex(task=>task.data.body.id===selectedTask);
    if (!archivedTasks) pages.tasks = Math.floor(Math.max(0,index) / TASKS_PAGE_SIZE);
  }
  if (target.id==='all-tasks') {
    archivedTasks = false;
    selectedTask = '';
    pages.tasks = 0;
  }
  render();
  if (target.dataset.openTask) $('task-detail')?.focus();
  else if (target.id==='back-from-profile') {
    const draft = root.querySelector<HTMLTextAreaElement>('#chat-text');
    if (draft) {
      draft.value = profileChatDraft;
      dirty ||= !!profileChatDraft;
    }
    window.scrollTo(0,profileScroll);
  }
  else window.scrollTo(0,0);
  if (screen==='reviews'&&previous!=='reviews') void run(refresh);
  if (screen==='goals'&&previous!=='goals') void backgroundRefresh({goals:true});
});

function listPage<T>(name: ListName, items: T[], size = 12) {
  const page = pageOf(items, pages[name], size);
  pages[name] = page.page;
  return page;
}

function listPager(name:ListName, page:ReturnType<typeof pageOf>, chronological = false) {
  if (!page.total) return `<p class="muted">${t('No results.','Sonuç bulunamadı.')}</p>`;
  const range = `${page.start+1}–${page.start+page.items.length} / ${page.total}`;
  return `<div class="list-pager row between">
    <span class="muted" role="status">${range}</span>
    ${page.pages>1?`<div class="row">
      <button type="button" data-list="${name}" data-direction="previous" data-list-page="${page.page-1}" ${page.page===0?'disabled':''}>${chronological?t('Newer','Daha yeni'):t('Previous','Önceki')}</button>
      <button type="button" data-list="${name}" data-direction="next" data-list-page="${page.page+1}" ${page.page===page.pages-1?'disabled':''}>${chronological?t('Older','Daha eski'):t('Next','Sonraki')}</button>
    </div>`:''}
  </div>`;
}

function listSearch(name:SearchName) {
  return `<form class="row list-search" data-list-search="${name}">
    ${field(t('Name or # code','Ad veya # kodu'),name+'-search',searches[name],'search')}
    <button type="submit">${t('Search','Ara')}</button>
    ${searches[name]?`<button type="button" data-list="${name}" data-clear-search>${t('Clear','Temizle')}</button>`:''}
  </form>`;
}

function redrawList(name:ListName, selector:string) {
  const saved = drafts().filter(d=>d.selector!==`#${name}-search`);
  const openDetails = [...root.querySelectorAll<HTMLDetailsElement>('details[id][open]')].map(detail=>detail.id);
  const screens: Record<string,()=>void> = {tasks,members,hosting,goals,history,community:communityReports,raiunyt,account,chat,reviews};
  screens[screen]?.();
  restoreDrafts(saved);
  for (const id of openDetails) {
    const details = root.querySelector<HTMLDetailsElement>('#'+CSS.escape(id));
    if (details) details.open = true;
  }
  if (screen==='hosting') updateHostingDisplay();
  const focus = root.querySelector<HTMLElement>(selector) || root.querySelector<HTMLElement>(`[data-list="${name}"]:enabled`);
  focus?.focus({preventScroll:true});
}

root.addEventListener('click', event=>{
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-list]');
  if (!button || busy) return;
  const name = button.dataset.list as ListName;
  if (button.hasAttribute('data-clear-search')) {
    searches[name as SearchName] = '';
    pages[name] = 0;
    redrawList(name,`#${name}-search`);
  } else {
    pages[name] = Number(button.dataset.listPage);
    if (name==='tasks'||name==='archived') selectedTask = '';
    const direction = button.dataset.direction;
    redrawList(name,`[data-list="${name}"][data-direction="${direction}"]:enabled`);
  }
});

root.addEventListener('submit', event=>{
  const form = (event.target as Element).closest<HTMLFormElement>('form[data-list-search]');
  if (!form) return;
  event.preventDefault();
  if (busy) return;
  const name = form.dataset.listSearch as SearchName;
  searches[name] = val(name+'-search');
  pages[name] = 0;
  redrawList(name,`#${name}-search`);
});

function matchesMember(name:string, id:string, search:string, handle='') {
  const lower = (value:string)=>value.toLocaleLowerCase(language==='tr'?'tr-TR':'en-GB');
  const query = lower(search);
  return lower(name).includes(query) || lower('#'+id).includes(query) || lower('@'+handle).includes(query);
}

function taskList(name:'home'|'tasks'|'archived', list:EventView[]) {
  const page = name==='home'?pageOf(list,0,3):listPage(name,list,TASKS_PAGE_SIZE);
  if (!list.length) return `<p>${name==='archived'?t('No archived tasks yet.','Henüz arşivlenmiş görev yok.'):t('No active tasks yet.','Henüz etkin görev yok.')}</p>`;
  const reported = name==='home'?new Set(personalContributions(snapshot!,mine()).map(group=>group.taskId)):null;
  return `<ul class="task-list">${page.items.map(task=>{
    const {id} = task.data.body;
    const {title} = displayedTask(task.data.body,language);
    const display = settings.tasks.get(id);
    return `<li><button type="button" data-page="tasks" data-open-task="${e(id)}" ${name!=='home'&&id===selectedTask?'aria-current="true"':''}>
      <span>${name!=='archived'&&display?.pinned?pinMarker():''}${name!=='archived'&&display?.starred?starMarker():''}${e(title)}</span>
      ${reported?.has(id)?`<span class="tag">${t('Reported','Bildirildi')}</span>`:''}
    </button></li>`;
  }).join('')}</ul>${name==='home'?'':listPager(name,page,name==='archived')}`;
}

function contributionList(groups: ReturnType<typeof personalContributions>) {
  if (!groups.length) return `<p class="muted">${t('No contribution reported yet.', 'Henüz katkı bildirimi yok.')}</p>`;
  return `<ul class="activity-list">${groups.map(group => {
    const date = new Date(group.reportedAt / 1000);
    const status = group.review === 'supported' ? t('Supported by peer review', 'Üye kontrolüyle desteklendi')
      : group.review === 'unavailable' ? t('Could not be checked', 'Kontrol edilemedi')
      : group.review === 'conflict' ? t('Review found a discrepancy', 'Kontrolde tutarsızlık görüldü')
      : t('Self-reported', 'Beyan edildi');
    return `<li class="activity-item"><div><strong>${e(group.title)}</strong>
      <p>${group.actions.map((action: keyof typeof actions) => e(actions[action]())).join(' + ')}</p></div>
      <div class="activity-meta"><span class="tag">${status}</span>
      ${group.reportedAt ? `<time datetime="${date.toISOString()}">${date.toLocaleDateString(language==='tr'?'tr-TR':'en-GB')}</time>` : ''}</div></li>`;
  }).join('')}</ul>`;
}

const hostingInfo=()=>info(t('What does hosting mean?','Barındırma ne demek?'),`<p>${t('Rai Community has no central server. Messages, tasks and contribution records live on members’ computers and are passed on from there.','Rai Community’nin merkezî bir sunucusu yok. Mesajlar, görevler ve katkı kayıtları üyelerin bilgisayarlarında durur ve oradan birbirine aktarılır.')}</p><p>${t('New installations keep a full copy of shared data. You can turn this off in Account → This device. With full copy off, the app keeps its own records and reads the other shared records from members who keep a full copy. If nobody with a full copy is online, a new member or a new device cannot load the community, and new messages reach others only when someone is online again.','Yeni kurulumlar ortak verinin tam kopyasını tutar. Hesap → Bu cihaz bölümünden bunu kapatabilirsin. Tam kopya kapalıyken uygulama kendi kayıtlarını tutar ve diğer ortak kayıtları tam kopya tutan üyelerden okur. Tam kopya tutan kimse çevrimiçi değilse yeni katılan biri veya yeni bir cihaz topluluğu yükleyemez; yeni mesajlar da başkalarına ancak biri yeniden çevrimiçi olunca ulaşır.')}</p><p>${e(fullCopyText())}</p><p>${t('The more people keep the app open, the faster and more reliable the community is for everyone.','Ne kadar çok kişi uygulamayı açık tutarsa topluluk herkes için o kadar hızlı ve güvenilir çalışır.')}</p><p>${t('In full-copy mode, hosting runs automatically while the app is open and connected. Organizers’ and reviewers’ apps automatically check which devices they can reach. An hour with a successful check earns RaiUnyt. The session timer stops when you close the app. Your account total is based on successful checks and comes back after recovery once those records sync. Hosting uses some disk space and bandwidth. Sharing records is much lighter work than Bitcoin mining, so the extra power use is generally modest.','Tam kopya modunda uygulama açık ve bağlıyken barındırma otomatik çalışır. Yönetici ve kontrolcülerin uygulamaları hangi cihazlara ulaşabildiğini otomatik ölçer. Başarılı ölçüm yapılan her saat RaiUnyt kazandırır. Oturum sayacı uygulamayı kapatınca durur. Hesabının toplamı başarılı ölçümlere dayanır ve kurtarmadan sonra kayıtlar eşitlenince geri gelir. Barındırma biraz disk alanı ve internet kullanır. Kayıt paylaşmak Bitcoin madenciliğine göre çok daha hafif bir iş, bu yüzden ek enerji kullanımı genellikle düşüktür.')}</p>${hostingTimerHelp()}${hostingDelay()}`);
const raiunytInfo=()=>info(t('What is RaiUnyt?','RaiUnyt nedir?'),`<p>${t('RaiUnyt makes contributions visible. It is calculated from public community records, counted from the very first record, and anyone can recompute it. Nobody can type in a balance, including the organizer.','RaiUnyt katkıyı görünür kılar. Ortak topluluk kayıtlarından, ilk kayıttan itibaren hesaplanır ve herkes aynı sonucu yeniden hesaplayabilir. Yönetici dahil kimse elle bakiye yazamaz.')}</p><ul><li>${t('Tasks earn 1 RaiUnyt each when you report completing them. Several actions on the same task count once. A task earns 0 if the review finds conflicting evidence.','Tamamladığını bildirdiğin her görev için 1 RaiUnyt. Aynı görevdeki birden çok eylem bir kez sayılır. Kontrolde çelişkili bulgu çıkarsa o görev 0 RaiUnyt getirir.')}</li><li>${t('Hosting: 1 for each hour with a successful remote check. Counted per person, not per device. When few hosts are reachable that hour, the hour is worth more (scarcity bonus).','Barındırma: başarılı uzaktan ölçüm yapılan her saat için 1. Cihaz değil kişi başına sayılır. O saatte ulaşılabilen barındırıcı azsa saat daha değerlidir (kıtlık bonusu).')}</li></ul>${hostingDelay()}<p>${t('It is personal and non-transferable. It is not money, cannot be sold or exchanged, and is not a promise of any reward.','Kişiye bağlıdır, devredilemez. Para değildir; satılamaz, takas edilemez ve herhangi bir ödül sözü değildir.')}</p>`);
const hostingDelay=()=>`<p>${t('The app publishes verified hosting hours about every six hours. The hours and the RaiUnyt earned from hosting appear after that summary syncs.','Uygulama doğrulanmış barındırma saatlerini yaklaşık altı saatte bir yayımlar. Saatler ve barındırmadan kazanılan RaiUnyt, bu özet eşitlenince görünür.')}</p>`;
const hostingTimerHelp=()=>`<p>${t('The timer counts time spent open and connected in full-copy mode. In light mode this device does not host shared data, so the timer is off. You can enable full copy in Account → This device.','Sayaç, cihazın tam kopya modunda açık ve bağlı kaldığı süreyi ölçer. Hafif modda bu cihaz ortak veriyi barındırmadığı için sayaç çalışmaz. Tam kopyayı Hesap → Bu cihaz bölümünden açabilirsin.')}</p>`;
function hostingSummary(hours = hostingHours(snapshot!).filter(hour=>hour.memberId===mine()).length) {
  const explanation = info(t('How are verified hours counted?','Doğrulanmış saatler nasıl hesaplanır?'),`<p>${t(
    'An hour counts when another authorized member’s app reaches your device at least once in that clock hour. Several checks in the same hour count once. The session timer tracks how long your app has been open and connected.',
    'Başka bir yetkili üyenin uygulaması, bir saat diliminde cihazına en az bir kez başarıyla ulaşırsa hesabına 1 saat eklenir. Aynı saat dilimindeki birden fazla kontrol bir kez sayılır. Oturum sayacı uygulamanın açık ve bağlı kaldığı süreyi gösterir.',
  )}</p>${hostingDelay()}`);
  return `<dl class="hosting-stats">
    <div><dt>${t('This session','Bu oturum')}</dt><dd class="row"><span id="hosting-session"></span>${info(t('How the session timer works','Oturum sayacı nasıl çalışır?'),hostingTimerHelp())}</dd></div>
    <div><dt>${t('Verified hosting','Doğrulanmış barındırma')}</dt><dd class="row"><span id="hosting-total">${t(hours===1?'1 hour':`${formatUnyt(hours)} hours`,`${formatUnyt(hours)} saat`)}</span>${explanation}</dd></div>
  </dl>`;
}

const formatUnyt=(n:number)=>n.toLocaleString(language==='tr'?'tr-TR':'en-GB',{maximumFractionDigits:2});
const unytSplit=(entries:any[])=>`<dl class="hosting-stats"><div><dt>${t('Task participation','Görevlere katılım')}</dt><dd class="big-number">${e(formatUnyt(balanceOf(entries,mine(),'campaign')))}</dd></div><div><dt>${t('Hosting','Barındırma')}</dt><dd class="big-number">${e(formatUnyt(balanceOf(entries,mine(),'hosting')))}</dd></div><div><dt>${t('Full copy','Tam kopya')}</dt><dd class="big-number">${e(formatUnyt(balanceOf(entries,mine(),'fullcopy')))}</dd></div></dl>`;
const contributionInfo=()=>info(t('How are contributions recorded?','Katkılar nasıl kaydedilir?'),`<p>${t('When you complete a task, report what you did. This is your own signed statement. A small random share is checked by another member (a reviewer). “Supported” means a reviewer could see it; “Could not be checked” is not an accusation.','Bir görevi tamamladığında ne yaptığını bildirirsin. Bu senin imzalı beyanındır. Küçük ve rastgele bir kısmı başka bir üye (kontrolcü) tarafından kontrol edilir. “Desteklendi” kontrolcünün gördüğü anlamına gelir; “Kontrol edilemedi” bir suçlama değildir.')}</p>`);
function home() {
  const list = orderedTasks(snapshot!,settings.tasks);
  $('page').innerHTML = `
    <section class="featured-task" aria-labelledby="current-task-title">
      <h2 id="current-task-title">${t('Current tasks','Güncel görevler')}</h2>
      ${taskList('home',list)}
      <button type="button" id="all-tasks" data-page="tasks">${t('All tasks','Tüm görevler')}</button>
    </section>
    <div class="home-grid">
      <section class="card" aria-labelledby="recent-contribution-title">
        <div class="row"><h2 id="recent-contribution-title">${t('My recent contributions','Son katkılarım')}</h2>${contributionInfo()}</div>
        ${contributionList(personalContributions(snapshot!,mine(),language).slice(0,3))}
        <button data-page="history">${t('View history','Geçmişi gör')}</button>
      </section>
      <section class="card" aria-labelledby="my-hosting-title">
        <div class="row between"><div class="row"><h2 id="my-hosting-title">${t('My hosting','Barındırmam')}</h2>${hostingInfo()}</div><span id="hosting-status" class="tag"></span></div>
        ${hostingSummary()}
 ${hostingEnabled?`<p class="muted">${t('While your app is open, you help other members stay in sync.','Uygulaman açık kaldıkça diğer üyelerin kayıtlara ulaşmasına yardım edersin.')}</p>`:''}
        <button data-page="hosting">${t('View hosting','Barındırmayı gör')}</button>
      </section>
      <section class="card" aria-labelledby="my-raiunyt-title">
        <div class="row"><h2 id="my-raiunyt-title">RaiUnyt</h2>${raiunytInfo()}</div>
        ${unytSplit(ledger(snapshot!))}
        <button data-page="raiunyt">${t('View details','Ayrıntıları gör')}</button>
      </section>
    </div>`;
}
async function checkedCommunity(value:string) {
 if (!/^uhCkk[A-Za-z0-9_-]{48}$/.test(value))
  throw Error(t('Enter the public community address starting with uhCkk.','uhCkk ile başlayan herkese açık topluluk adresini gir.'));
 message(t('Checking the community address…','Topluluk adresi kontrol ediliyor…'));
 try {
   const gov = await api!.governance(value,15_000);
   const excluded = new Set(gov.excluded_members);
   return {...gov,members:gov.members.filter(m=>!excluded.has(m.data.member_id)),summaries:[]} as Snapshot;
 }
 catch { throw Error(t('Could not find the community within 15 seconds. Check the address and make sure a member is online, then try again.','Topluluk 15 saniye içinde bulunamadı. Adresi kontrol et, bir üyenin çevrimiçi olduğundan emin ol ve tekrar dene.')); }
}
/** Plan I: an invitation code, or a plain address when the founder opened the community. */
async function joinTarget(text:string){
 let address=text.trim(),invitation:string|null=null;
 try { const parsed=parseInvite(address); address=parsed.community; invitation=parsed.invitation; } catch { /* a plain address */ }
 const s=await checkedCommunity(address);
 const settingsOf=communitySettings(s);
 if(invitation){
   const info=await api!.invitationInfo(invitation).catch(()=>null);
   if(!info||info.community!==address)throw Error(t('This invitation code could not be found. Check it and try again when a member is online.','Bu davet kodu bulunamadı. Kodu kontrol et ve bir üye çevrimiçiyken tekrar dene.'));
   if(!info.usable)throw Error(t('This invitation was already used, closed or has expired. Ask for a new one.','Bu davet kullanılmış, kapatılmış ya da süresi dolmuş. Yeni bir davet iste.'));
   return {address,s,via:{invitation,gate:null}};
 }
 if(!settingsOf.gateOpen||!settingsOf.gateHash)throw Error(t('This community needs an invitation. Paste the invitation code you received (it starts with RAI-INVITE).','Bu topluluk davetle katılınıyor. Aldığın davet kodunu yapıştır (RAI-INVITE ile başlar).'));
 return {address,s,via:{invitation:null,gate:settingsOf.gateHash}};
}
/** Plan J6: the clipboard is cleared 60 seconds after copying a secret. */
let clipboardTimer:ReturnType<typeof setTimeout>|undefined;
async function copySecret(text:string){
 await navigator.clipboard.writeText(text);
 clearTimeout(clipboardTimer);
 clipboardTimer=setTimeout(()=>{void navigator.clipboard.readText().then(current=>{if(current===text)return navigator.clipboard.writeText('');}).catch(()=>navigator.clipboard.writeText('').catch(()=>{}));},60_000);
}
let showSecret=false;
function resetChatHistory() {
 chatVisible = CHAT_BATCH;
 chatEnd = '';
}
function chat(){
 const channels=channelList(snapshot!,{includeClosed:true});const open=channels.filter(c=>!c.closed);const channelOf=messageChannels(snapshot!);
 if(chatChannel!==GENERAL&&!channels.some(c=>c.id===chatChannel))chatChannel=GENERAL;
 const seenKey=(id:string)=>`rai.chat.seen.${community}.${id}`;
 const seen = new Map([GENERAL,...channels.map(channel=>channel.id)].map(id=>[id,Number(localStorage.getItem(seenKey(id))||0)]));
 const unread = new Map<string,number>();
 const populated = new Set<string>();
 const messages: EventView[] = [];
 for (const event of snapshot!.events) {
   if (event.data.body.type!=='message') continue;
   const author = memberFor(snapshot!,event)?.data.member_id;
   if (!author||removed(snapshot!,author)) continue;
   const id = channelOf(event.data.body);
   populated.add(id);
   if (id===chatChannel) messages.push(event);
   else if (author!==mine()&&event.timestamp_us>(seen.get(id)??0)) unread.set(id,(unread.get(id)??0)+1);
 }
 const current=channels.find(c=>c.id===chatChannel);
 messages.sort((a,b)=>a.timestamp_us-b.timestamp_us||a.hash.localeCompare(b.hash));
 const boundary = chatEnd ? messages.findIndex(message=>message.hash===chatEnd) : -1;
 const end = boundary < 0 ? messages.length : boundary + 1;
 const start = Math.max(0,end-chatVisible);
 const shown=messages.slice(start,end);
 const tab=(id:string,name:string,closed=false,adminsOnly=false)=>{const n=unread.get(id)??0;return `<button type="button" data-channel="${e(id)}" ${id===chatChannel?'class="active" aria-current="true"':''}>${closed?'🔒 ':adminsOnly?'📢 ':'# '}${e(name)}${n?` <span class="badge">${n}</span>`:''}</button>`;};
 const closedWithHistory=channels.filter(c=>c.closed&&populated.has(c.id));
 const channelPage=listPage('channels',[...open,...closedWithHistory]);
 const settingsPage=listPage('channelSettings',channels);
 const canWrite=!current?.adminsOnly||admin();
 $('page').innerHTML=`<div class="row"><h2>${t('Community messages','Topluluk mesajları')}</h2>${info(t('About messages','Mesajlar hakkında'),`<p>${t('Channels are text areas for everyone in this community. Organizers with channel permission open and close channels. In 📢 channels only organizers write; everyone reads. Closed channels stay readable.','Kanallar topluluktaki herkesin metin alanlarıdır. Kanal izni olan yöneticiler kanal açar ve kapatır. 📢 kanallara yalnız yöneticiler yazar, herkes okur. Kapatılan kanallar okunabilir kalır.')}</p><p>${t('Messages are shared with network peers. They are not private and cannot be deleted. Do not post passwords, recovery codes or other people’s personal information.','Mesajlar ağdaki eşlerle paylaşılır. Özel değildir ve silinemez. Parola, kurtarma kodu veya başkasının kişisel bilgisini yazma.')}</p><p>${t('If nobody else is online, your message reaches others when someone comes online.','Başka kimse çevrimiçi değilse mesajın, biri çevrimiçi olduğunda diğerlerine ulaşır.')}</p>`)}</div>
 ${symbols()}
 <div class="channel-tabs">${tab(GENERAL,t('General','Genel'))}${current&&!channelPage.items.includes(current)?tab(current.id,current.name,current.closed,current.adminsOnly):''}${channelPage.items.map(c=>tab(c.id,c.name,c.closed,c.adminsOnly)).join('')}</div>
 ${channelPage.pages>1?listPager('channels',channelPage):''}
 ${may('channels')?`<details class="channel-admin" id="channel-management"><summary>${t('Manage channels','Kanalları yönet')}</summary><form id="channel-form" class="card"><h3>${t('New channel','Yeni kanal')}</h3>${field(t('Channel name (up to 60 characters)','Kanal adı (en fazla 60 karakter)'),'channel-name')}<label class="check"><input type="checkbox" id="channel-admins-only">${t('Only organizers write (announcements)','Yalnız yöneticiler yazar (duyuru)')}</label><button class="primary">${t('Open channel','Kanalı aç')}</button></form>${settingsPage.items.map(c=>`<div class="record row between"><label class="inline">${c.closed?'🔒':c.adminsOnly?'📢':'#'}<input id="channel-rename-${e(c.id)}" value="${e(c.name)}" aria-label="${t('Channel name','Kanal adı')}"></label><span class="row"><button type="button" data-rename-channel="${e(c.id)}">${t('Save name','Adı kaydet')}</button><button type="button" data-mode-channel="${e(c.id)}">${c.adminsOnly?t('Let everyone write','Herkes yazsın'):t('Only organizers write','Yalnız yöneticiler yazsın')}</button><button type="button" data-toggle-channel="${e(c.id)}">${c.closed?t('Reopen','Yeniden aç'):t('Close channel','Kanalı kapat')}</button></span></div>`).join('')}${settingsPage.pages>1?listPager('channelSettings',settingsPage):''}</details>`:''}
 <div class="row">${start>0||state.more[chatChannel]?btn(t('Load earlier messages','Önceki mesajları yükle'),'older-messages'):''}${end<messages.length?btn(t('Back to latest messages','Son mesajlara dön'),'latest-messages'):''}</div><div id="chat-messages">${shown.length?shown.map(ev=>`<article class="record" data-message="${e(ev.hash)}" tabindex="-1">${profileLink(memberFor(snapshot!,ev)?.data.member_id)} <time class="muted">${e(new Date(ev.timestamp_us/1000).toLocaleString(language==='tr'?'tr-TR':'en-GB'))}</time><p class="chat-text">${e(ev.data.body.text)}</p>${may('membership')?`<button type="button" class="link" data-copy-message="${e(ev.hash)}">${t('Copy message reference','Mesajın kayıt adresini kopyala')}</button>`:''}</article>`).join(''):`<p>${t('No messages yet. Say hello.','Henüz mesaj yok. Merhaba de.')}</p>`}</div>
 ${current?.closed?`<p class="notice">${t('This channel is closed. You can read its history.','Bu kanal kapatıldı. Geçmişini okuyabilirsin.')}</p>`:!canWrite?`<p class="notice">${t('Only organizers write in this channel.','Bu kanala yalnız yöneticiler yazar.')}</p>`:`<form id="chat-form"><label>${t('Your message (up to 400 characters)','Mesajın (en fazla 400 karakter)')}<textarea id="chat-text" maxlength="800" required></textarea></label><p class="muted" id="chat-count" aria-live="polite"></p><p class="notice">${t('Be courteous. Insults, abusive language and deliberate harm lead to removal from the community.','Nezaketi koru. Hakaret, küfür ve birini bilerek incitmek topluluktan çıkarılma nedenidir.')}</p><p class="muted">${newAccount()?t('New accounts: wait 60 seconds between messages and do not post links during the first 3 days.','Yeni hesaplar: mesajlar arasında 60 saniye bekle; ilk 3 gün bağlantı paylaşma.'):t('Wait at least 5 seconds between messages.','Mesajlar arasında en az 5 saniye bekle.')}</p><button class="primary">${t('Send','Gönder')}</button></form>`}`;
 const chatText=root.querySelector<HTMLTextAreaElement>('#chat-text');
 const chatCount=()=>{if(!chatText)return;const used=Array.from(chatText.value).length;$('chat-count').textContent=t(`${MESSAGE_CHARS-used} characters left`,`${MESSAGE_CHARS-used} karakter kaldı`);$('chat-count').classList.toggle('over',used>MESSAGE_CHARS);};
 chatText?.addEventListener('input',chatCount);chatCount();
 root.querySelectorAll<HTMLButtonElement>('[data-copy-message]').forEach(button=>button.onclick=async()=>{
   try {
     await navigator.clipboard.writeText(button.dataset.copyMessage!);
     button.textContent=t('Reference copied','Kayıt adresi kopyalandı');
   } catch {
     message(t('Could not copy the reference.','Kayıt adresi kopyalanamadı.'));
   }
 });
 const last=messages.at(-1);if(last)localStorage.setItem(seenKey(chatChannel),String(last.timestamp_us));
 root.querySelectorAll<HTMLButtonElement>('[data-channel]').forEach(b=>b.onclick=()=>{chatChannel=b.dataset.channel!;localStorage.setItem('rai.chat.channel',chatChannel);resetChatHistory();chat();});
 root.querySelector<HTMLButtonElement>('#older-messages')?.addEventListener('click',async()=>{
   const anchor = [...root.querySelectorAll<HTMLElement>('[data-message]')].find(item=>item.getBoundingClientRect().bottom>0);
   const top = anchor?.getBoundingClientRect().top ?? 0;
   const saved = drafts();
   const managementOpen = root.querySelector<HTMLDetailsElement>('#channel-management')?.open;
   // Older messages beyond what is loaded come from the network, 50 at a time.
   if (start===0 && state.more[chatChannel] && api) {
     try { state = await olderMessages(api,community,state,chatChannel); applyView(); } catch (error) { message(String((error as Error)?.message||error)); }
     if (chatVisible<CHAT_LIMIT) chatVisible += CHAT_BATCH;
   } else if (chatVisible<CHAT_LIMIT) chatVisible += CHAT_BATCH;
   else chatEnd = messages[end-Math.min(CHAT_BATCH,start)-1].hash;
   chat();
   restoreDrafts(saved);
   const management = root.querySelector<HTMLDetailsElement>('#channel-management');
   if (management && managementOpen) management.open = true;
   const restored = anchor && root.querySelector<HTMLElement>(`[data-message="${CSS.escape(anchor.dataset.message!)}"]`);
   restored?.focus({preventScroll:true});
   if (restored) window.scrollBy(0,restored.getBoundingClientRect().top-top);
 });
 $('latest-messages')?.addEventListener('click',()=>{
   const saved = drafts();
   resetChatHistory();
   chat();
   restoreDrafts(saved);
   $('chat-messages').scrollIntoView({block:'start'});
 });
 root.querySelector<HTMLFormElement>('#chat-form')?.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{const text=val('chat-text');if(!text||Array.from(text).length>MESSAGE_CHARS)throw Error(t('Write a message of 1–400 characters.','1–400 karakterlik bir mesaj yaz.'));if(!api||!membership)throw Error(t('Join this community first.','Önce topluluğa katıl.'));await api.post(community,membership.hash,text,current?current.hash:null);await refresh({channels:true});});});
 root.querySelector<HTMLFormElement>('#channel-form')?.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{let body;try{body=newChannelBody(val('channel-name'),root.querySelector<HTMLInputElement>('#channel-admins-only')!.checked);}catch{throw Error(t('Enter a channel name of up to 60 characters.','En fazla 60 karakterlik bir kanal adı yaz.'));}await publish(body);chatChannel=body.id;resetChatHistory();localStorage.setItem('rai.chat.channel',chatChannel);await refresh();});});
 const update=(id:string,change:(c:any)=>any)=>run(async()=>{const c=channels.find(c=>c.id===id)!;const next=change(c);if(!next)return;await publish(next);await refresh();});
 root.querySelectorAll<HTMLButtonElement>('[data-toggle-channel]').forEach(b=>b.onclick=()=>update(b.dataset.toggleChannel!,c=>channelBody(c.id,c.name,c.adminsOnly,!c.closed)));
 root.querySelectorAll<HTMLButtonElement>('[data-mode-channel]').forEach(b=>b.onclick=()=>update(b.dataset.modeChannel!,c=>channelBody(c.id,c.name,!c.adminsOnly,c.closed)));
 root.querySelectorAll<HTMLButtonElement>('[data-rename-channel]').forEach(b=>b.onclick=()=>update(b.dataset.renameChannel!,c=>{const name=val('channel-rename-'+c.id);if(!name||Array.from(name).length>60)throw Error(t('Enter a channel name of up to 60 characters.','En fazla 60 karakterlik bir kanal adı yaz.'));return name===c.name?null:channelBody(c.id,name,c.adminsOnly,c.closed);}));
}
function termsScreen(){
 const lang=language==='tr'?'tr':'en';const accepted=acceptedTerms(localStorage);
 $('content').innerHTML=`<section class="card terms"><h1>${t('Terms of use and consent','Kullanım koşulları ve onay')}</h1><p class="muted">${t('Version','Sürüm')} ${e(TERMS_VERSION)}. ${t('Please read before using the app.','Uygulamayı kullanmadan önce lütfen oku.')}</p>${termsText[lang].map(([h,b])=>`<h3>${e(h)}</h3><p>${e(b)}</p>`).join('')}${accepted?`<div class="notice">${t('Accepted on this device','Bu cihazda onaylandı')}: ${e(new Date(accepted.acceptedAt).toLocaleString(language==='tr'?'tr-TR':'en-GB'))}</div>${btn(t('Close','Kapat'),'close-terms',true)}`:`<div class="terms-checks">${termsChecks[lang].map((c,i)=>`<label class="check"><input type="checkbox" id="terms-${i}">${e(c)}</label>`).join('')}</div><div class="row">${btn(t('I accept and continue','Kabul ediyorum, devam et'),'terms-accept',true)}${btn(t('I do not accept','Kabul etmiyorum'),'terms-decline')}</div>`}</section>`;
 root.querySelector<HTMLButtonElement>('#close-terms')?.addEventListener('click',()=>{termsOpen=false;render();});
 root.querySelector<HTMLButtonElement>('#terms-decline')?.addEventListener('click',()=>message(t('The app cannot be used without accepting the terms. You can close it now.','Koşullar kabul edilmeden uygulama kullanılamaz. Uygulamayı şimdi kapatabilirsin.')));
 root.querySelector<HTMLButtonElement>('#terms-accept')?.addEventListener('click',()=>{if(termsChecks[lang].some((_,i)=>!root.querySelector<HTMLInputElement>('#terms-'+i)!.checked)){message(t('Tick every statement to continue.','Devam etmek için bütün maddeleri işaretle.'));return;}acceptTerms(localStorage);termsOpen=false;notice='';updateHostingClock();render();scheduleRelease();scheduleHosting();});
}
function recoveryLookup(address:string) {
  return run(async()=>{
    restorePreview = null;
    const s = await checkedCommunity(address);
    const old = memberCurrent(s,pending.memberId);
    if (!old) throw Error(t('This account is not available at this address yet. Check that the address belongs to your community and try again when another member is online.','Hesap bu adreste henüz bulunamadı. Adresin kendi topluluğuna ait olduğunu kontrol et ve başka bir üye çevrimiçiyken tekrar dene.'));
    if (old.device===device) {
      community = address;
      pending = null;
      await refresh();
      notice = '';
      return;
    }
    // 0.4: the previous device's published chain length is the cutoff (one network read).
    const head = await api!.call<number|null>('device_chain_head',old.device,15_000).catch(()=>null);
    const cutoff = Math.max(old.sequence, head ?? 0);
    restorePreview = {address,old,cutoff,records:cutoff+1};
    notice = '';
  });
}

function onboard(){
 const content=$('content');
 if (pending?.restoring) {
  content.innerHTML = `<h1>${t('Sign in to your existing account','Mevcut hesabına giriş yap')}</h1>
    <p>${t('Enter the public address of the community you previously joined.','Daha önce katıldığın topluluğun herkese açık adresini gir.')}</p>
    <form id="recover-form">${field(t('Public community address','Herkese açık topluluk adresi'),'recover-community',restorePreview?.address||pending.address||community)}
      <button class="primary">${t('Find my account','Hesabımı bul')}</button> ${btn(t('Back','Geri'),'cancel-recovery')}
    </form>
    ${restorePreview?`<div class="notice warning"><strong>${e(restorePreview.old.data.name)}</strong>
      <p>${t('Actions of the previous device','Önceki cihazın işlemleri')}: ${restorePreview.records}. ${t('If anything is missing, find your account again after the records sync. Signing in moves access from the previous device to this device.','Bir şey eksikse kayıtlar eşitlendikten sonra hesabını tekrar bul. Giriş yaptığında erişim önceki cihazdan bu cihaza geçer.')}</p>
      ${btn(t('Confirm and sign in','Onayla ve giriş yap'),'confirm-recovery',true)}</div>`:''}`;
  $('cancel-recovery').onclick = ()=>{pending=null;restorePreview=null;notice='';render();};
  $('recover-form').onsubmit = event=>{event.preventDefault();void recoveryLookup(val('recover-community'));};
  if (restorePreview) {
    $('recover-community').oninput = ()=>{ $('confirm-recovery').setAttribute('disabled',''); };
    $('confirm-recovery').onclick = ()=>run(async()=>{
      const {address,old,cutoff} = restorePreview;
      const s = await checkedCommunity(address);
      const head = await api!.call<number|null>('device_chain_head',old.device,15_000).catch(()=>null);
      if (memberCurrent(s,pending.memberId)?.hash!==old.hash || (head ?? 0) > cutoff) {
        restorePreview=null;
        throw Error(t('Your account history has changed. Find your account again and review it before signing in.','Hesap geçmişin değişti. Giriş yapmadan önce hesabını tekrar bul ve geçmişi kontrol et.'));
      }
      community=address;
      await bindPending(old.data.name,null,old,cutoff);
      restorePreview=null;
      notice='';
    });
  }
  return;
 }
 if (pending) {
  const verified = backupConfirmed;
  content.innerHTML = `<h1>${t('Protect your membership','Üyeliğini koru')}</h1>
    <details class="card" ${verified?'':'open'}><summary>${verified?t('Backup verified · view recovery code','Yedek doğrulandı · kurtarma kodunu gör'):t('Save your recovery code','Kurtarma kodunu kaydet')}</summary>
      <p class="notice warning">${e(recoveryWarning(language))}</p>
      <p>${t('Save this code somewhere safe outside this device.','Kodu bu cihazın dışında güvenli bir yere kaydet.')}</p>
      ${showSecret?`<pre class="secret">${e(pending.code)}</pre>`:`<p class="muted">${t('The code is hidden. Show it only when nobody can see your screen.','Kod gizli. Yalnız ekranını kimse görmüyorken göster.')}</p>`}
      <div class="row">${btn(showSecret?t('Hide code','Kodu gizle'):t('Show code','Kodu göster'),'toggle-secret')}${btn(t('Copy code','Kodu kopyala'),'copy-secret')}${btn(t('Save private recovery file','Gizli kurtarma dosyasını kaydet'),'save-code')}</div>
      <p class="muted">${t('A copied code is removed from the clipboard after 60 seconds.','Kopyalanan kod 60 saniye sonra panodan silinir.')}</p>
      ${verified?'':`<label>${t('Enter the saved recovery code again','Kaydettiğin kurtarma kodunu tekrar gir')}<input id="confirm-code" type="password" autocomplete="off"></label>
      <label class="check"><input id="loss-ack" type="checkbox">${t('I understand that losing both the device and code permanently loses access.','Cihazı ve kodu birlikte kaybedersem erişimi kalıcı olarak kaybedeceğimi anlıyorum.')}</label>
      ${btn(t('Verify my backup','Yedeğimi doğrula'),'verify-backup',true)}`}
    </details>
    ${verified?`${field(t('Display name','Görünen ad'),'join-name',pending.name||'')}
      ${pending.organizer?`${field(t('Community name','Topluluk adı'),'new-community','Rai Community')}
        ${btn(t('Create community','Topluluk oluştur'),'create-community',true)}`
      :`${field(t('Invitation code (RAI-INVITE…)','Davet kodu (RAI-INVITE…)'),'join-community',pending.invite||community)}
        ${btn(t('Join community','Topluluğa katıl'),'join',true)}`}`:''}
    ${btn(t('Back','Geri'),'cancel-join')}`;
  $('cancel-join').onclick=()=>{pending=null;backupConfirmed=false;notice='';render();};
  $('save-code').onclick=()=>download('rai-private-recovery.txt',pending.code+'\n'+JSON.stringify({community:community||null,name:pending.name||null}));
  $('toggle-secret').onclick=()=>{showSecret=!showSecret;onboard();};
  $('copy-secret').onclick=()=>run(async()=>{await copySecret(pending.code);notice=t('Recovery code copied. It is removed from the clipboard in 60 seconds.','Kurtarma kodu kopyalandı. 60 saniye sonra panodan silinir.');});
  root.querySelector<HTMLButtonElement>('#verify-backup')?.addEventListener('click',()=>run(async()=>{
    if(val('confirm-code')!==pending.code||!root.querySelector<HTMLInputElement>('#loss-ack')!.checked)
      throw Error(t('Confirm the saved code and acknowledge the loss condition.','Kaydettiğin kodu ve kayıp koşulunu doğrula.'));
    backupConfirmed=true;
  }));
  root.querySelector<HTMLButtonElement>('#join')?.addEventListener('click',()=>run(async()=>{
    const target=await joinTarget(val('join-community'));
    community=target.address;
    await bindPending(val('join-name'),target.s,undefined,undefined,target.via);
    notice='';
  }));
  root.querySelector<HTMLButtonElement>('#create-community')?.addEventListener('click',()=>run(async()=>{
    const name=val('join-name');
    if(!name||bytes(name)>100)throw nameLengthError(name);
    community=await api!.create(val('new-community'),pending.memberId);
    await bindPending(name);
    for(const goal of starterGoals)await publish(goal);
    await refresh();
  }));
  return;
 }
 content.innerHTML = `<h1>${t('Welcome to Rai Community','Rai Community’ye hoş geldin')}</h1>
   <p class="notice">${t('Used Rai Community before? Sign in with your existing recovery code to pick up where you left off. Your account is already set up.','Rai Community’yi daha önce kullandıysan kurtarma kodunla mevcut hesabına giriş yapıp kaldığın yerden devam edebilirsin. Yeni hesap açmana gerek yok.')}</p>
   <section class="card">
     <div class="row"><h2>${t('Already have a recovery code?','Zaten kurtarma kodun var mı?')}</h2>
       ${info(t('How to use your recovery code','Kurtarma kodu nasıl kullanılır?'),`<p>${t('If you previously created an account and saved its code, paste that same code here to continue with your existing account. Keep the code private.','Daha önce hesap açıp kodunu kaydettiysen aynı kodu buraya yapıştırarak mevcut hesabınla devam edebilirsin. Kodunu kimseyle paylaşma.')}</p>`)}</div>
     <form id="import-form">${field(t('Your private recovery code','Gizli kurtarma kodun'),'old-code','','password')}
       <button class="primary">${t('Sign in with recovery code','Kurtarma koduyla mevcut hesabına giriş yap')}</button>
     </form>
   </section>
   <section class="card"><h2>${t('Create an account','Yeni hesap aç')}</h2>
     ${field(t('Your display name','Görünen adın'),'entry-name')}
     ${field(t('Invitation code (RAI-INVITE…)','Davet kodu (RAI-INVITE…)'),'entry-community','')}
     <p class="muted">${t('Ask a member for an invitation code. If the founder opened the community, its public address is enough.','Bir üyeden davet kodu iste. Kurucu topluluğu açtıysa herkese açık adres yeterli.')}</p>
     ${btn(t('Continue to community','Topluluğa katılmaya devam et'),'new-code',true)}
     <div class="organizer-entry">
       ${btn(t('Create a new community','Yeni topluluk oluştur'),'new-organizer-code')}
     </div>
   </section>`;
 $('new-code').onclick=()=>run(async()=>{
   const name=val('entry-name'), code=val('entry-community');
   if(!name||bytes(name)>100)throw nameLengthError(name);
   const target=await joinTarget(code);
   if(nameTaken(target.s,name,null))throw nameTakenError();
   pending={...await newRecovery(),name,invite:code};
   community=target.address;
   showSecret=false;
   backupConfirmed=false;
   notice='';
 });
 $('new-organizer-code').onclick=()=>run(async()=>{
   pending={...await newRecovery(),organizer:true,name:val('entry-name')};
   backupConfirmed=false;
 });
 $('import-form').onsubmit=event=>{
   event.preventDefault();
   void run(async()=>{
     let recovery;
     try { recovery=await readRecovery(val('old-code')); }
     catch { throw Error(t('The recovery code is invalid. Copy the entire saved code and try again.','Kurtarma kodu geçersiz. Kaydettiğin kodun tamamını kopyalayıp tekrar dene.')); }
     let address=community;
     try {
       const bindings=await api!.call<MemberView[]>('locate_memberships',recovery.memberId,4_000);
       const communities=[...new Set(bindings.map(b=>b.data.community))];
       if(communities.length===1)address=communities[0];
     } catch { /* The member can enter the address when lookup is unavailable. */ }
     pending={...recovery,address,restoring:true};
     backupConfirmed=false;
   });
 };
}
const nameLengthError=(name:string)=>Error(name
 ?t('Enter a shorter display name.','Daha kısa bir görünen ad yaz.')
 :t('Enter your display name.','Görünen adını yaz.'));
const nameTakenError=()=>Error(t('Another member already uses this display name. Choose a different one (for example add your city or a letter).','Bu görünen adı başka bir üye kullanıyor. Farklı bir ad seç (ör. şehrini veya bir harf ekle).'));
async function bindPending(name:string,current?:Snapshot|null,previous?:MemberView,cutoff?:number,via:{invitation:string|null,gate:string|null}={invitation:null,gate:null}) {
 name=name.trim().replace(/\s+/g,' ');
 if(!name||bytes(name)>100)throw nameLengthError(name);
 if(current&&nameTaken(current,name,pending.memberId))throw nameTakenError();
 const binding={community,member_id:pending.memberId,name,generation:previous?previous.data.generation+1:0,
   previous:previous?.hash??null,previous_cutoff:cutoff??null,invitation:via.invitation,gate:via.gate,recovery_signature:[] as number[]};
 binding.recovery_signature=await signRecovery(pending.key,await api!.challenge(binding));
 await api!.bind(binding);
 pending=null;
 backupConfirmed=false;
 localStorage.setItem('rai.community',community);
 await refresh();
}
function goals(){
 const list = (visibleGoals(snapshot!) as EventView[]).filter(goal=>goal.data.body.id!=='O1');
 const page = listPage('goals',list,8);
 $('page').innerHTML=`<div class="row between"><h2>${t('Make Holochain known beyond tech and crypto','Holochain’i teknoloji ve kripto çevresinin dışına duyurmak')}</h2>${may('goals')?btn(t('Add goal','Hedef ekle'),'add-goal'):''}</div>${communityTrials()}<div id="goal-form"></div>${page.items.map(g=>{const text=displayedGoal(g.data.body,language);return `<article class="card"><h3>${e(text.title)}</h3>${settings.goals.get(g.data.body.id)?`<p class="tag">✓ ${t('Completed','Tamamlandı')}</p>`:''}<p>${t('Target','Hedef')}: ${g.data.body.target===null?'—':e(g.data.body.target)} ${e(g.data.body.unit)} · ${t('Current','Mevcut')}: ${g.data.body.current===null?t('Not measured','Ölçülmedi'):e(g.data.body.current)}</p><p class="muted long-text">${e(text.description)}</p>${may('goals')?`<button data-edit-goal="${g.hash}">${t('Edit','Düzenle')}</button> <button type="button" data-complete-goal="${g.hash}">${settings.goals.get(g.data.body.id)?t('Reopen goal','Yeniden aç'):t('Mark completed','Tamamlandı olarak işaretle')}</button> <button data-remove-goal="${g.hash}">${t('Remove','Kaldır')}</button>`:''}</article>`;}).join('')}${page.pages>1?listPager('goals',page):''}`;
 root.querySelectorAll<HTMLButtonElement>('[data-complete-goal]').forEach(button=>button.onclick=()=>run(async()=>{
   const goal=list.find(g=>g.hash===button.dataset.completeGoal);
   if (!goal || !may('goals')) return;
   const id=goal.data.body.id;
   await publish(settingBody('goal-status',{id,completed:!settings.goals.get(id)}));
   await refresh();
 }));
 bindTrialCard();
 if(may('goals')){if(goalEditorOpen)goalForm(goalDraft,false); $('add-goal').onclick=()=>goalForm(null);root.querySelectorAll<HTMLButtonElement>('[data-edit-goal]').forEach(b=>b.onclick=()=>goalForm(snapshot!.events.find(g=>g.hash===b.dataset.editGoal)!));root.querySelectorAll<HTMLButtonElement>('[data-remove-goal]').forEach(b=>b.onclick=()=>run(async()=>{const g=snapshot!.events.find(g=>g.hash===b.dataset.removeGoal)!;await publish({...g.data.body,archived:true});await refresh();}));}
}
let trialEditing = false;
/** Plan D1: the founder edits both titles, the target and whether the card is visible. */
function communityTrials() {
  const trial = settings.trial;
  if (trial.hidden && !founder()) return '';
  const joined = new Set(snapshot!.members.map(member=>member.data.member_id)).size;
  const target = trial.target;
  const label = `${formatUnyt(joined)} / ${formatUnyt(target)}`;
  const editor = founder() && trialEditing ? `<form id="trial-form" class="card">
      ${field(t('Turkish title','Türkçe başlık'),'trial-tr',trial.title_tr)}
      ${field(t('English title','İngilizce başlık'),'trial-en',trial.title_en)}
      ${field(t('Target number','Hedef sayı'),'trial-target',String(target),'number')}
      <label class="check"><input type="checkbox" id="trial-hidden" ${trial.hidden?'checked':''}>${t('Hide the card from members','Kartı üyelerden gizle')}</label>
      <div class="row"><button class="primary">${t('Save','Kaydet')}</button>${btn(t('Cancel','Vazgeç'),'trial-cancel')}</div>
    </form>` : '';
  return `<article class="card community-trial-goal">
    <div class="row between"><h3>${e(language==='tr'?trial.title_tr:trial.title_en)}</h3>${trial.hidden?`<span class="tag">${t('Hidden','Gizli')}</span>`:''}${founder()&&!trialEditing?btn(t('Edit','Düzenle'),'trial-edit'):''}</div>
    <p><strong>${e(label)}</strong>${joined>=target?` · ${t('Completed','Tamamlandı')}`:''}</p>
    <progress value="${Math.min(joined,target)}" max="${target}" aria-label="${e(label)}"></progress>
    <p class="muted">${t('Counts accounts that have joined. Each account counts once across devices.','Topluluğa katılmış hesaplar sayılır. Bir hesap, farklı cihazlarda kullanılsa da bir kez sayılır.')}</p>
    ${editor}
  </article>`;
}
function bindTrialCard() {
  root.querySelector<HTMLButtonElement>('#trial-edit')?.addEventListener('click',()=>{trialEditing=true;render();});
  root.querySelector<HTMLButtonElement>('#trial-cancel')?.addEventListener('click',()=>{trialEditing=false;render();});
  root.querySelector<HTMLFormElement>('#trial-form')?.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    const title_tr=val('trial-tr'),title_en=val('trial-en'),target=Number(val('trial-target'));
    if(!title_tr||!title_en||Array.from(title_tr).length>120||Array.from(title_en).length>120)throw Error(t('Enter both titles (up to 120 characters).','İki başlığı da yaz (en fazla 120 karakter).'));
    if(!Number.isInteger(target)||target<1||target>100_000_000)throw Error(t('Enter a whole number target.','Hedef için tam sayı gir.'));
    await publish({type:'trial_card',title_tr,title_en,target,hidden:root.querySelector<HTMLInputElement>('#trial-hidden')!.checked});
    trialEditing=false;await refresh({gov:true});
  });});
}
/** Plan D3: one definition of every badge series; titles per level. */
const seriesLabel:Record<string,()=>string>={contribution:()=>t('Task participation','Görevlere katılım'),hosting:()=>t('Hosting','Barındırma'),memory:()=>t('Network memory','Ağın hafızası'),invites:()=>t('Invitations','Davetler')};
function badgeTitle(series:string,n:number){
  if(series==='contribution')return n===1?t('First contribution','İlk katkı'):n===5?t('Regular contributor','Düzenli katkı'):t(`${n} tasks contributed to`,`${n} göreve katkı`);
  if(series==='hosting')return n===10?t('Keeps us online','Ağı açık tutan'):t(`${n} verified hours`,`${n} doğrulanmış saat`);
  if(series==='memory')return t(`Network memory · ${n} full-copy hours`,`Ağın hafızası · ${n} tam kopya saati`);
  return n===1?t('First invitation that contributed','Katkı yapan ilk davet'):t(`${n} invited contributors`,`Davet ettiği ${n} katkıcı`);
}
/** Plan D2: profile and badges, shared by the Account screen and other members' read-only profiles. */
function profileCard(id:string, own:boolean){
  const progress = badgeProgress(badgeCounts(snapshot!,id));
  const series = (p:ReturnType<typeof badgeProgress>[number])=>{
    const earned = p.earned.at(-1);
    return `<div class="profile-badge">
      <h3>${e(seriesLabel[p.series]())}</h3>
      ${earned?`<p class="tag">${e(badgeTitle(p.series,earned))}</p>`:`<p class="muted">${t('No badge yet.','Henüz rozet yok.')}</p>`}
      ${own&&p.next?`<p class="muted">${t('Next badge','Sıradaki rozet')} · ${e(badgeTitle(p.series,p.next))} · ${formatUnyt(p.count)} / ${formatUnyt(p.next)}</p>`:''}
    </div>`;
  };
  const counts = badgeCounts(snapshot!,id);
  return `<section class="card" aria-labelledby="profile-title-${e(id)}">
    <h2 id="profile-title-${e(id)}">${memberName(id)}</h2>
    <dl class="hosting-stats">
      <div><dt>${t('Tasks contributed to','Katkı verilen görev')}</dt><dd>${formatUnyt(counts.contribution)}</dd></div>
      <div><dt>${t('Verified hosting hours','Doğrulanmış barındırma saati')}</dt><dd>${formatUnyt(counts.hosting)}</dd></div>
      <div><dt>${t('Full-copy hours','Tam kopya saati')}</dt><dd>${formatUnyt(counts.memory)}</dd></div>
    </dl>
    <div class="row"><h3>${t('Badges','Rozetler')}</h3>${info(t('How badges are earned','Rozetler nasıl kazanılır?'),`<p>${t(
      'Contribution badges count different tasks with a valid report. Hosting badges count verified hosting hours; network memory badges count verified full-copy hours. Invitation badges count invited members who made a first valid contribution.',
      'Katkı rozetleri geçerli katkı bildirimi bulunan farklı görevleri, barındırma rozetleri doğrulanmış saatleri, ağın hafızası rozetleri doğrulanmış tam kopya saatlerini sayar. Davet rozetleri ilk geçerli katkısını yapan davetlileri sayar.',
    )}</p>`)}</div>
    <div class="grid">${progress.map(series).join('')}</div>
  </section>`;
}
/** Plan D3: every badge that can be earned; earned ones marked, others faded with progress. */
function allBadges(id:string){
  const progress = badgeProgress(badgeCounts(snapshot!,id));
  return `<details class="card" id="all-badges"><summary>${t('All badges','Bütün rozetler')}</summary>
    ${progress.map(p=>`<h3>${e(seriesLabel[p.series]())}</h3><ul class="badge-list">${p.thresholds.map(n=>{
      const earned=p.count>=n;
      return `<li class="${earned?'earned':'locked'}"><span aria-hidden="true">${earned?'✓':'○'}</span> ${e(badgeTitle(p.series,n))}${earned?'':` · ${formatUnyt(Math.min(p.count,n))} / ${formatUnyt(n)}`}</li>`;
    }).join('')}</ul>`).join('')}
  </details>`;
}
function profile() {
  const member = memberCurrent(snapshot!,profileMember);
  const back = `<button type="button" id="back-from-profile" data-page="${e(profileFrom)}">${t('Back','Geri')}</button>`;
  if (!member) {
    $('page').innerHTML = `${back}<p>${t('Member not found.','Üye bulunamadı.')}</p>`;
    return;
  }
  $('page').innerHTML = `${back}${profileCard(profileMember,profileMember===mine())}`;
}
function goalForm(goal:EventView|null,reveal=true) {
 if(reveal)goalEditLanguage=language;
 goalDraft=goal;
 goalEditorOpen=true;
 const body=goal?.data.body;
 const translations=goalTranslations(body,goalEditLanguage);
 $('goal-form').innerHTML=`<form id="goal-edit" class="card">
  <h3>${goal?t('Edit goal','Hedefi düzenle'):t('Add goal','Hedef ekle')}</h3>
  <div class="grid">
   ${(['en','tr'] as const).map(lang=>`<div>
    ${field(lang==='en'?t('Title (English)','Başlık (İngilizce)'):t('Title (Turkish)','Başlık (Türkçe)'),`goal-title-${lang}`,translations[lang].title)}
    <label>${lang==='en'?t('Description (English)','Açıklama (İngilizce)'):t('Description (Turkish)','Açıklama (Türkçe)')}
    <textarea id="goal-context-${lang}" rows="4">${e(translations[lang].description)}</textarea></label>
   </div>`).join('')}
  </div>
  ${field(t('Target number (optional)','Hedef sayı (isteğe bağlı)'),'goal-target',body?.target?.toString()??'','number')}
  ${field(t('Current number (blank = not measured)','Mevcut sayı (boş = ölçülmedi)'),'goal-current',body?.current?.toString()??'','number')}
  ${field(t('Unit','Birim'),'goal-unit',body?.unit??'')}
  <button class="primary">${t('Save','Kaydet')}</button> ${btn(t('Cancel','Vazgeç'),'cancel-goal')}
 </form>`;
 $('cancel-goal').onclick=()=>{goalEditorOpen=false;goalDraft=null;render();};
 if(reveal) {
  $('goal-form').scrollIntoView({block:'start'});
  $(`goal-title-${language}`).focus({preventScroll:true});
 }
 root.querySelector<HTMLFormElement>('#goal-edit')!.onsubmit=event=>{
  event.preventDefault();
  void run(async()=>{
   const number=(id:string)=>{
    const raw=val(id);
    if(!raw)return null;
    const parsed=Number(raw);
    if(!Number.isSafeInteger(parsed)||parsed<0)
      throw Error(t('Use non-negative whole numbers for the target and current value.','Hedef ve mevcut değer için sıfır veya pozitif tam sayı kullan.'));
    return parsed;
   };
   const content=(lang:string)=>({title:val(`goal-title-${lang}`),description:val(`goal-context-${lang}`)});
   let text;
   try { text=goalContent(content('en'),content('tr'),body); }
   catch(error) {
    const key=(error as Error).message;
    throw Error(key==='goal-title-required' ? t('Enter a title in at least one language.','En az bir dilde başlık gir.')
      : key==='goal-title-length' ? t('Shorten the goal title.','Hedef başlığını kısalt.')
      : t('Shorten the goal descriptions so both languages fit.','Her iki dilin metni sığacak şekilde hedef açıklamalarını kısalt.'));
   }
   const unit=val('goal-unit');
   if(bytes(unit)>100)throw Error(t('Shorten the unit.','Birim metnini kısalt.'));
   await publish({type:'goal',id:body?.id??crypto.randomUUID(),...text,target:number('goal-target'),current:number('goal-current'),unit,archived:false});
   goalDraft=null;
   goalEditorOpen=false;
   await refresh();
  });
 };
}
/** First binding time of the signed-in member (account age survives recovery). */
function accountStart(id=mine()){
 const times=(snapshot?.members??[]).filter(m=>m.data.member_id===id).map(m=>m.timestamp_us);
 return times.length?Math.min(...times):Date.now()*1000;
}
/** Plan I: the first 3 days are slower (60 s between messages, no links). */
const newAccount=()=>!!membership&&!founder()&&Date.now()*1000-accountStart()<3*86_400_000_000;
let lastInvite='';
let inviteWarning='';
let inviteWarningTimer:ReturnType<typeof setTimeout>|undefined;
function clearInviteWarning() {
 clearTimeout(inviteWarningTimer);
 inviteWarning='';
 const warning=$('invite-warning');
 if(warning)warning.textContent='';
}
function showInviteWarning(text:string) {
 clearInviteWarning();
 inviteWarning=text;
 const warning=$('invite-warning');
 if(warning)warning.textContent=text;
 inviteWarningTimer=setTimeout(clearInviteWarning,8_000);
}
function invitationWait() {
 return t(`You can create an invitation once you’ve been a member for ${settings.quota.wait_days} days.`,
   `Üyeliğinin üzerinden ${settings.quota.wait_days} gün geçince davet kodu üretebilirsin.`);
}
function invitesSection(){
 const invites=(snapshot as any)?.invites??[];
 const used=new Set((snapshot?.members??[]).map(m=>m.data.invitation).filter(Boolean));
 const now=Date.now()*1000;
 const quota=settings.quota;
 const waitLeft=Math.max(0,accountStart()+quota.wait_days*86_400_000_000-now);
 const paused=!founder()&&!may('membership')&&(!settings.invites.membersCanInvite||settings.inviteAccess.get(mine())===false);
 const status=founder()?t('As founder you can invite without a limit.','Kurucu olarak sınırsız davet edebilirsin.')
   :paused?t('Invitations are paused for you or for the community. An organizer can turn them back on.','Davet hakkın ya da topluluktaki üye davetleri durdurulmuş. Bir yönetici yeniden açabilir.')
   :admin()?t(`Organizers can create up to ${quota.organizer_per_week} invitations a week.`,`Yöneticiler haftada en çok ${quota.organizer_per_week} davet üretebilir.`)
   :quota.wait_days>0&&waitLeft>0?''
   :t(`You can create up to ${quota.per_week} invitations a week.`,`Haftada en çok ${quota.per_week} davet üretebilirsin.`);
 return `<section class="card" aria-labelledby="invite-title"><div class="row"><h3 id="invite-title">${t('Invite someone','Birini davet et')}</h3>${info(t('How invitations work','Davetler nasıl çalışır?'),`<p>${t('An invitation is single-use and valid for 7 days. Send the code privately to one person. Organizers can see who invited whom; if two people you invited are removed, your invitation right pauses until an organizer turns it back on.','Davet tek kullanımlıktır ve 7 gün geçerlidir. Kodu tek bir kişiye özelden gönder. Yöneticiler kimin kimi davet ettiğini görebilir; davet ettiğin iki kişi çıkarılırsa davet hakkın bir yönetici yeniden açana kadar durur.')}</p>`)}</div>
   ${status?`<p class="muted">${e(status)}</p>`:''}
   ${btn(t('Create invitation code','Davet kodu üret'),'create-invite',true)}
   <p id="invite-warning" class="notice warning" role="alert">${e(inviteWarning)}</p>
   ${lastInvite?`<p>${t('Send this code to one person:','Bu kodu tek bir kişiye gönder:')}</p><pre id="invite-code">${e(lastInvite)}</pre>${btn(t('Copy code','Kodu kopyala'),'copy-invite')}`:''}
   ${invites.length?`<details><summary>${t('My invitations','Davetlerim')} (${invites.length})</summary><ul>${invites.slice().reverse().slice(0,20).map((i:any)=>`<li>${e(new Date(i.timestamp_us/1000).toLocaleDateString(language==='tr'?'tr-TR':'en-GB'))} · ${used.has(i.hash)?t('Used','Kullanıldı'):i.data.expires_at_us<now?t('Expired','Süresi doldu'):t('Waiting','Bekliyor')}</li>`).join('')}</ul></details>`:''}
 </section>`;
}
function deviceSection(){
 if(!shell)return '';
 const n=networkSettings;
 if(!n)return `<section class="card"><p class="muted">${t('Loading device settings…','Cihaz ayarları yükleniyor…')}</p></section>`;
 return `<section class="card" aria-labelledby="device-title"><div class="row"><h3 id="device-title">${t('This device','Bu cihaz')}</h3>${info(t('Full copy','Tam kopya'),`<p>${e(fullCopyText())}</p><p>${t('Full copy is on by default. You can turn it off to reduce disk and network use. A full copy uses more disk space and bandwidth; the disk use grows with the community (roughly a few hundred megabytes for a large community).','Tam kopya varsayılan olarak açıktır. Disk ve internet kullanımını azaltmak için kapatabilirsin. Tam kopya daha çok disk ve internet kullanır; disk kullanımı topluluk büyüdükçe artar (büyük bir toplulukta kabaca birkaç yüz megabayt).')}</p>`)}</div>
   ${n.fullCopy?'':`<p class="notice">${t('If your computer can handle it, keep a full copy and become part of the network’s memory.','Bilgisayarın uygunsa tam kopya tutarak ağın hafızası olabilirsin.')}</p>`}
   <form id="device-form">
    <label class="check"><input type="checkbox" id="full-copy" ${n.fullCopy?'checked':''}>${t('Keep a full copy of the shared data','Ortak verinin tam kopyasını tut')}</label>
    <p class="muted">${t('Verified full-copy hours earn +3 RaiUnyt each and “Network memory” badges.','Doğrulanan her tam kopya saati +3 RaiUnyt ve “Ağın hafızası” rozetleri kazandırır.')}</p>
    <details><summary>${t('Network servers (advanced)','Ağ sunucuları (ileri düzey)')}</summary>
     <p class="muted">${t('Leave empty to use the default. Change only when the community announces new servers.','Varsayılanı kullanmak için boş bırak. Yalnız topluluk yeni sunucu duyurduğunda değiştir.')}</p>
     ${field(t('Bootstrap address (https)','Bootstrap adresi (https)'),'bootstrap-url',n.bootstrapUrl||'','url')}
     ${field(t('Relay address (https)','Relay adresi (https)'),'relay-url',n.relayUrl||'','url')}
     <p class="muted">${t('Default','Varsayılan')}: ${e(n.defaults?.bootstrapUrl??'')}</p>
    </details>
    <button class="primary">${t('Save and restart','Kaydet ve yeniden başlat')}</button>
   </form>
 </section>`;
}
function account(){
 if(shell&&!networkSettings)void loadNetworkSettings().then(()=>{if(networkSettings&&screen==='account'&&!dirty)account();});
 const ownClaims=listPage('xHistory',snapshot!.events.filter(ev=>ev.data.body.type==='x_claim'&&memberFor(snapshot,ev)?.data.member_id===mine()).reverse());const checks=snapshot!.events.filter(ev=>ev.data.body.type==='x_verify'&&eligibleEvent(snapshot,ev));
 $('page').innerHTML=`${profileCard(mine(),true)}${allBadges(mine())}${invitesSection()}${deviceSection()}
 <section class="card"><div class="row"><h2>${t('Link your X account','X hesabını bağla')}</h2>${info(t('Why link X?','X neden bağlanır?'),`<p>${t('Reviewers need to know which X account is yours to see the actions you report. You prove it once by posting a public code from your own account. The public code is not your recovery code; never share the recovery code.','Kontrolcülerin bildirdiğin eylemleri görebilmesi için hangi X hesabının senin olduğunu bilmeleri gerekir. Bunu bir kez, kendi hesabından herkese açık bir kod paylaşarak kanıtlarsın. Bu kod kurtarma kodun değildir; kurtarma kodunu asla paylaşma.')}</p><p>${t('Example username: RaiTurk_ · example link: https://x.com/RaiTurk_/status/123','Örnek kullanıcı adı: RaiTurk_ · örnek bağlantı: https://x.com/RaiTurk_/status/123')}</p>`)}</div><p>${t('Post a one-time public verification message from your own account. A reviewer checks it. Never publish your recovery code.','Kendi hesabından bir defalık doğrulama gönderisi paylaş. Kontrolcü gönderiye bakar. Kurtarma kodunu asla paylaşma.')}</p>${field(t('X handle (without @)','X kullanıcı adı (@ olmadan)'),'x-handle')}<p>${t('Public verification text','Herkese açık doğrulama metni')}:</p><pre id="public-challenge"></pre>${btn(t('Generate a public code','Herkese açık kod üret'),'generate-x')}<label>${t('Your verification post link','Doğrulama gönderinin bağlantısı')}<input id="x-post" type="url"></label>${btn(t('Request account verification','Hesap doğrulaması iste'),'submit-x',true)}${ownClaims.items.map(x=>`<div class="record"><strong>@${e(x.data.body.handle)}</strong><p>${checks.some(v=>v.data.body.claim===x.hash)?t('Peer-attested account link','Peer tarafından onaylanan hesap bağlantısı'):t('Waiting for peer check','Peer kontrolü bekliyor')}</p>${safeLink(x.data.body.post_url,t('Open public post','Gönderiyi aç'))}</div>`).join('')}${ownClaims.pages>1?listPager('xHistory',ownClaims,true):''}</section>
 <section class="card">
 <div class="row membership-heading">
   <h3>${t('Membership and recovery','Üyelik ve kurtarma')}</h3>
   ${info(t('Membership ID, community address and recovery code','Üyelik kimliği, topluluk adresi ve kurtarma kodu'),`
     <p>${t('Your membership ID is public. It identifies your account and keeps your contributions, roles and verified hosting hours linked to it when you change devices. The ID alone cannot open your account.','Üyelik kimliğin paylaşılabilir. Hesabını tanımlar ve cihaz değiştirdiğinde katkılarının, rollerinin ve doğrulanmış barındırma saatlerinin aynı hesaba bağlı kalmasını sağlar. Kimlik tek başına hesabına erişim vermez.')}</p>
     <p>${t('The public community address identifies this community. New members also need an invitation code unless the founder opened the community.','Herkese açık topluluk adresi bu topluluğu tanımlar. Kurucu topluluğu açmadıysa yeni üyelerin ayrıca davet koduna ihtiyacı vardır.')}</p>
     <p>${t('Look for <code>rai-recovery-v1.</code> at the start of your recovery code. It proves the account is yours when you sign in on a new device. Anyone with the code can take over your account.','Kurtarma kodun <code>rai-recovery-v1.</code> ile başlar. Yeni cihazda giriş yaparken hesabın sana ait olduğunu kanıtlar. Bu kodu bilen biri hesabını devralabilir.')}</p>`)}
 </div>
 <p id="membership-id-label"><strong>${t('Membership ID (public)','Üyelik kimliği (paylaşılabilir)')}</strong></p>
 <pre aria-labelledby="membership-id-label">${e(mine())}</pre>
 ${field(t('Public community address','Herkese açık topluluk adresi'),'public-community',community)}
 <p class="muted"><strong>${t('Recovery code (private)','Kurtarma kodu (gizli)')}</strong><br>${t('Keep your backup and never share it. Use it to sign in on a new device.','Yedeğini sakla ve kimseyle paylaşma. Yeni cihazda giriş yapmak için kullan.')}</p>
 </section>`;
 $('public-challenge').textContent=publicChallenge;$('generate-x').onclick=()=>{publicChallenge='rai-'+mine().slice(0,12)+'-'+crypto.randomUUID();$('public-challenge').textContent=publicChallenge;};$('submit-x').onclick=()=>run(async()=>{if(!publicChallenge)throw Error(t('Generate and publish the public code first.','Önce herkese açık kodu üret ve paylaş.'));let claim;try{claim=prepareXClaim(val('x-handle'),val('x-post'),publicChallenge,mine());}catch(error){const messages:Record<string,string>={handle:t('Enter your X username, for example RaiTurk_.','X kullanıcı adını yaz; örnek: RaiTurk_.'),url:t('Paste your verification post link: https://x.com/username/status/123','Doğrulama gönderisinin bağlantısını yapıştır: https://x.com/kullanici/status/123'),owner:t('The post author must match the X username you entered.','Gönderinin sahibi, yazdığın X kullanıcı adıyla aynı olmalı.'),challenge:t('Generate a public code for this membership and publish it first.','Bu üyelik için herkese açık kod üretip önce onu paylaş.')};throw Error(messages[(error as Error).message]||String(error));}await publish(claim);await refresh();});
 root.querySelector<HTMLButtonElement>('#create-invite')?.addEventListener('click',()=>{
   if(busy)return;
   clearInviteWarning();
   if(!admin()&&settings.quota.wait_days>0&&Date.now()*1000-accountStart()<settings.quota.wait_days*86_400_000_000) {
     showInviteWarning(invitationWait());
     return;
   }
   void run(async()=>{
     try {
       const token=await api!.invite(community,membership!.hash);
       lastInvite=formatInvite(token.community,token.invitation);
     } catch(error) {
       const detail=String(error);
       showInviteWarning(/New members invite after their first week/i.test(detail) ? invitationWait()
         : /Weekly invitation limit reached/i.test(detail) ? t('You have reached your weekly invitation limit.','Haftalık davet sınırına ulaştın.')
         : /invitation right is paused/i.test(detail) ? t('Invitations are paused. Ask an organizer about your invitation access.','Davetler durdurulmuş. Davet hakkını bir yöneticiye sorabilirsin.')
         : t('The invitation code could not be created. Try again.','Davet kodu üretilemedi. Tekrar dene.'));
       return;
     }
     await refresh({mine:true});
   },{preserveDrafts:true});
 });
 root.querySelector<HTMLButtonElement>('#copy-invite')?.addEventListener('click',()=>run(async()=>{await navigator.clipboard.writeText(lastInvite);notice=t('Invitation code copied.','Davet kodu kopyalandı.');}));
 root.querySelector<HTMLFormElement>('#device-form')?.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
   const value={fullCopy:root.querySelector<HTMLInputElement>('#full-copy')!.checked,bootstrapUrl:val('bootstrap-url'),relayUrl:val('relay-url')};
   for(const url of [value.bootstrapUrl,value.relayUrl])if(url&&!/^https:\/\/\S+$/.test(url))throw Error(t('Server addresses must start with https://','Sunucu adresleri https:// ile başlamalı'));
   await shell!.setNetwork(value);networkSettings={...networkSettings,...value};
   updateHostingClock();
   message(t('Saved. The app restarts to apply it.','Kaydedildi. Uygulanması için uygulama yeniden başlıyor.'));
   await shell!.restart();
 });});
}
function tasks(){
 const list=orderedTasks(snapshot!,settings.tasks,archivedTasks);
 const selected=list.find(task=>task.data.body.id===selectedTask);const checks=snapshot!.events.filter(ev=>ev.data.body.type==='x_verify'&&eligibleEvent(snapshot,ev)&&memberFor(snapshot,snapshot!.events.find(x=>x.hash===ev.data.body.claim))?.data.member_id===mine());
 const reported=new Set(contributionGroups(snapshot!).filter((g:any)=>g.memberId===mine()).map((g:any)=>g.taskId));
 const card=(task:EventView)=>{const b=task.data.body;const linked=!!b.post_url;
  const text=displayedTask(b,language);
  const report=!linked
   ?(reported.has(b.id)?`<p class="tag">✓ ${t('Reported','Bildirildi')}</p>`:`<label>${t('Note (optional, up to 1,000 characters)','Not (isteğe bağlı, en fazla 1.000 karakter)')}<textarea id="task-note-${e(task.hash)}" maxlength="2000"></textarea></label><button class="primary" data-done="${task.hash}">${t('I did this','Yaptım')}</button>`)
   :checks.length?`<div class="actions">${b.actions.map((action: keyof typeof actions) => `<label class="check"><input type="checkbox" data-action-code="${action}" data-task="${task.hash}">${e(actions[action]())}</label>`).join('')}</div>
        <button class="primary" data-submit="${task.hash}">${t('Report my selected actions','Seçtiklerimi bildir')}</button>`
   :`<p class="muted">${t('You can read and open the task now. Linking your account is required to record an X contribution.','Görevi şimdi inceleyebilirsin. X katkısını kaydetmek için hesabını bağlaman gerekir.')}</p><button data-page="account">${t('Link X account','X hesabını bağla')}</button>`;
  const display = settings.tasks.get(b.id);
  return `<article class="card" id="task-detail" tabindex="-1">
      <h3>${e(text.title)}</h3><p class="long-text">${e(text.description)}</p>
      ${linked?`<a href="${e(b.post_url)}" target="_blank" rel="noreferrer">${t('Open post on X','Gönderiyi X’te aç')}</a>`:''}
      ${archivedTasks?`<p class="tag">${t('Archived','Arşivlendi')}</p>`:report}
      ${may('tasks')?btn(t('Edit task text','Görev metnini düzenle'),'edit-task'):''}
      ${may('tasks')&&!archivedTasks?`<div class="row task-controls">
        <button type="button" data-task-setting="starred" aria-pressed="${!!display?.starred}">${display?.starred?t('Remove star','Yıldızı kaldır'):t('Star task','Yıldızla')}</button>
        <button type="button" data-task-setting="pinned" aria-pressed="${!!display?.pinned}">${display?.pinned?t('Unpin task','Sabitlemeyi kaldır'):t('Pin to top','Başa sabitle')}</button>
      </div>`:''}
      ${may('tasks')?(archivedTasks?btn(t('Restore to active tasks','Aktif görevlere geri al'),'restore-task'):`
        ${btn(t('Archive task','Görevi arşivle'),'archive-task')}
        <dialog id="archive-task-dialog" aria-labelledby="archive-task-title">
          <h3 id="archive-task-title">${t('Archive this task?','Bu görev arşivlensin mi?')}</h3>
          <p><strong>${e(text.title)}</strong></p>
          <p>${t('Members can read it in Archived tasks. Existing contributions stay in their history.','Üyeler görevi Arşivlenenler bölümünde okuyabilir. Önceki katkılar üye geçmişinde kalır.')}</p>
          <form method="dialog" class="row">
            <button autofocus>${t('Cancel','Vazgeç')}</button>
            ${btn(t('Archive','Arşivle'),'confirm-archive-task',true)}
          </form>
        </dialog>`):''}
    </article>`;};
 $('page').innerHTML = `<div class="row between"><div class="row"><h2>${t('Community tasks','Topluluk görevleri')}</h2>${info(t('How tasks work','Görevler nasıl çalışır?'),`<p>${t('Some tasks link to a post on X: open it, take only the actions you genuinely want to take from your own account, then report them here. Linking your X account once is needed for these, so reviewers can find your actions.','Bazı görevler X’teki bir gönderiye bağlantı verir: gönderiyi aç, yalnız gerçekten istediğin eylemleri kendi hesabından yap ve burada bildir. Bu görevler için X hesabını bir kez bağlaman gerekir; kontrolcüler eylemlerini böyle bulur.')}</p><p>${t('For other tasks, choose “I did this” and add a note if you want. You can do this without linking an X account.','Diğer görevleri “Yaptım” düğmesiyle bildirip istersen not ekleyebilirsin. Bunun için X hesabı bağlaman gerekmez.')}</p><p>${t('You earn 1 RaiUnyt for each task you report completing. A review that finds conflicting evidence reduces it to 0. Never use automation or fake accounts; that breaks X rules and community rules.','Tamamladığını bildirdiğin her görev 1 RaiUnyt kazandırır. Kontrolde çelişkili bulgu çıkarsa puan 0 olur. Otomasyon veya sahte hesap kullanma; bu hem X kurallarına hem topluluk kurallarına aykırıdır.')}</p>`)}</div>${may('tasks')?btn(t('New task','Yeni görev'),'new-task'):''}</div>
    <div class="row task-controls">
      <button type="button" data-task-view="active" aria-pressed="${!archivedTasks}">${t('Active','Aktif')}</button>
      <button type="button" data-task-view="archived" aria-pressed="${archivedTasks}">${t('Archived','Arşivlenenler')}</button>
    </div>
    <div id="task-form"></div>
    ${taskList(archivedTasks?'archived':'tasks',list)}
    ${selected?card(selected):''}
    ${symbols()}
    ${list.length ? `<details><summary>${t('How contribution reporting works','Katkı bildirimi nasıl çalışır?')}</summary>
      <p>${t('Reported actions are self-reported. About','Eylemler üye beyanına dayanır. Görev bildirimlerinin yaklaşık')} ${snapshot!.sample_percent}% ${t('of task reports are checked by a reviewer.','kadarı bir kontrolcü tarafından incelenir.')}</p>
      <p>${t('Proven deliberate fraud can lead to removal after a reasoned decision. Members can appeal.','Kanıtlanmış kasıtlı sahtecilik, gerekçeli kararla üyeliğin iptaline yol açabilir. Üye itiraz edebilir.')}</p></details>` : ''}`;
 root.querySelectorAll<HTMLButtonElement>('[data-task-setting]').forEach(button=>button.onclick=()=>run(async()=>{
   if (!selected || !may('tasks')) return;
   const id = selected.data.body.id;
   const state = {starred:false,pinned:false,...settings.tasks.get(id)};
   const key = button.dataset.taskSetting as keyof typeof state;
   await publish(settingBody(key==='starred'?'task-star':'task-pin',{id,enabled:!state[key]}));
   await refresh();
   pages.tasks = Math.floor(orderedTasks(snapshot!,settings.tasks).findIndex(task=>task.data.body.id===id)/TASKS_PAGE_SIZE);
 }));
 root.querySelectorAll<HTMLButtonElement>('[data-submit]').forEach(b=>b.onclick=()=>run(async()=>{if(!checks.length)throw Error(t('Account check required.','Hesap bağlantısı kontrolü gerekli.'));const selected=[...root.querySelectorAll<HTMLInputElement>(`input[data-task="${b.dataset.submit}"]:checked`)].map(i=>i.dataset.actionCode);if(!selected.length)throw Error(t('Select at least one action you took.','Yaptığın eylemlerden en az birini seç.'));await publish({type:'claim',task:b.dataset.submit,x_verification:checks.at(-1)!.hash,actions:selected,note:''});await refresh();}));
 root.querySelectorAll<HTMLButtonElement>('[data-done]').forEach(b=>b.onclick=()=>run(async()=>{const note=val('task-note-'+b.dataset.done);if(Array.from(note).length>1000)throw Error(t('The note is at most 1,000 characters.','Not en fazla 1.000 karakter olabilir.'));await publish({type:'claim',task:b.dataset.done,x_verification:null,actions:['done'],note});await refresh();}));
 root.querySelectorAll<HTMLButtonElement>('[data-task-view]').forEach(button=>button.onclick=()=>{
   archivedTasks = button.dataset.taskView==='archived';
   selectedTask = '';
   taskEditor = undefined;
   tasks();
   root.querySelector<HTMLElement>('[data-task-view][aria-pressed="true"]')?.focus({preventScroll:true});
 });
 const archive = (archived:boolean)=>run(async()=>{
   if (!selected||!may('tasks')) return;
   await publish({...selected.data.body,archived});
   await refresh();
   selectedTask = '';
   taskEditor = undefined;
   notice = archived?t('Task moved to Archived.','Görev Arşivlenenler’e taşındı.'):t('Task restored to Active.','Görev Aktif listesine geri alındı.');
 });
 const archiveDialog = root.querySelector<HTMLDialogElement>('#archive-task-dialog');
 $('archive-task')?.addEventListener('click',()=>archiveDialog?.showModal());
 $('confirm-archive-task')?.addEventListener('click',()=>void archive(true));
 $('restore-task')?.addEventListener('click',()=>void archive(false));
 if(may('tasks')) {
   if(taskEditor!==undefined)taskForm(taskEditor,false);
   $('new-task').onclick=()=>taskForm(null);
   $('edit-task')?.addEventListener('click',()=>{if(selected)taskForm(selected);});
 }
}

const taskDraftText=(lang:string)=>({title:val(`task-title-${lang}`),description:val(`task-description-${lang}`)});

function updateTaskDescriptionCount() {
 const count=$('task-description-count');
 if(!count)return;
 let remaining;
 try {
   remaining=TASK_DESCRIPTION_CHARS-Array.from(taskDescription(taskDraftText('en'),taskDraftText('tr'))).length;
 } catch {
   count.textContent=t('Remove unsupported characters from the task text.','Görev metnindeki desteklenmeyen karakterleri kaldır.');
   count.classList.add('over');
   return;
 }
 count.textContent=t(`${remaining.toLocaleString('en-GB')} characters left in total`,`Toplam ${remaining.toLocaleString('tr-TR')} karakter kaldı`);
 count.classList.toggle('over',remaining<0);
}

function taskForm(task:EventView|null,reveal=true) {
 if(reveal)taskEditLanguage=language;
 taskEditor=task;
 const body=task?.data.body;
 const translations=taskTranslations(body,taskEditLanguage);
 $('task-form').innerHTML=`<form id="create-task" class="card">
   <h3>${task?t('Edit task text','Görev metnini düzenle'):t('New task','Yeni görev')}</h3>
   <div class="grid">
     ${(['en','tr'] as const).map(lang=>`<div>
       ${field(lang==='en'?t('Title (English)','Başlık (İngilizce)'):t('Title (Turkish)','Başlık (Türkçe)'),`task-title-${lang}`,translations[lang].title)}
       <label>${lang==='en'?t('Description (English)','Açıklama (İngilizce)'):t('Description (Turkish)','Açıklama (Türkçe)')}
         <textarea id="task-description-${lang}" rows="6" aria-describedby="task-description-count">${e(translations[lang].description)}</textarea>
       </label>
     </div>`).join('')}
   </div>
   <p class="muted" id="task-description-count"></p>
   ${task?'':field(t('Link to the X post (optional)','X gönderisinin bağlantısı (isteğe bağlı)'),'task-post','','url')}
   ${task?'':`<p class="muted">${t('For tasks outside X, add any relevant link to the description and leave this field empty. Members can report the task with “I did this”.','X dışındaki görevlerde varsa bağlantıyı açıklamaya ekle, bu alanı boş bırak. Üyeler görevi “Yaptım” ile bildirir.')}</p>`}
   <button class="primary">${task?t('Save','Kaydet'):t('Create task','Görev oluştur')}</button>
   ${btn(t('Cancel','Vazgeç'),'cancel-task')}
 </form>`;
 const form=root.querySelector<HTMLFormElement>('#create-task')!;
 form.addEventListener('input',updateTaskDescriptionCount);
 updateTaskDescriptionCount();
 $('cancel-task').onclick=()=>{taskEditor=undefined;tasks();};
 if(reveal)$(`task-title-${taskEditLanguage}`).focus();
 form.onsubmit=event=>{
   event.preventDefault();
   void run(async()=>{
     if(!may('tasks'))return;
     let text;
     try { text=taskContent(taskDraftText('en'),taskDraftText('tr')); }
     catch(error) {
       const key=(error as Error).message;
       throw Error(key==='title-required' ? t('Enter a title in at least one language.','En az bir dilde başlık gir.')
         : key==='title-length' ? t('Each title can be at most 200 characters.','Her başlık en fazla 200 karakter olabilir.')
         : key==='description-length' ? t('Shorten the task text to fit the shared 10,000-character limit.','Görev metnini toplam 10.000 karakter sınırına sığacak şekilde kısalt.')
         : t('Remove unsupported characters from the task text.','Görev metnindeki desteklenmeyen karakterleri kaldır.'));
     }
     if(task) {
       await refresh({tasks:true,mine:true});
       const current=orderedTasks(snapshot!,settings.tasks,!!body.archived).find(item=>item.data.body.id===body.id);
       if(current?.hash!==task.hash)
         throw Error(t('This task changed. Reopen it before saving.','Bu görev değişti. Kaydetmeden önce görevi yeniden aç.'));
       await publish({...body,...text});
     } else {
       const post=val('task-post');
       if(post&&!/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(post))
         throw Error(t('Paste a post link like https://x.com/name/status/123, or leave it empty.','https://x.com/ad/status/123 gibi bir gönderi bağlantısı yapıştır ya da boş bırak.'));
       await publish({type:'task',id:crypto.randomUUID(),...text,post_url:post,actions:post?['like','repost','quote','reply']:['done'],archived:false});
     }
     taskEditor=undefined;
     await refresh();
   });
 };
}
function ledgerTable(entries:any[]){if(!entries.length)return `<p class="muted">${t('Nothing yet.','Henüz yok.')}</p>`;return `<div class="table-wrap"><table><thead><tr><th>${t('Date','Tarih')}</th><th>${t('Source','Kaynak')}</th><th>${t('Basis','Dayanak')}</th><th>RaiUnyt</th></tr></thead><tbody>${entries.map(x=>`<tr><td>${e(x.date)}</td><td>${x.kind==='campaign'?e(x.title):x.kind==='fullcopy'?`${e(x.hours)} ${t('full-copy hours','tam kopya saati')} × ${FULL_COPY_HOURLY}`:`${e(x.hours)} ${t('verified hours','doğrulanmış saat')}${x.bonusHours?` · ${e(x.bonusHours)} ${t('with scarcity bonus','kıtlık bonuslu')}`:''}`}</td><td>${e(({reported:t('Reported','Beyan'),supported:t('Peer-supported','Kontrolle desteklendi'),conflict:t('Conflicting evidence','Çelişkili bulgu'),'peer-checks':t('Reviewer checks','Kontrolcü ölçümü'),'storage-checks':t('Storage checks','Depolama kontrolü')} as Record<string,string>)[x.basis]||x.basis)}</td><td>${e(formatUnyt(x.amount))}</td></tr>`).join('')}</tbody></table></div>`;}
function raiunyt(){
 const all=ledger(snapshot!,language);const mineEntries=all.filter(x=>x.memberId===mine());const totals=balances(all);
 const campaigns=listPage('campaignLedger',mineEntries.filter(entry=>entry.kind==='campaign'));
 const hostingEntries=listPage('hostingLedger',mineEntries.filter(entry=>entry.kind==='hosting'));
 const fullcopyEntries=listPage('hostingLedger',mineEntries.filter(entry=>entry.kind==='fullcopy'));
 const board=(kind:'campaign'|'hosting'|'fullcopy')=>[...totals.entries()].filter(([,v])=>(v as any)[kind]>0).sort((a,b)=>(b[1] as any)[kind]-(a[1] as any)[kind]).slice(0,10);
 const boardList=(kind:'campaign'|'hosting'|'fullcopy')=>{const rows=board(kind);return rows.length?`<ol class="leaderboard">${rows.map(([id,v])=>`<li${id===mine()?' class="me"':''}>${memberName(id)} · ${e(formatUnyt(v[kind]))}</li>`).join('')}</ol>`:`<p class="muted">${t('Nobody yet.','Henüz kimse yok.')}</p>`;};
 $('page').innerHTML=`<section class="card"><div class="row"><h2>RaiUnyt</h2>${raiunytInfo()}</div>${unytSplit(all)}<p class="muted">${t('Rules','Kurallar')}: ${e(RULES_VERSION)} · ${t('Counted from the first community record. Not money; non-transferable.','İlk topluluk kaydından itibaren sayılır. Para değildir; devredilemez.')}</p></section>
 <div class="home-grid"><section class="card"><h3>${t('Task participation','Görevlere katılım')}</h3>${ledgerTable(campaigns.items)}${campaigns.pages>1?listPager('campaignLedger',campaigns,true):''}<h4>${t('Top 10','İlk 10')}</h4>${boardList('campaign')}</section>
 <section class="card"><h3>${t('Hosting','Barındırma')}</h3>${ledgerTable(hostingEntries.items)}${hostingEntries.pages>1?listPager('hostingLedger',hostingEntries,true):''}<h4>${t('Top 10','İlk 10')}</h4>${boardList('hosting')}</section>
 <section class="card"><h3>${t('Full copy (network memory)','Tam kopya (ağın hafızası)')}</h3><p class="muted">${t(`Each verified full-copy hour earns +${FULL_COPY_HOURLY} RaiUnyt, without a scarcity bonus.`,`Doğrulanan her tam kopya saati +${FULL_COPY_HOURLY} RaiUnyt kazandırır; kıtlık bonusu uygulanmaz.`)}</p>${ledgerTable(fullcopyEntries.items)}<h4>${t('Top 10','İlk 10')}</h4>${boardList('fullcopy')}</section></div>`;
}
function history() {
  const page = listPage('history',personalContributions(snapshot!,mine(),language));
  $('page').innerHTML = `<section class="card">
    <div class="row between"><div class="row"><h2>${t('My contribution history','Katkı geçmişim')}</h2>${contributionInfo()}</div></div>
    ${contributionList(page.items)}${page.pages>1?listPager('history',page,true):''}
  </section>`;
}
function communityReports(){
 const reports=listPage('reports',contributionGroups(snapshot!,language).reverse());$('page').innerHTML=`<h2>${t('Community contribution reports','Topluluk katkı bildirimleri')}</h2><p>${t('These are signed member reports, not independently verified X actions. Assigned reviewers check contributions.','Bunlar imzalı üye beyanlarıdır; bağımsız doğrulanmış X eylemleri değildir. Katkıları atanan kontrolcüler inceler.')}</p>${reports.items.map(g=>{const member=memberCurrent(snapshot,g.memberId);return`<div class="card"><h3>${memberName(g.memberId,member?.data.name)} · ${e(g.title)}</h3><p>${g.actions.map((a:keyof typeof actions)=>e(actions[a]())).join(' + ')}</p><small>${g.removed?t('Membership revoked; history retained','Üyelik iptal edildi; geçmiş korunuyor'):t('Self-reported','Beyan edildi')}</small><details><summary>${t('Record reference','Kayıt referansı')}</summary><pre>${e(g.references[0])}</pre></details></div>`;}).join('')}${listPager('reports',reports,true)}`;
}
function pendingAccountChecks() {
 const verified = new Set(snapshot!.events.filter(event=>event.data.body.type==='x_verify'&&eligibleEvent(snapshot!,event))
   .map(event=>event.data.body.claim));
 return snapshot!.events.filter(event=>event.data.body.type==='x_claim'&&!verified.has(event.hash));
}
function organizerChecks(){
 const name=(id:string|null)=>id?memberName(id):e(t('Unassigned','Atanmadı'));
 const pendingAccounts=listPage('pendingAccounts',pendingAccountChecks());
 const pendingContributions=listPage('pendingContributions',queue);
 const completed=listPage('completedReviews',snapshot!.events.filter(ev=>['review','x_verify'].includes(ev.data.body.type)).reverse());
 return `<section><h2>${t('All community checks','Topluluğun bütün kontrolleri')}</h2><p>${t('Organizer overview. Decisions remain with the authorized reviewer; your own account and contributions require another reviewer.','Yönetici görünümü. Değerlendirmeyi yetkili kontrolcü yapar; kendi hesabını ve katkılarını başka bir kontrolcü incelemelidir.')}</p><h3>${t('Pending account checks','Bekleyen hesap kontrolleri')} (${pendingAccounts.total})</h3>${pendingAccounts.items.map(x=>`<div class="record"><strong>@${e(x.data.body.handle)}</strong> · ${memberName(memberFor(snapshot!,x)?.data.member_id)}<p>${t('Available to another authorized reviewer','Hesap sahibi dışındaki yetkili kontrolcülere açık')}</p><pre>${e(x.data.body.challenge)}</pre><a href="${e(x.data.body.post_url)}" target="_blank" rel="noreferrer">${t('Open verification post','Doğrulama gönderisini aç')}</a></div>`).join('')}${pendingAccounts.pages>1?listPager('pendingAccounts',pendingAccounts):''}<h3>${t('Pending contribution checks','Bekleyen katkı kontrolleri')} (${pendingContributions.total})</h3>${pendingContributions.items.map(q=>{const task=snapshot!.events.find(ev=>ev.data.body.type==='task'&&ev.data.body.id===q.task_id);return `<div class="record"><strong>${name(q.member_id)}</strong> · ${e(displayedTask(task?.data.body,language).title||q.task_id)}<p>${t('Assigned reviewer','Atanan kontrolcü')}: ${name(q.reviewer)}</p><pre>${e(q.claim)}</pre></div>`;}).join('')}${pendingContributions.pages>1?listPager('pendingContributions',pendingContributions):''}<h3>${t('Recorded check history','Kaydedilmiş kontrol geçmişi')} (${completed.total})</h3>${completed.items.map(check=>{const claim=snapshot!.events.find(ev=>ev.hash===check.data.body.claim);const owner=claim?memberFor(snapshot!,claim):null;const reviewer=memberFor(snapshot!,check);const outcome=check.data.body.type==='x_verify'?t('Account attestation','Hesap onayı'):({supported:t('Supported','Destekleniyor'),unavailable:t('Cannot establish','Belirlenemiyor'),conflict:t('Conflicting evidence','Çelişkili bulgu')}[check.data.body.outcome as string]||check.data.body.outcome);return `<div class="record"><strong>${memberName(owner?.data.member_id)}</strong> · ${e(outcome)}<p>${t('Reviewer','Kontrolcü')}: ${memberName(reviewer?.data.member_id)} · ${e(new Date(check.timestamp_us/1000).toLocaleString(language==='tr'?'tr-TR':'en-GB'))}</p><p>${e(check.data.body.note)}</p><p>${eligibleEvent(snapshot!,check)?t('Currently eligible record','Güncel kurallarda geçerli kayıt'):t('Historical record; currently ineligible','Geçmiş kayıt; güncel kurallarda geçerli değil')}</p><details><summary>${t('Record reference','Kayıt referansı')}</summary><pre>${e(check.hash)}</pre></details></div>`;}).join('')}${completed.pages>1?listPager('completedReviews',completed,true):''}</section><hr>`;
}
function reviews(){
 if(!role()&&!may('reviewers')){return;}if(!role()){$('page').innerHTML=organizerChecks();return;}
 const claims=listPage('assignedAccounts',pendingAccountChecks().filter(event=>memberFor(snapshot,event)?.data.member_id!==mine()));
 const assigned=listPage('assignedContributions',queue.filter(item=>item.reviewer===mine()));
 const groups=new Map(contributionGroups(snapshot!).map(group=>[group.memberId+':'+group.taskId,group]));
 $('page').innerHTML=`${may('reviewers')?organizerChecks():''}<div class="row"><h2>${t('Assigned peer checks','Atanan peer kontrolleri')}</h2>${info(t('What reviewers do','Kontrolcü ne yapar?'),`<p>${t('Reviewers confirm X account links and check a random sample of contribution reports. They record only what they can actually see. Your own account and contributions are always checked by someone else.','Kontrolcüler X hesap bağlantılarını onaylar ve katkı bildirimlerinden rastgele bir örneği kontrol eder. Yalnız gerçekten gördüklerini kaydederler. Kendi hesabın ve katkıların her zaman başka biri tarafından kontrol edilir.')}</p><p>${t('While their apps are running, organizers and reviewers automatically measure hosting about every 15 minutes, even when minimized.','Yönetici ve kontrolcülerin uygulamaları çalışırken, küçültülmüş olsa da, yaklaşık 15 dakikada bir barındırmayı otomatik ölçer.')}</p>`)}</div><p>${t('Likes remain self-reported; reviewers assess only observable actions. Unavailable or deleted content is not proof of fraud. Record what you could actually see.','Beğeniler beyan olarak kalır; kontrolcü yalnız görebildiği eylemleri değerlendirir. Erişilemeyen veya silinen içerik sahtecilik kanıtı değildir. Gerçekten gördüğünü kaydet.')}</p>${claims.items.map(x=>`<div class="card"><h3>${t('Account link','Hesap bağlantısı')}: @${e(x.data.body.handle)}</h3><p>${memberName(memberFor(snapshot!,x)?.data.member_id)}</p><pre>${e(x.data.body.challenge)}</pre><a href="${e(x.data.body.post_url)}" target="_blank" rel="noreferrer">${t('Open verification post','Doğrulama gönderisini aç')}</a><p>${t('Check the author and the exact public code.','Gönderinin sahibini ve kodun aynen yazıldığını kontrol et.')}</p><button data-x-verify="${x.hash}">${t('I checked the post and code','Gönderiyi ve kodu kontrol ettim')}</button></div>`).join('')}${claims.pages>1?listPager('assignedAccounts',claims):''}${assigned.items.map(q=>{const c=snapshot!.events.find(e=>e.hash===q.claim)!;const m=memberFor(snapshot,c);const task=snapshot!.events.find(ev=>ev.hash===c.data.body.task);const verification=snapshot!.events.find(ev=>ev.hash===c.data.body.x_verification);const account=snapshot!.events.find(ev=>ev.hash===verification?.data.body.claim);const group=groups.get(m?.data.member_id+':'+task?.data.body.id);return`<div class="card"><h3>${t('Contribution check','Katkı kontrolü')}: ${memberName(m?.data.member_id,m?.data.name)}</h3><p>${e((group?.actions||c.data.body.actions).join(' + '))}</p>${task?.data.body.post_url?`<p><a href="${e(task?.data.body.post_url)}" target="_blank" rel="noreferrer">${t('X post','X gönderisi')}</a> · <a href="https://x.com/${e(account?.data.body.handle)}" target="_blank" rel="noreferrer">@${e(account?.data.body.handle)}</a></p>`:`<p>${t('Task without X link','X bağlantısız görev')}: ${e(displayedTask(task?.data.body,language).title)}</p>${c.data.body.note?`<p class="long-text">${e(c.data.body.note)}</p>`:''}`}<p>${q.reported?t('Includes a member report/flag','Bir ihbar içeriyor'):t('Random sample','Rastgele örneklem')}</p>${field(t('Observation and supporting public references','Gözlem ve destekleyen herkese açık referanslar'),'review-note-'+q.claim)}<div class="row">${['supported','unavailable','conflict'].map(out=>`<button data-review="${q.claim}" data-outcome="${out}">${out==='supported'?t('Supported','Destekleniyor'):out==='unavailable'?t('Cannot establish','Belirlenemiyor'):t('Conflicting evidence','Çelişkili bulgu')}</button>`).join('')}</div></div>`;}).join('')}${assigned.pages>1?listPager('assignedContributions',assigned):''}`;
 root.querySelectorAll<HTMLButtonElement>('[data-x-verify]').forEach(b=>b.onclick=()=>run(async()=>{await publish({type:'x_verify',claim:b.dataset.xVerify,role:role(),note:'Reviewer checked the named public post and its account-specific challenge.'});await refresh();}));root.querySelectorAll<HTMLButtonElement>('[data-review]').forEach(b=>b.onclick=()=>run(async()=>{await publish({type:'review',claim:b.dataset.review,role:role(),outcome:b.dataset.outcome,note:val('review-note-'+b.dataset.review)});await refresh();}));
}
let memberRowsSnapshot: Snapshot|null = null;
let memberRowsCache: ReturnType<typeof computeMemberRows>;
function memberRows() {
 if (memberRowsSnapshot!==snapshot) {
   memberRowsCache=computeMemberRows(snapshot!);
   memberRowsSnapshot=snapshot;
 }
 return memberRowsCache;
}
function computeMemberRows(s:Snapshot) {
 const bindings = new Map(s.members.map(member=>[member.hash,member.data.member_id]));
 const totals = balances(ledger(s));
 const verified = new Set(s.events.filter(event=>event.data.body.type==='x_verify'&&eligibleEvent(s,event)).map(event=>event.data.body.claim));
 const claims = new Map<string,EventView>(), confirmed = new Map<string,EventView>();
 const lastCheck = new Map<string,number>(), campaigns = new Map<string,number>();
 for (const event of s.events) {
   if (event.data.body.type!=='x_claim') continue;
   const id = bindings.get(event.data.membership);
   if (!id) continue;
   claims.set(id,event);
   if (verified.has(event.hash)) confirmed.set(id,event);
 }
 for (const check of hostingObservations(s))
   if (check.success) lastCheck.set(check.host,Math.max(lastCheck.get(check.host)??0,check.time));
 for (const group of contributionGroups(s))
   campaigns.set(group.memberId,(campaigns.get(group.memberId)??0)+1);

 return (currentMembers(s) as MemberView[]).map(member=>{
   const id = member.data.member_id, ok = confirmed.get(id), waiting = claims.get(id);
   const unyt = totals.get(id)??{campaign:0,hosting:0};
   return {member,id,role:memberRole(id) as ReturnType<typeof memberRole>,permissions:adminPermissions(s,id),reviewer:!!currentRole(s,id),
     x:ok?'verified':waiting?'pending':'none',handle:(ok||waiting)?.data.body.handle||'',
     campaigns:campaigns.get(id)??0,campaignUnyt:unyt.campaign,hostingUnyt:unyt.hosting,
     lastCheck:lastCheck.get(id)??0,removed:removed(s,id)};
 });
}
function shortDate(timestamp:number) {
 return timestamp ? new Date(timestamp/1000).toLocaleString(language==='tr'?'tr-TR':'en-GB',{dateStyle:'short',timeStyle:'short'}) : '';
}
const sortByName = (a:string,b:string) => a.localeCompare(b,language==='tr'?'tr-TR':'en-GB');
let memberFilter='all',permissionMember='';
function members(){
 if (!admin()) {
   const list = (currentMembers(snapshot!) as MemberView[])
     .filter(m=>!removed(snapshot!,m.data.member_id)&&matchesMember(m.data.name,m.data.member_id,searches.members))
     .sort((a,b)=>sortByName(a.data.name,b.data.name)||a.data.member_id.localeCompare(b.data.member_id));
   const page = pageOf(list,pages.members,20);
   pages.members = page.page;
   $('page').innerHTML=`<h2>${t('Members','Üyeler')}</h2>${symbols()}${listSearch('members')}
     <ul class="directory">${page.items.map(member=>`<li class="record">${profileLink(member.data.member_id)}</li>`).join('')}</ul>
     ${listPager('members',page)}`;
   return;
 }
 const rows=memberRows();const xLabel=(r:ReturnType<typeof memberRows>[number])=>r.x==='verified'?'✓ @'+r.handle:r.x==='pending'?t('Waiting','Bekliyor')+' @'+r.handle:t('Not linked','Bağlı değil');
 const roleLabel=(r:ReturnType<typeof memberRows>[number])=>roleName(r.role)+(r.role==='organizer'&&r.reviewer?' · '+t('Reviewer','Kontrolcü'):'');
 const filters:[string,string,(r:ReturnType<typeof memberRows>[number])=>boolean][]=[['all',t('All','Hepsi'),()=>true],['x-none',t('X not linked','X bağlı değil'),r=>r.x==='none'],['x-pending',t('X waiting for check','X kontrol bekliyor'),r=>r.x==='pending'],['x-verified',t('X verified','X onaylı'),r=>r.x==='verified'],['organizers',t('Organizers','Yöneticiler'),r=>r.role==='founder'||r.role==='organizer'],['reviewers',t('Reviewers','Kontrolcüler'),r=>r.reviewer],['hosting',t('Hosting checked','Barındırması ölçülen'),r=>!!r.lastCheck],['removed',t('Access revoked','Erişimi iptal'),r=>r.removed]];
 const active=filters.find(f=>f[0]===memberFilter)||filters[0];const shown=rows.filter(r=>active[2](r)&&matchesMember(r.member.data.name,r.id,searches.members,r.handle))
   .sort((a,b)=>sortByName(a.member.data.name,b.member.data.name)||a.id.localeCompare(b.id));
 const page=pageOf(shown,pages.members,12);
 pages.members=page.page;
 const editing=founder()&&permissionMember?rows.find(r=>r.id===permissionMember&&r.role!=='founder'):undefined;
 $('page').innerHTML=`<h2>${t('Members and rules','Üyeler ve kurallar')}</h2><div class="card"><h3>${t('Community address to share','Paylaşılacak topluluk adresi')}</h3><p>${t('Send this public address to new members. They paste it on the welcome screen and join directly. Never share your recovery code.','Bu herkese açık adresi yeni üyelere gönder. Giriş ekranına yapıştırıp doğrudan katılırlar. Kurtarma kodunu asla paylaşma.')}</p><input id="public-community" readonly aria-label="${t('Public community address','Herkese açık topluluk adresi')}" value="${e(community)}">${btn(t('Copy public address','Herkese açık adresi kopyala'),'copy-community')}</div>
 ${founder()?`<details class="card" id="release-settings"><summary>${t('Announce a Windows update','Windows güncellemesi duyur')}</summary>
   <p>${t('Upload the installer to your download site first. Members on older versions will see an update notice and a link to the installer.','Önce kurulum dosyasını indirme sitesine yükle. Eski sürümü kullanan üyeler güncelleme bildirimini ve indirme bağlantısını görür.')}</p>
   <form id="release-form">
     ${field(t('Version (for example 0.3.4)','Sürüm (örneğin 0.3.4)'),'release-version',settings.releasePlan?.version??settings.release?.version??'')}
     ${field(t('HTTPS download link','HTTPS indirme bağlantısı'),'release-url',settings.releasePlan?.url??settings.release?.url??'','url')}
     ${field(t('SHA-256 of the installer','Kurulum dosyasının SHA-256 değeri'),'release-sha256',settings.releasePlan?.sha256??settings.release?.sha256??'')}
     <p class="muted">${t('Members’ apps download the file, check this value and refuse to install a file that does not match.','Üyelerin uygulaması dosyayı indirir, bu değeri kontrol eder ve uyuşmayan dosyayı kurdurmaz.')}</p>
     <div class="row">
       <button class="primary" name="release-mode" value="manual">${t('Publish update notice','Güncelleme bildirimini yayımla')}</button>
       <button name="release-mode" value="auto">${t('Announce on first connection','İlk bağlantıda otomatik duyur')}</button>
     </div>
     <p class="muted">${t('Automatic announcements go out when the founder or an organizer with the update permission connects using this version.','Otomatik duyuru, kurucu veya güncelleme duyurma izni olan bir yönetici bu sürümle bağlanınca gider.')}</p>
   </form></details>`:''}
 ${editing?`<section class="card" id="permission-editor"><h3>${t('Organizer permissions','Yönetici izinleri')}: ${memberName(editing.id)}</h3><p class="muted">${t('Only you, as founder, give or take these. An organizer cannot make other organizers. Actions taken before a permission is removed stay valid.','Bunları yalnız sen, kurucu olarak, verir veya alırsın. Bir yönetici başka yönetici atayamaz. İzin alınmadan önce yapılan işlemler geçerli kalır.')}</p><div class="terms-checks">${PERMISSIONS.map(p=>`<div class="row"><label class="check"><input type="checkbox" data-permission="${p}" ${editing.permissions.includes(p)?'checked':''}>${e(permissionLabels[p]())}</label>${info(permissionLabels[p](),`<p>${e(permissionInfo[p]())}</p>`)}</div>`).join('')}</div><div class="row">${btn(t('Save permissions','İzinleri kaydet'),'save-permissions',true)}${btn(t('Remove all permissions','Bütün izinleri al'),'clear-permissions')}${btn(t('Close','Kapat'),'close-permissions')}</div></section>`:''}
 <section class="card"><div class="row between"><div class="row"><h3>${t('Member overview','Üye listesi')} (${shown.length}/${rows.length})</h3>${info(t('About this list','Bu liste hakkında'),`<p>${t('Only organizers see this overview. X status: “Waiting” means the member posted the verification but no reviewer has checked it yet. The hosting column shows the last successful remote check.','Bu görünümü yalnız yöneticiler görür. X durumu: “Bekliyor”, üyenin doğrulama gönderisini paylaştığını ama henüz bir kontrolcünün bakmadığını gösterir. Barındırma sütunu son başarılı uzaktan ölçümü gösterir.')}</p><p>${t('Same display names are told apart by the short # code.','Aynı görünen adlar kısa # koduyla ayrılır.')}</p>`)}</div><div class="row"><label class="inline">${t('Show','Göster')}<select id="member-filter">${filters.map(f=>`<option value="${f[0]}" ${f[0]===active[0]?'selected':''}>${e(f[1])}</option>`).join('')}</select></label>${btn(t('Download list (CSV)','Listeyi indir (CSV)'),'members-csv')}</div></div>
 ${symbols()}${listSearch('members')}
 <div class="table-wrap"><table class="members-table"><thead><tr><th>${t('Name','Ad')}</th><th>${t('Role','Rol')}</th><th>${t('X account','X hesabı')}</th><th>${t('Task participation','Görevlere katılım')}</th><th>RaiUnyt ${t('tasks','görevler')}</th><th>RaiUnyt ${t('hosting','barındırma')}</th><th>${t('Hosting','Barındırma')}</th><th>${t('Status','Durum')}</th><th></th></tr></thead><tbody>${page.items.map(r=>`<tr><td>${profileLink(r.id)}</td><td data-label="${t('Role','Rol')}">${e(roleLabel(r))}${r.permissions.length&&r.role!=='founder'?`<br><small>${e(r.permissions.map((p:string)=>permissionLabels[p]()).join(', '))}</small>`:''}</td><td data-label="${t('X account','X hesabı')}" class="x-${r.x}">${e(xLabel(r))}</td><td data-label="${t('Task participation','Görevlere katılım')}">${r.campaigns}</td><td data-label="RaiUnyt ${t('tasks','görevler')}">${e(formatUnyt(r.campaignUnyt))}</td><td data-label="RaiUnyt ${t('hosting','barındırma')}">${e(formatUnyt(r.hostingUnyt))}</td><td data-label="${t('Hosting','Barındırma')}">${r.lastCheck?e(shortDate(r.lastCheck)):t('Awaiting check','Ölçüm bekleniyor')}</td><td data-label="${t('Status','Durum')}">${r.removed?t('Revoked','İptal'):t('Active','Etkin')}</td><td class="member-actions">${r.role==='founder'?'':[may('reviewers')?`<button data-role-member="${r.id}" data-enabled="${!r.reviewer}">${r.reviewer?t('Revoke reviewer','Kontrolcülüğü al'):t('Make reviewer','Kontrolcü yap')}</button>`:'',founder()?`<button data-permissions-member="${r.id}">${t('Permissions…','İzinler…')}</button>`:'',may('membership')?`<button data-pick-member="${r.id}">${t('Decision…','Karar…')}</button>`:'',may('membership')?`<button data-invite-access="${r.id}" data-enabled="${!inviteAllowed(r.id)}">${inviteAllowed(r.id)?t('Pause invitations','Davetlerini durdur'):t('Allow invitations','Davetlerini aç')}</button>`:''].filter(Boolean).join(' ')}</td></tr>`).join('')}</tbody></table></div>${listPager('members',page)}</section>
 ${may('sampling')?`<div class="card">${field(t('Sampling percentage for future checks','Gelecek kontroller için örneklem yüzdesi'),'sampling',snapshot!.sample_percent.toString(),'number')}${btn(t('Save sampling rate','Örneklem oranını kaydet'),'save-sampling')}</div>`:''}
 ${invitationAdmin()}
 <p class="muted">${t('RaiUnyt is calculated automatically from public records with fixed rules ('+RULES_VERSION+'). There is no mint or manual balance action.','RaiUnyt ortak kayıtlardan sabit kurallarla ('+RULES_VERSION+') otomatik hesaplanır. Elle bakiye yazma veya basma işlemi yoktur.')}</p>
 ${may('membership')?`<div class="card"><h3>${t('Reasoned membership decision / appeal outcome','Gerekçeli üyelik kararı / itiraz sonucu')}</h3>${field(t('Subject membership ID','İlgili üyelik kimliği'),'decision-member')}${field(t('Evidence record addresses, comma-separated','Kanıt kaydı adresleri, virgülle ayrılmış'),'decision-refs')}<label>${t('Facts establishing the decision','Kararı destekleyen somut bulgular')}<textarea id="decision-reason"></textarea></label><label class="check"><input id="deliberate-confirm" type="checkbox">${t('I reviewed evidence of a community rule violation. This decision is based on specific facts.','Topluluk kuralı ihlaline ilişkin kanıtı inceledim. Karar somut bulgulara dayanıyor.')}</label>${btn(t('Revoke community access','Topluluk erişimini iptal et'),'remove-member')}${btn(t('Record successful appeal / restore access','Kabul edilen itirazı kaydet / erişimi aç'),'restore-member')}<p class="muted">${t('The founder’s access cannot be revoked.','Kurucunun erişimi iptal edilemez.')}</p></div>`:''}`;
 $('member-filter').onchange=ev=>{
   memberFilter=(ev.target as HTMLSelectElement).value;
   pages.members=0;
   redrawList('members','#member-filter');
 };
 root.querySelector<HTMLFormElement>('#release-form')?.addEventListener('submit',event=>{
   event.preventDefault();
   void run(async()=>{
     const version=val('release-version'), url=releaseUrl(val('release-url')), sha256=val('release-sha256').toLowerCase();
     if (!versionParts(version)||!url)
       throw Error(t('Enter a version with three numbers and a valid HTTPS link.','Üç sayıdan oluşan bir sürüm numarası ve geçerli bir HTTPS bağlantısı gir.'));
     if (!/^[a-f0-9]{64}$/.test(sha256))
       throw Error(t('Enter the installer’s SHA-256 value (64 hexadecimal characters).','Kurulum dosyasının SHA-256 değerini gir (64 onaltılık karakter).'));
     const automatic = (event.submitter as HTMLButtonElement|null)?.value==='auto';
     if (automatic && settings.release && !isNewer(version,settings.release.version))
       throw Error(t('Use a version newer than the last announcement.','Son duyurudakinden daha yeni bir sürüm gir.'));
     await publish(settingBody(automatic?'windows-release-plan':'windows-release',{version,url,sha256}));
     await refresh();
     notice=automatic?t('Windows update staged for automatic announcement.','Windows güncellemesi otomatik duyuru için hazır.'):t('Update notice published.','Güncelleme bildirimi yayımlandı.');
   });
 });
 $('members-csv').onclick=()=>{const q=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';const csv=[['name','id','role','permissions','reviewer','x_status','x_handle','tasks_reported','raiunyt_tasks','raiunyt_hosting','last_successful_check','status'].join(','),...rows.map(r=>[r.member.data.name,r.id,r.role,r.permissions.join(' '),r.reviewer?'yes':'no',r.x,r.handle,r.campaigns,r.campaignUnyt,r.hostingUnyt,shortDate(r.lastCheck),r.removed?'revoked':'active'].map(q).join(','))].join('\n');download('rai-members.csv','﻿'+csv);};
 root.querySelectorAll<HTMLButtonElement>('[data-pick-member]').forEach(b=>b.onclick=()=>{const input=root.querySelector<HTMLInputElement>('#decision-member')!;input.value=b.dataset.pickMember!;input.scrollIntoView({block:'center'});input.focus();});
 root.querySelectorAll<HTMLButtonElement>('[data-permissions-member]').forEach(b=>b.onclick=()=>{permissionMember=b.dataset.permissionsMember!;members();$('permission-editor').scrollIntoView({block:'start'});});
 const savePermissions=(permissions:string[])=>run(async()=>{
   await publish({type:'admin_grant',member_id:permissionMember,permissions});
   await refresh({gov:true});
   notice=permissions.length?t('Permissions saved.','İzinler kaydedildi.'):t('All organizer permissions removed.','Bütün yönetici izinleri alındı.');
 });
 root.querySelector<HTMLButtonElement>('#save-permissions')?.addEventListener('click',()=>savePermissions([...root.querySelectorAll<HTMLInputElement>('input[data-permission]:checked')].map(i=>i.dataset.permission!)));
 root.querySelector<HTMLButtonElement>('#clear-permissions')?.addEventListener('click',()=>savePermissions([]));
 bindInvitationAdmin();
 root.querySelector<HTMLButtonElement>('#close-permissions')?.addEventListener('click',()=>{permissionMember='';members();});
 $('copy-community').onclick=()=>run(async()=>{await navigator.clipboard.writeText(community);notice=t('Public community address copied.','Herkese açık topluluk adresi kopyalandı.');});
 root.querySelector<HTMLButtonElement>('#save-sampling')?.addEventListener('click',()=>run(async()=>{const percent=Number(val('sampling'));if(!Number.isInteger(percent)||percent<0||percent>100)throw Error(t('Enter a whole number from 0 to 100.','0 ile 100 arasında tam sayı yaz.'));await publish({type:'sampling',percent});await refresh();}));
 root.querySelectorAll<HTMLButtonElement>('[data-role-member]').forEach(b=>b.onclick=()=>run(async()=>{await publish({type:'peer_role',member_id:b.dataset.roleMember,enabled:b.dataset.enabled==='true'});await refresh();}));
 for(const[id,isRemoved]of[['remove-member',true],['restore-member',false]] as const)root.querySelector<HTMLButtonElement>('#'+id)?.addEventListener('click',()=>run(async()=>{if(isRemoved&&!root.querySelector<HTMLInputElement>('#deliberate-confirm')!.checked)throw Error(t('Review the evidence of the rule violation before revoking access.','Erişimi iptal etmeden önce kural ihlaline ilişkin kanıtı incele.'));await publish({type:'decision',member_id:val('decision-member'),removed:isRemoved,references:val('decision-refs').split(',').map(s=>s.trim()).filter(Boolean),reason:val('decision-reason')});await refresh();}));
}
/** Invitation right of one member under the latest settings (plan I). */
function inviteAllowed(id:string){
 if(id===snapshot?.community.founder)return true;
 const personal=settings.inviteAccess.get(id);
 if(personal===false)return false;
 const joins=(snapshot?.joins??[]).filter(j=>j.invited_by===id&&removed(snapshot!,j.member_id));
 return personal===true||joins.length<2;
}
/** Plan I: gate, quotas, campaign codes, member invitations, the invitation tree and combined removal. */
function invitationAdmin(){
 if(!founder()&&!may('membership'))return '';
 const now=Date.now()*1000;
 const names=(id:string)=>memberName(id);
 const joins=(snapshot?.joins??[]).slice().sort((a,b)=>a.at_us-b.at_us);
 const children=new Map<string,typeof joins>();
 for(const j of joins){if(!children.has(j.invited_by))children.set(j.invited_by,[]);children.get(j.invited_by)!.push(j);}
 const tree=(id:string,depth=0):string=>depth>6?'':(children.get(id)??[]).map(j=>`<li>${names(j.member_id)}${removed(snapshot!,j.member_id)?` <span class="tag">${t('Removed','Çıkarıldı')}</span>`:''}${children.has(j.member_id)?`<ul>${tree(j.member_id,depth+1)}</ul>`:''}</li>`).join('');
 const uses=(hash:string)=>(snapshot?.members??[]).filter(m=>m.data.invitation===hash).length;
 const q=settings.quota;
 return `<section class="card" id="invitation-admin"><div class="row"><h3>${t('Invitations','Davetler')}</h3>${info(t('Invitations','Davetler'),`<p>${t('Each member invitation is single-use and valid for 7 days. A campaign code is for many people from one campaign; only the founder creates and closes it. Two removed invitees pause the inviter’s right until it is turned back on.','Üye daveti tek kullanımlıktır ve 7 gün geçerlidir. Kampanya kodu tek bir kampanyadan gelen çok kişi içindir; yalnız kurucu üretir ve kapatır. Davet ettiklerinden iki kişi çıkarılırsa davet edenin hakkı yeniden açılana kadar durur.')}</p>`)}</div>
  ${founder()?`<h4>${t('Who can join','Kimler katılabilir')}</h4>
   <div class="row"><label class="check"><input type="radio" name="gate" value="invite" ${settings.gateOpen?'':'checked'}>${t('With an invitation (recommended)','Davetle (önerilen)')}</label><label class="check"><input type="radio" name="gate" value="open" ${settings.gateOpen?'checked':''}>${t('Open: anyone with the address','Açık: adresi bilen herkes')}</label>${btn(t('Save','Kaydet'),'save-gate')}</div>
   <h4>${t('Invitation limits','Davet sınırları')}</h4>
   <form id="quota-form" class="row">${field(t('Days before a new member can invite','Yeni üyenin davet edebilmesi için gün'),'quota-wait',String(q.wait_days),'number')}${field(t('Invitations per week (members)','Haftalık davet (üyeler)'),'quota-week',String(q.per_week),'number')}${field(t('Invitations per week (organizers)','Haftalık davet (yöneticiler)'),'quota-org',String(q.organizer_per_week),'number')}<button>${t('Save limits','Sınırları kaydet')}</button></form>
   <h4>${t('Campaign codes','Kampanya kodları')}</h4>
   <form id="campaign-form" class="row">${field(t('Maximum uses','En çok kullanım'),'campaign-uses','200','number')}${field(t('Valid for days (up to 90)','Geçerlilik günü (en çok 90)'),'campaign-days','14','number')}<button class="primary">${t('Create code','Kod üret')}</button></form>
   ${settings.campaigns.length?`<ul>${settings.campaigns.slice().reverse().map((c:any)=>{const closed=settings.closedCampaigns.has(c.hash)||!c.active||c.expires_at_us<now;return `<li><code>${e(formatInvite(community,c.hash))}</code> · ${uses(c.hash)} / ${c.max_uses} · ${closed?t('Closed','Kapalı'):t('Open until','Şu tarihe kadar açık')+' '+e(new Date(c.expires_at_us/1000).toLocaleDateString(language==='tr'?'tr-TR':'en-GB'))} ${closed?'':`<button type="button" data-close-campaign="${e(c.hash)}">${t('Close','Kapat')}</button> <button type="button" data-copy-campaign="${e(formatInvite(community,c.hash))}">${t('Copy','Kopyala')}</button>`}</li>`;}).join('')}</ul>`:''}`:''}
  ${may('membership')?`<h4>${t('Member invitations','Üye davetleri')}</h4>
   <p>${settings.invites.membersCanInvite?t('Members can create invitations.','Üyeler davet üretebilir.'):t('Member invitations are off.','Üye davetleri kapalı.')}</p>
   <div class="row">${btn(settings.invites.membersCanInvite?t('Turn member invitations off','Üye davetlerini kapat'):t('Turn member invitations on','Üye davetlerini aç'),'toggle-invites')}${btn(t('Cancel all unused invitations','Kullanılmamış bütün davetleri iptal et'),'revoke-invites')}</div>
   <details><summary>${t('Invitation tree','Davet ağacı')} (${joins.length})</summary><ul class="invite-tree">${tree(snapshot!.community.founder)}${[...children.keys()].filter(id=>id!==snapshot!.community.founder&&!joins.some(j=>j.member_id===id)).map(id=>`<li>${names(id)}<ul>${tree(id)}</ul></li>`).join('')}</ul></details>
   <details id="bulk-block"><summary>${t('Remove a member and the people they invited','Bir üyeyi ve davet ettiklerini çıkar')}</summary>
    ${field(t('Membership ID of the inviter','Davet edenin üyelik kimliği'),'bulk-root')}
    ${btn(t('List their invitees from the last 30 days','Son 30 günde davet ettiklerini listele'),'bulk-list')}
    <div id="bulk-candidates"></div>
   </details>`:''}
 </section>`;
}
function bindInvitationAdmin(){
 const gov=(body:any)=>run(async()=>{await publish(body);await refresh({gov:true});});
 root.querySelector<HTMLButtonElement>('#save-gate')?.addEventListener('click',()=>gov({type:'gate',open:root.querySelector<HTMLInputElement>('input[name="gate"]:checked')?.value==='open'}));
 root.querySelector<HTMLFormElement>('#quota-form')?.addEventListener('submit',event=>{event.preventDefault();const w=Number(val('quota-wait')),p=Number(val('quota-week')),o=Number(val('quota-org'));if(![w,p,o].every(Number.isInteger)||w<0||w>60||p<0||p>100||o<0||o>1000){message(t('Use whole numbers: days 0–60, members 0–100, organizers 0–1000.','Tam sayı kullan: gün 0–60, üyeler 0–100, yöneticiler 0–1000.'));return;}void gov({type:'invite_quota',wait_days:w,per_week:p,organizer_per_week:o});});
 root.querySelector<HTMLFormElement>('#campaign-form')?.addEventListener('submit',event=>{event.preventDefault();const uses=Number(val('campaign-uses')),days=Number(val('campaign-days'));if(!Number.isInteger(uses)||uses<1||uses>10000||!Number.isInteger(days)||days<1||days>90){message(t('Use 1–10,000 uses and 1–90 days.','1–10.000 kullanım ve 1–90 gün gir.'));return;}void gov({type:'campaign_code',max_uses:uses,expires_at_us:Date.now()*1000+days*86_400_000_000,active:true});});
 root.querySelectorAll<HTMLButtonElement>('[data-close-campaign]').forEach(b=>b.onclick=()=>gov({type:'module',module:'invites',version:1,kind:'campaign-close',admin:true,payload:b.dataset.closeCampaign}));
 root.querySelectorAll<HTMLButtonElement>('[data-copy-campaign]').forEach(b=>b.onclick=()=>run(async()=>{await navigator.clipboard.writeText(b.dataset.copyCampaign!);notice=t('Campaign code copied.','Kampanya kodu kopyalandı.');}));
 root.querySelector<HTMLButtonElement>('#toggle-invites')?.addEventListener('click',()=>gov({type:'invite_settings',members_can_invite:!settings.invites.membersCanInvite,revoke_before_us:settings.invites.revokeBeforeUs}));
 root.querySelector<HTMLButtonElement>('#revoke-invites')?.addEventListener('click',()=>{if(confirm(t('Cancel every unused invitation created until now?','Şimdiye kadar üretilmiş bütün kullanılmamış davetler iptal edilsin mi?')))void gov({type:'invite_settings',members_can_invite:settings.invites.membersCanInvite,revoke_before_us:Date.now()*1000-1000});});
 root.querySelectorAll<HTMLButtonElement>('[data-invite-access]').forEach(b=>b.onclick=()=>gov({type:'invite_access',member_id:b.dataset.inviteAccess,enabled:b.dataset.enabled==='true'}));
 root.querySelector<HTMLButtonElement>('#bulk-list')?.addEventListener('click',()=>{
  const id=val('bulk-root');const since=Date.now()*1000-30*86_400_000_000;
  const list=(snapshot?.joins??[]).filter(j=>j.invited_by===id&&j.at_us>=since).map(j=>j.member_id);
  if(!/^[a-f0-9]{64}$/.test(id)||id===snapshot?.community.founder){message(t('Enter a member ID (not the founder).','Bir üyelik kimliği gir (kurucu olamaz).'));return;}
  $('bulk-candidates').innerHTML=`<p>${t('Confirm each member to remove:','Çıkarılacak her üyeyi tek tek onayla:')}</p><ul>${[id,...list].map(m=>`<li><label class="check"><input type="checkbox" data-bulk-member="${e(m)}">${memberName(m)}</label></li>`).join('')}</ul>
   ${field(t('Evidence record addresses, comma-separated','Kanıt kaydı adresleri, virgülle ayrılmış'),'bulk-refs')}<label>${t('Facts establishing the decision','Kararı destekleyen somut bulgular')}<textarea id="bulk-reason"></textarea></label>${btn(t('Remove the confirmed members','Onaylanan üyeleri çıkar'),'bulk-remove')}`;
  root.querySelector<HTMLButtonElement>('#bulk-remove')?.addEventListener('click',()=>run(async()=>{
   const member_ids=[...root.querySelectorAll<HTMLInputElement>('input[data-bulk-member]:checked')].map(i=>i.dataset.bulkMember!);
   if(!member_ids.length)throw Error(t('Confirm at least one member.','En az bir üyeyi onayla.'));
   await publish({type:'bulk_decision',member_ids,removed:true,references:val('bulk-refs').split(',').map(s=>s.trim()).filter(Boolean),reason:val('bulk-reason')});
   await refresh({gov:true});
  }));
 });
}
function currentHostingOffers(s:Snapshot) {
 const memberships = new Map(currentMembers(s).filter(m => !removed(s,m.data.member_id)).map(m => [m.hash,m.data.member_id]));
 const offers = new Map<string,EventView>();
 for (const event of s.events) {
  const id = memberships.get(event.data.membership);
  if (id && event.data.body.type==='host_offer') offers.set(id,event);
 }
 return [...offers].filter(([,event])=>event.data.body.enabled);
}

function hosting(){
 const s = snapshot!;
 const memberNames = new Map((currentMembers(s) as MemberView[]).map(member=>[member.data.member_id,member.data.name]));
 const offers = currentHostingOffers(s)
   .filter(([id])=>matchesMember(memberNames.get(id)??'',id,searches.hosts))
   .sort(([a],[b])=>sortByName(memberNames.get(a)??'',memberNames.get(b)??'')||a.localeCompare(b));
 const page = pageOf(offers,pages.hosts,12);
 pages.hosts = page.page;
 const shownOffers = new Set(page.items.map(([,offer])=>offer.hash));
 const checks = new Map<string,ReturnType<typeof hostingObservations>>();
 for (const check of hostingObservations(s)) {
   if (!shownOffers.has(check.offer)) continue;
   const observations = checks.get(check.offer)??[];
   observations.push(check);
   checks.set(check.offer,observations);
 }
 const multipliers = currentMultipliers(s);
 const hours = hostingHours(s);
 const now = Date.now() * 1000;
 const month = hostingMonth(now);
 const targets = monthlyHostingTargets(s);
 const monthTargets = new Map(targets.filter(target => target.month===month).map(target => [target.memberId,target]));
 const myHours = hours.filter(h=>h.memberId===mine() && h.hour>=now-24*3_600_000_000);
 const recent = [...new Map(hours.filter(h=>h.hour>=now-24*3_600_000_000).map(h=>[h.hour,h.hosts])).entries()].reverse().slice(0,12);
 const monthlyCounts = new Map<string,number>();
 for (const h of hours) {
  const key = h.memberId + '|' + hostingMonth(h.hour);
  monthlyCounts.set(key,(monthlyCounts.get(key)??0)+1);
 }
 const locale = language==='tr'?'tr-TR':'en-GB';
 const monthName = (value:string)=>new Date(value+'-01T00:00:00Z').toLocaleDateString(locale,{month:'long',year:'numeric',timeZone:'UTC'});
 const formatCheck = (time:number)=>new Date(time/1000).toLocaleString(locale,{dateStyle:'short',timeStyle:'short'});
 const progress = (target:ReturnType<typeof monthlyHostingTargets>[number]) => {
  const done = monthlyCounts.get(target.memberId+'|'+target.month)??0;
  const status = done>=target.hours?t('Goal reached','Hedef tamamlandı'):target.month===month
    ?t('In progress','Devam ediyor'):t('Goal missed','Hedefe ulaşılamadı');
  const label = t(`${done} of ${target.hours} verified hours`,`${done} / ${target.hours} doğrulanmış saat`);
  return `<div class="hosting-target"><p>${e(label)} · ${status}</p>
    <progress value="${Math.min(done,target.hours)}" max="${target.hours}" aria-label="${e(label)}"></progress></div>`;
 };
 const personalTarget = monthTargets.get(mine());
 const pastTargets = listPage('pastHosting',targets.filter(target=>target.memberId===mine()&&target.month<month).sort((a,b)=>b.month.localeCompare(a.month)));
 $('page').innerHTML=`
 <div class="row between"><div class="row"><h2>${t('My hosting','Barındırmam')}</h2>${hostingInfo()}</div><span id="hosting-status" class="tag"></span></div>
 ${hostingSummary(hours.filter(hour=>hour.memberId===mine()).length)}
 ${hostingEnabled?`<p>${t('Your device automatically shares community records while the app is open and connected.','Uygulama açık ve bağlıyken cihazın topluluk kayıtlarını otomatik paylaşır.')}</p>`:''}
 <section class="card hosting-target"><h3>${t('Monthly hosting goal','Aylık barındırma hedefi')} · ${e(monthName(month))}</h3>
  ${personalTarget ? progress(personalTarget) : `<p>${t('Set an optional goal for verified hosting hours this month.','İstersen bu ay doğrulanmasını hedeflediğin barındırma saatini belirle.')}</p>`}
  <form id="hosting-target-form" class="hosting-target-form">
   <label>${t('Target hours','Hedef saat')}<input id="hosting-target-hours" type="number" required min="1" max="${hoursInHostingMonth(month)}" value="${personalTarget?.hours??''}"></label>
   <button class="primary">${t('Save goal','Hedefi kaydet')}</button>
   ${personalTarget?btn(t('Remove goal','Hedefi kaldır'),'remove-hosting-target'):''}
  </form>
  ${pastTargets.total?`<details id="past-hosting-goals"><summary>${t('Previous goals','Önceki hedefler')}</summary>${pastTargets.items.map(target=>`<div class="record"><strong>${e(monthName(target.month))}</strong>${progress(target)}</div>`).join('')}${pastTargets.pages>1?listPager('pastHosting',pastTargets,true):''}</details>`:''}
 </section>
 <section class="card">
  <div class="row"><h3>${t('Hourly RaiUnyt and scarcity bonus','Saatlik RaiUnyt ve kıtlık bonusu')}</h3>${info(t('How the bonus works','Bonus nasıl çalışır?'),`<p>${t('A successful remote check earns '+HOSTING_HOURLY+' RaiUnyt for that hour. The bonus depends on how many hosts could be reached. Each member counts once per hour.','Başarılı bir uzaktan ölçüm o saat için '+HOSTING_HOURLY+' RaiUnyt kazandırır. Bonus, kaç barındırıcıya ulaşılabildiğine göre belirlenir. Her üye saat başına bir kez sayılır.')}</p>`)}</div>
  <ul>${multipliers.map((m:number,i:number)=>`<li>${i===0?t('Only one host reachable','Ulaşılabilen tek barındırıcı'):t(`${i+1} hosts reachable`,`${i+1} barındırıcı ulaşılabilir`)} ×${m}</li>`).join('')}<li>${t(`${multipliers.length+1} or more hosts`,`${multipliers.length+1} ve daha fazla barındırıcı`)} ×1</li></ul>
  <p>${t('Your verified hours in the last 24 hours','Son 24 saatte doğrulanmış saatlerin')} <strong>${myHours.length}</strong> · RaiUnyt <strong>${e(formatUnyt(myHours.reduce((sum,h)=>sum+h.amount,0)))}</strong></p>
  ${recent.length?`<details><summary>${t('Reachable hosts per hour (last 24 hours)','Saat başına ulaşılabilen barındırıcı (son 24 saat)')}</summary><ul>${recent.map(([hour,count])=>`<li>${e(formatCheck(hour))} · ${count} · ×${multiplierFor(multipliers,count)}</li>`).join('')}</ul></details>`:''}
  ${may('hosting')?`<form id="policy-form" class="row"><label class="inline">${t('One host','Tek barındırıcı')} ×<input id="policy-1" type="number" min="1" max="10" value="${multipliers[0]??1}"></label><label class="inline">${t('Two hosts','İki barındırıcı')} ×<input id="policy-2" type="number" min="1" max="10" value="${multipliers[1]??1}"></label><button class="primary">${t('Save bonus','Bonusu kaydet')}</button></form><p class="muted">${t('Applies from now on; earlier hours keep the bonus in force at the time.','Bundan sonrası için geçerli. Önceki saatler o anki bonusla kalır.')}</p>`:''}
 </section>
 <h3>${t('Community hosting','Topluluk barındırması')}</h3>
 <p class="muted">${t('Every hour the apps of the founder, reviewers and organizers with the hosting permission share the checks among themselves automatically, in four 15-minute windows. A checked hour is signed by your device and the checker; your app publishes your verified hours about every 6 hours, so new hours appear with a delay.','Kurucu, kontrolcüler ve barındırma izni olan yöneticilerin uygulamaları her saat kontrolleri dört 15 dakikalık pencerede kendi aralarında otomatik paylaşır. Kontrol edilen saati cihazın ve kontrolcü imzalar; uygulaman doğrulanmış saatlerini yaklaşık 6 saatte bir yayımlar, bu yüzden yeni saatler gecikmeyle görünür.')}</p>
 <div class="row"><h4>${t('Full copy','Tam kopya')}</h4>${info(t('Full copy','Tam kopya'),`<p>${e(fullCopyText())}</p><p>${t('Turquoise: a full copy was verified in the last 24 hours. Grey: no verified full copy.','Turkuaz: son 24 saatte tam kopya doğrulandı. Gri: doğrulanmış tam kopya yok.')}</p>`)}</div>
 ${symbols()}${listSearch('hosts')}
 <div class="directory">${page.items.map(([id,offer])=>{
   const observations = (checks.get(offer.hash)??[]).sort((a,b)=>b.time-a.time);
   const latest = observations[0];
   const verified = observations.find(check=>check.success);
   const target = monthTargets.get(id);
   const full = fullCopyRecent(id);
   return `<div class="card"><h3>${memberName(id)}</h3>
     <p class="full-copy-cell">${full?`<span class="member-symbol fullcopy" aria-hidden="true">◈</span> ${t('Full copy','Tam kopya')}`:`<span class="member-symbol fullcopy-none" aria-hidden="true">◇</span> <span class="muted">${t('No verified full copy','Doğrulanmış tam kopya yok')}</span>`}</p>
     ${verified?`<p>${t('Last successful check','Son başarılı ölçüm')} · ${e(formatCheck(verified.time))}</p>`:''}
     ${!latest?`<p class="muted">${t('Waiting for a check.','İlk ölçüm bekleniyor.')}</p>`:!latest.success?`<p class="muted">${t('The device did not respond at the last check.','Son ölçümde cihazdan yanıt alınamadı.')} · ${e(formatCheck(latest.time))}</p>`:''}
     ${target?progress(target):''}</div>`;
 }).join('')}</div>${listPager('hosts',page)}`;
 const saveTarget = (targetHours:number)=>run(async()=>{
  if (hostingMonth()!==month) {
   await refresh();
   throw Error(t('A new month has started. Enter a goal for this month.','Yeni ay başladı. Bu ay için hedef gir.'));
  }
  await publish({type:'module',module:'hosting',version:1,kind:'monthly-target',admin:false,
    payload:JSON.stringify({month,hours:targetHours,revision:crypto.randomUUID()})});
  await refresh();
 });
 root.querySelector('#hosting-target-form')?.addEventListener('submit',event=>{
  event.preventDefault();
  const targetHours = Number(val('hosting-target-hours'));
  if (Number.isInteger(targetHours)&&targetHours>0&&targetHours<=hoursInHostingMonth(month)) void saveTarget(targetHours);
 });
 root.querySelector('#remove-hosting-target')?.addEventListener('click',()=>void saveTarget(0));
 root.querySelector<HTMLFormElement>('#policy-form')?.addEventListener('submit',ev=>{
  ev.preventDefault();
  void run(async()=>{
   const one=Number(val('policy-1')),two=Number(val('policy-2'));
   if(![one,two].every(n=>Number.isInteger(n)&&n>=1&&n<=10)||two>one)
    throw Error(t('Use whole numbers from 1 to 10; two hosts cannot earn more than one host.','1–10 arası tam sayı kullan. İki barındırıcı tek barındırıcıdan fazla kazanamaz.'));
   await publish({type:'hosting_policy',multipliers:[one,two]});
   await refresh();
  });
 });
}

/** Plan G1: a host keeps signed hours from checkers and publishes them about every 6 hours. */
const proofKey=()=>membership?`rai.attest.${community}.${mine()}`:'';
function keptProofs():{hours:any[],published:number}{try{return JSON.parse(localStorage.getItem(proofKey())||'')}catch{return{hours:[],published:Date.now()}}}
function keepProof(proof:any){
 if(!proofKey()||!proof)return;
 const kept=keptProofs();
 kept.hours=keepAttestation(kept.hours,proof);
 try{localStorage.setItem(proofKey(),JSON.stringify(kept));}catch{}
}
/** Plan B1: failed checks stay on this device only (last 24 hours). */
function noteCheck(result:any){
 const key=`rai.checks.${community}`;let list:any[]=[];try{list=JSON.parse(localStorage.getItem(key)||'[]')}catch{}
 list=[...list.filter(x=>Date.now()-x.at<24*3_600_000),{at:Date.now(),...result}].slice(-500);
 try{localStorage.setItem(key,JSON.stringify(list));}catch{}
}
/** The checker keeps a copy of each attestation for 3 days (plan G1). */
function keepCheckerCopy(proof:any){
 const key=`rai.checker-copies.${community}`;let list:any[]=[];try{list=JSON.parse(localStorage.getItem(key)||'[]')}catch{}
 list=[...list.filter(x=>Date.now()-x.at<3*86_400_000),{at:Date.now(),proof}];
 try{localStorage.setItem(key,JSON.stringify(list));}catch{}
}
/** Founder, reviewers and organizers with the hosting permission. */
function authorizedCheckers(s:Snapshot){
 const ids=new Set<string>([s.community.founder]);
 for(const m of currentMembers(s) as MemberView[]){const id=m.data.member_id;if(removed(s,id))continue;if(currentRole(s,id)||can(s,id,'hosting'))ids.add(id);}
 return [...ids].sort();
}
let hostingWork = false;
let releaseInFlight = false;
let announcedPlan = '';
const doneChecks = new Set<string>();

function scheduleRelease() {
 if (releaseInFlight||hostingWork||busy||pending||!memberReady()||!api||!membership||!api.runtimeConnected()||!navigator.onLine) return;
 const plan = autoReleasePlan(settings,__APP_VERSION__,founder()||may('release'));
 if (!plan) return;
 const key = [community,membership.hash,plan.hash].join(':');
 if (key===announcedPlan) return;
 releaseInFlight = true;
 void publish(settingBody('windows-release-auto',{plan:plan.hash})).then(()=>{
   announcedPlan = key;
 }).catch(error=>{
   console.debug('Automatic update announcement will retry on refresh.',error);
 }).finally(()=>{
   releaseInFlight = false;
   scheduleHosting();
 });
}

function scheduleHosting() {
 if (hostingWork||releaseInFlight||busy||pending||!memberReady()||!api||!snapshot||!membership||!api.runtimeConnected()||!navigator.onLine) return;
 const connection = api, s = snapshot, member = membership, address = community;
 const binding = member.hash;
 hostingWork = true;
 void (async()=>{
  // Host: register once, then publish kept hours about every 6 hours.
  const offer = latestDeviceOffer(s,member);
  if (hostingEnabled && !offer?.data.body.enabled) {
   try { await connection.ensureHosting(address,binding); }
   catch (err) { console.debug('Hosting registration will retry on refresh.',err); }
  }
  const kept=keptProofs();
  const withdrawing = networkSettings?.fullCopy === false && !!offer?.data.body.enabled;
  if ((hostingEnabled && summaryDue(kept.hours,kept.published,Date.now())) || (withdrawing && kept.hours.length)) {
   try {
    await connection.publishSummary(address,binding,kept.hours);
    localStorage.setItem(proofKey(),JSON.stringify({hours:[],published:Date.now()}));
   } catch (err) {
    console.debug('Hosting summary will retry.',err);
    if(withdrawing)return;
   }
  }
  if (withdrawing) {
   try {
    await connection.publish(address,binding,{type:'host_offer',enabled:false});
    await refresh({offers:true,mine:true});
   } catch (err) { console.debug('Hosting withdrawal will retry.',err); }
  }
  // Checker: leaderless windows (plan B2).
  const authorized=authorizedCheckers(s);
  if (membership?.hash!==binding||community!==address||!memberReady()||!authorized.includes(mine())) return;
  const hosts=currentHostingOffers(s).map(([hostId,offer])=>({hostId,offer:offer.hash}));
  const recent=new Set<string>();
  for (const check of hostingObservations(s)) if (Date.now()-check.time/1000<ACTIVE_MS) recent.add(check.observer);
  const targets=await dueTargets({me:mine(),nowMs:Date.now(),hosts,authorized,recent,covered,done:doneChecks});
  if (!targets.length) return;
  const storage=storageChallenge(s,Date.now()*1000);
  await limited(targets,async (target:any)=>{
   // Spread the checks inside the window.
   await new Promise(r=>setTimeout(r,Math.random()*20_000));
   if (membership?.hash!==binding||community!==address) return;
   doneChecks.add(target.offer+'|'+target.hour);
   try {
    const result=await connection.probe(address,binding,target.offer,storage);
    if (result.proof) keepCheckerCopy(result.proof);
    if (!result.success) noteCheck({host:target.hostId,detail:result.detail});
   } catch (err) { noteCheck({host:target.hostId,detail:String((err as Error)?.message||err).slice(0,200)}); }
  },8,30_000);
 })().finally(()=>{ hostingWork=false; });
}

/** Background refresh: signals first, then about every 2 minutes. While the window is hidden only
 * hosting runs (plan H3); it refreshes the hosting offers every 5 minutes. */
let lastPoll = 0;
async function backgroundRefresh(scope:any=LIGHT_SCOPE){
 if(poll||busy||pending||!api||!community)return;
 lastPoll=Date.now();
 poll=true;
 try {
  await refresh(scope);
  paintReleaseNotice();
  scheduleRelease();
  scheduleHosting();
  if(!document.hidden&&!dirty&&!root.querySelector('.info[open],dialog[open]')
    &&!root.querySelector((screen==='chat'?'':'form,')+'input:focus,textarea:focus,select:focus')) render();
 } catch(err) {
  console.debug('Community refresh failed.',err);
 } finally { poll=false; }
}
setInterval(()=>{
 if(document.hidden){if(Date.now()-lastPoll>=5*60_000)void backgroundRefresh({offers:true});}
 else if(Date.now()-lastPoll>=2*60_000) void backgroundRefresh();
 // Hosting runs every minute, also while minimized; screens do not refresh then.
 scheduleHosting();
},60_000);
render();void run(connect);
