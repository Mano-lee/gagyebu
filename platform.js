// 새 앱은 이 목록에 추가한다. 앱 선택과 공통 설정은 개별 앱 메뉴와 분리한다.
const PLATFORM_APPS=[
  {id:'ledger',name:'가계부',icon:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M15 13h6M6 5V3h12"/>',alerts:ledgerPlatformAlerts},
  {id:'fridge',name:'냉장고',icon:'<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M5 10h14M8 6v1M8 14v3"/>',alerts:fridgePlatformAlerts}
];
let activeApp='platform',fridgeSection='active',currentAppRoute={id:'platform',section:''};
// history.back()은 비동기다. 닫기 직후 새 창이나 앱을 열면 popstate 이후에 그 이동을 이어간다.
let sheetHistoryBackPending=false,sheetHistoryNextDialog=null,sheetHistoryNextRoute=null;

function appIcon(app){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${app.icon}</svg>`}
function openPlatform(){navigateApp('platform')}
function openApp(id,section=''){navigateApp(id,section)}
function openSharedSettings(){navigateApp('settings')}
function navigateApp(id,section=''){
  const route=normalizeAppRoute(id,section);
  if(!closeAppSheet())return;
  if(sheetHistoryBackPending){sheetHistoryNextRoute=route;return}
  commitAppRoute(route);
}
function commitAppRoute(route){
  const hash='#'+route.id+(route.section?'/'+route.section:'');
  if(!applyAppRoute(route))return;
  if(window.location.hash!==hash)window.history.pushState(null,'',hash);
}
function normalizeAppRoute(id,section=''){
  if(id==='ledger')return {id,section:['home','list','set'].includes(section)?section:'home'};
  if(id==='fridge')return {id,section:['active','pending','history','soon'].includes(section)?section:'active'};
  return {id:id==='settings'?'settings':'platform',section:''};
}
function currentAppSheet(){
  if($('foodSheet').classList.contains('show'))return {kind:'food',id:foodEditId,taskId:foodTaskId};
  if($('sheet').classList.contains('show'))return {kind:'transaction',id:editId,planId:fromPlan,period:S.cur};
  if($('fxSheet').classList.contains('show'))return {kind:'fixed',index:editFx,period:S.cur,item:editFx===null?null:JSON.stringify(cur().fixed[editFx])};
  return null;
}
function closeAppSheet(force=false,fromHistory=false){
  const dialog=currentAppSheet();
  if(!dialog)return true;
  if(dialog.kind==='food')return closeFoodSheet(force,fromHistory);
  if(dialog.kind==='transaction')return closeSheet(force,fromHistory);
  return closeFx(force,fromHistory);
}
function appSheetFromState(state){
  // 이전 버전에서 열린 식재료 창의 기록도 새 공통 처리로 복원한다.
  return state?.appSheet||(state?.foodSheet?{kind:'food',...state.foodSheet}:null);
}
function trackAppSheetHistory(dialog=currentAppSheet()){
  sheetHistoryNextRoute=null;
  if(sheetHistoryBackPending){sheetHistoryNextDialog=dialog;return}
  const method=appSheetFromState(window.history.state)?'replaceState':'pushState';
  const {foodSheet,...state}=window.history.state||{};
  window.history[method]({...state,appSheet:dialog},'',window.location.href);
}
function leaveAppSheetHistory(){
  sheetHistoryNextDialog=null;
  if(appSheetFromState(window.history.state)&&!sheetHistoryBackPending){sheetHistoryBackPending=true;window.history.back()}
}
function restoreAppSheetHistory(dialog){
  if(dialog.kind==='food'){
    if((dialog.id&&!(S.foods||{})[dialog.id])||(dialog.taskId&&!sourceTx(dialog.taskId))){leaveAppSheetHistory();return}
    openFoodSheet(dialog.id||null,dialog.taskId||null);return;
  }
  if(!S.p[dialog.period]){leaveAppSheetHistory();return}
  if(dialog.kind==='transaction'){
    if((dialog.id&&!findTx(dialog.id))||(dialog.planId&&findTx(dialog.planId)?.a!=='plan')){leaveAppSheetHistory();return}
    if(S.cur!==dialog.period){S.cur=dialog.period;selDay=selCat=null;render()}
    if(dialog.planId)confirmPlan(dialog.planId);else openSheet(dialog.id);
  }else if(dialog.kind==='fixed'){
    // 고정지출은 배열로 저장되므로 삭제 후 같은 위치의 다른 항목을 열지 않는다.
    if(dialog.index!==null&&JSON.stringify(S.p[dialog.period].fixed[dialog.index])!==dialog.item){leaveAppSheetHistory();return}
    if(S.cur!==dialog.period){S.cur=dialog.period;selDay=selCat=null;render()}
    openFx(dialog.index===null?undefined:dialog.index);
  }
}
function handleAppSheetPop(event){
  if(sheetHistoryBackPending){
    const dialog=sheetHistoryNextDialog,route=sheetHistoryNextRoute;
    sheetHistoryBackPending=false;sheetHistoryNextDialog=sheetHistoryNextRoute=null;
    if(dialog&&currentAppSheet())trackAppSheetHistory(dialog);
    else if(route)commitAppRoute(route);
    return true;
  }
  const dialog=currentAppSheet();
  if(dialog){
    // 취소하면 현재 입력 그대로 수정창의 이동 단계를 다시 등록한다.
    if(!closeAppSheet(false,true))trackAppSheetHistory(dialog);
    return true;
  }
  const restored=appSheetFromState(event.state);
  if(restored){
    const [id,section]=(window.location.hash||'').replace(/^#/,'').split('/'),route=normalizeAppRoute(id,section);
    if(route.id===currentAppRoute.id&&route.section===currentAppRoute.section){restoreAppSheetHistory(restored);return true}
  }
  return false;
}
function restoreAppRoute(event){
  if(event&&handleAppSheetPop(event))return;
  const [id,section]=(window.location.hash||'').replace(/^#/,'').split('/');
  if(!applyAppRoute(normalizeAppRoute(id,section))){window.history.replaceState(null,'','#'+currentAppRoute.id+(currentAppRoute.section?'/'+currentAppRoute.section:''));return}
  const dialog=appSheetFromState(window.history.state);if(dialog)restoreAppSheetHistory(dialog);
}
function applyAppRoute(route){
  // 이동하기 전에 열린 입력창의 저장하지 않은 내용을 확인한다.
  if(!closeAppSheet(false,true))return false;
  currentAppRoute=route;
  activeApp=route.id;
  if(activeApp==='ledger')tab=route.section;
  if(activeApp==='fridge'){
    fridgeSection=route.section;foodView=route.section==='pending'?'active':route.section;
    foodStore='all';foodQuery='';
  }
  render();
  window.scrollTo?.({top:0,behavior:'instant'});
  if(activeApp==='fridge'&&fridgeSection==='pending')$('foodTasks')?.scrollIntoView?.({block:'start'});
  return true;
}
function updatePlatformShell(){
  const ledger=activeApp==='ledger',fridge=activeApp==='fridge',hub=!ledger&&!fridge;
  document.body.classList.toggle('platform-mode',hub);
  $('appShell').hidden=hub;
  $('platformHeader').hidden=!hub;
  $('ledgerHeader').hidden=!ledger;
  $('fridgeHeader').hidden=!fridge;
  $('ledgerNav').hidden=!ledger;
  $('fridgeNav').hidden=!fridge;
  $('sharedSettingsButton').hidden=activeApp==='settings';
  $('platformHomeButton').hidden=activeApp!=='settings';
  $('appLabel').textContent=ledger?'가계부':'냉장고';
  const current=fridgeSection==='pending'?'pending':foodView==='history'?'history':'active';
  ['active','pending','history'].forEach(id=>{
    $('f-'+id).classList.toggle('on',fridge&&id===current);
    $('f-'+id).setAttribute('aria-current',fridge&&id===current?'page':'false');
  });
  document.title=hub?(activeApp==='settings'?'공통 설정 · 내 생활':'내 생활'):(ledger?'가계부':'냉장고')+' · 내 생활';
}
function ledgerPlatformAlerts(){
  const key=periodOf(today()),period=S.p[key];if(!period)return [];
  let fixed=period.fixed.filter(f=>!f.done&&daysLeft(key,f)<=0).length;
  const bill=cardBill(key);if(bill.amt&&!period.cardDone&&daysLeft(key,{day:cardDay()})<=0)fixed++;
  const plans=(period.plan||[]).filter(t=>t.date<=today()).length;
  return fixed||plans?[{id:'platformLedgerAlert',section:'home',text:[fixed?`확인할 고정지출 ${fixed}건`:'',plans?`확정할 예정지출 ${plans}건`:''].filter(Boolean).join(' · ')}]:[];
}
function fridgePlatformAlerts(){
  const alerts=[],pending=pendingFoodTasks().length;
  const soon=foodItems().filter(f=>f.status==='active'&&foodDays(f.bestBefore)!==null&&foodDays(f.bestBefore)<=3).length;
  if(pending)alerts.push({id:'platformPendingAlert',section:'pending',text:`식재료 등록 대기 ${pending}건`});
  if(soon)alerts.push({id:'platformSoonAlert',section:'soon',text:`기한 임박·경과 ${soon}개 품목`});
  return alerts;
}
function platformAlerts(){return PLATFORM_APPS.flatMap(app=>(app.alerts?app.alerts():[]).map(alert=>({...alert,app})))}
function platformPage(){
  const alerts=platformAlerts();
  return `${alerts.length?`<section class="platform-alerts" aria-label="앱 알림"><h1>알림 <span>${alerts.length}</span></h1>${alerts.map(alert=>`<button id="${alert.id}" class="platform-alert" data-app="${alert.app.id}" onclick="openApp('${alert.app.id}','${alert.section}')"><span class="alert-app-icon app-${alert.app.id}" aria-hidden="true">${appIcon(alert.app)}</span><span class="platform-alert-copy"><span class="platform-alert-app">${esc(alert.app.name)}</span><span class="platform-alert-text">${esc(alert.text)}</span></span><span class="platform-alert-arrow" aria-hidden="true">›</span></button>`).join('')}</section>`:''}
  <section class="platform-apps" aria-label="내 앱">${PLATFORM_APPS.map(app=>`<button id="t-${app.id}" class="app-launch app-${app.id}" onclick="openApp('${app.id}')" aria-label="${esc(app.name)} 열기"><span class="app-icon">${appIcon(app)}</span><span class="app-name">${esc(app.name)}</span></button>`).join('')}</section>`;
}

window.addEventListener('popstate',restoreAppRoute);
