// 새 앱은 이 목록에 추가한다. 앱 선택과 공통 설정은 개별 앱 메뉴와 분리한다.
const PLATFORM_APPS=[
  {id:'ledger',name:'가계부',description:'수입과 지출, 남은 예산을 확인해요.',icon:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M15 13h6M6 5V3h12"/>'},
  {id:'fridge',name:'냉장고',description:'장을 본 기록을 식재료로 정리해요.',icon:'<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M5 10h14M8 6v1M8 14v3"/>'}
];
let activeApp='platform',fridgeSection='active',currentAppRoute={id:'platform',section:''};

function appIcon(app){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${app.icon}</svg>`}
function openPlatform(){navigateApp('platform')}
function openApp(id,section=''){navigateApp(id,section)}
function openSharedSettings(){navigateApp('settings')}
function navigateApp(id,section=''){
  const route=normalizeAppRoute(id,section),hash='#'+route.id+(route.section?'/'+route.section:'');
  if(!applyAppRoute(route))return;
  if(window.location.hash!==hash)window.history.pushState(null,'',hash);
}
function normalizeAppRoute(id,section=''){
  if(id==='ledger')return {id,section:['home','list','set'].includes(section)?section:'home'};
  if(id==='fridge')return {id,section:['active','pending','history','soon'].includes(section)?section:'active'};
  return {id:id==='settings'?'settings':'platform',section:''};
}
function restoreAppRoute(){
  const [id,section]=(window.location.hash||'').replace(/^#/,'').split('/');
  if(!applyAppRoute(normalizeAppRoute(id,section)))window.history.replaceState(null,'','#'+currentAppRoute.id+(currentAppRoute.section?'/'+currentAppRoute.section:''));
}
function applyAppRoute(route){
  // 이동하기 전에 저장하지 않은 제품 입력을 확인한다.
  if($('foodSheet').classList.contains('show')){closeFoodSheet();if($('foodSheet').classList.contains('show'))return false}
  closeSheet();closeFx();
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
function platformPage(){
  // 홈의 예산은 사용자가 마지막으로 보고 있던 과거 기간과 무관하게 현재 기간을 표시한다.
  const key=periodOf(today()),period=ensure(key),budget=calc(key),pending=pendingFoodTasks().length;
  const active=foodItems().filter(f=>f.status==='active');
  const soon=active.filter(f=>{const n=foodDays(f.bestBefore);return n!==null&&n<=3}).length;
  const summaries={
    ledger:`<div class="app-metric"><span>이번 기간 남은 예산</span><strong>${period.start===null?'잔고 미입력':won(budget.remain)}</strong></div><p class="app-detail">${esc(periodLabel(key))}</p>`,
    fridge:`<div class="app-metric"><span>보관 중인 식재료</span><strong>${active.length}<small>개 품목</small></strong></div><div class="app-shortcuts"><button id="platformPending" onclick="openApp('fridge','pending')">등록 대기 <b>${pending}건</b><span aria-hidden="true">›</span></button><button id="platformSoon" onclick="openApp('fridge','soon')">기한 임박·경과 <b>${soon}개</b><span aria-hidden="true">›</span></button></div>`
  };
  return `<section class="platform-intro"><p class="platform-eyebrow">나의 생활 공간</p><h1>오늘도, 내 생활</h1><p>필요한 앱을 열고 일상을 이어가세요.</p></section>
  ${pending?`<section class="platform-alert" aria-label="식재료 등록 알림"><div><span class="platform-alert-dot" aria-hidden="true"></span><div><strong>구매한 식재료가 기다리고 있어요.</strong><p>장보기 ${pending}건의 제품 정보를 등록해 주세요.</p></div></div><button id="platformPendingAlert" onclick="openApp('fridge','pending')">등록하러 가기 <span aria-hidden="true">→</span></button></section>`:''}
  <div class="platform-section-title"><h2>내 앱 <span>${PLATFORM_APPS.length}</span></h2><p>한곳에서 관리하는 일상</p></div>
  <section class="platform-apps" aria-label="내 앱">${PLATFORM_APPS.map(app=>`<article class="app-card app-${app.id}"><button id="t-${app.id}" class="app-launch" onclick="openApp('${app.id}')"><span class="app-icon">${appIcon(app)}</span><span class="app-launch-text"><span class="app-name">${esc(app.name)}</span><span class="app-description">${esc(app.description)}</span></span><span class="app-arrow" aria-hidden="true">↗</span></button><div class="app-summary">${summaries[app.id]||''}</div><button class="app-enter" onclick="openApp('${app.id}')">${esc(app.name)} 열기 <span aria-hidden="true">→</span></button></article>`).join('')}</section>
  <p class="platform-footnote">동기화와 백업은 <button onclick="openSharedSettings()">공통 설정</button>에서 함께 관리해요.</p>`;
}

window.addEventListener('popstate',restoreAppRoute);
