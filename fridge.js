// 식품 구매 알림은 지출에서 파생하고, 재고는 예산 기간과 독립적으로 보관한다.
const FOOD_STORES={chilled:'냉장',frozen:'냉동',pantry:'실온'};
const FOOD_STATES={active:'보관 중',consumed:'다 먹음',discarded:'폐기'};
let foodStore='all',foodView='active',foodQuery='';
let foodEditId=null,foodTaskId=null,foodDraftBaseline='';
let foodPreviousFocus=null;
let foodExpirySteps=[],foodExpiryAnchor=null;
const FOOD_EXPIRY_PRESETS={'1d':{label:'1일',days:1},'1w':{label:'1주',days:7},'1m':{label:'1개월',months:1},'3m':{label:'3개월',months:3},'6m':{label:'6개월',months:6}};
let lastFoodUse=null;
const FOOD_COUNT_UNITS=new Set(['개','통','팩','봉','봉지','병','캔','컵','장','쪽','모','알','덩이','덩어리','조각','인분','회분','세트','포','줄','롤','묶음','판','마리','상자']);
const foodAmount=n=>Number(n).toLocaleString('ko-KR',{maximumSignificantDigits:12});
const foodCountable=f=>FOOD_COUNT_UNITS.has(String(f.unit||'개').trim());
// 다 먹은 기록은 상태로 잔량 0을 표현한다. quantity는 복원할 마지막 수량을
// 양수로 보존해, 기존 앱 버전의 백업 검증에서도 정상적으로 읽을 수 있게 한다.
const foodRemaining=f=>f.status==='consumed'?0:f.quantity;

function prepareFoodData(data){
  if(!data||typeof data!=='object'||!data.p||Array.isArray(data.p)||typeof data.p!=='object')throw new Error('invalid-data');
  for(const p of Object.values(data.p))if(!p||!Array.isArray(p.tx)||!Array.isArray(p.fixed))throw new Error('invalid-data');
  if(data.foods!==undefined&&(!data.foods||Array.isArray(data.foods)||typeof data.foods!=='object'))throw new Error('invalid-foods');
  const foods={};
  for(const [id,f] of Object.entries(data.foods||{})){
    if(!f||f.id!==id||!/^[a-zA-Z0-9_-]+$/.test(id)||['__proto__','constructor','prototype'].includes(id)||typeof f.name!=='string'||!Object.hasOwn(FOOD_STORES,f.store)||!Object.hasOwn(FOOD_STATES,f.status)||!Number.isFinite(f.quantity)||f.quantity<=0)throw new Error('invalid-food');
    const item={...f,initialQuantity:Math.max(f.quantity,Number.isFinite(f.initialQuantity)?f.initialQuantity:0)};
    delete item.openedAt;
    // 예전 '다 먹음' 기록의 수량은 복원용으로 보존하고 남은 수량은 0으로 읽는다.
    if(item.status==='consumed'&&item.quantity>0)item.restoreQuantity=item.quantity;
    foods[id]=item;
  }
  return {...data,schemaVersion:Math.max(3,Number(data.schemaVersion)||0),foods};
}
function foodItems(){return Object.values(S.foods||{})}
function foodPurchases(){return Object.values(S.p).flatMap(p=>p.tx).filter(t=>t.type==='out'&&Array.isArray(t.foodStores)&&t.foodStores.some(s=>Object.hasOwn(FOOD_STORES,s))).sort(byDate)}
function pendingFoodTasks(){return foodPurchases().filter(t=>!['done','skipped'].includes(t.foodState))}
function foodsForTask(id){return foodItems().filter(f=>f.txId===id)}
function sourceTx(id){const f=id&&findTx(id);return f&&f.a==='tx'&&f.t.type==='out'?f.t:null}
function selectedFoodStores(){return [...document.querySelectorAll('#fFoodW input:checked')].map(el=>el.value)}
function fillFoodStores(stores=[]){document.querySelectorAll('#fFoodW input').forEach(el=>{el.checked=stores.includes(el.value)})}
function applyFoodPurchase(rec,old,stores){
  if(rec.type!=='out'||!stores.length){delete rec.foodStores;delete rec.foodState;return rec}
  rec.foodStores=stores;
  const added=stores.some(s=>!(old&&old.foodStores||[]).includes(s));
  rec.foodState=added?'pending':old&&old.foodState||'pending';
  return rec;
}
function updateFoodNav(){
  const count=pendingFoodTasks().length;
  $('foodNavCount').textContent=count||'';
  $('f-pending').setAttribute('aria-label','식재료 등록 대기'+(count?` ${count}건`:''));
  const fab=$('addRecord');
  fab.setAttribute('aria-label',activeApp==='fridge'?'식재료 직접 등록':'기록 추가');
  fab.querySelector('.fabt').textContent=activeApp==='fridge'?' 식재료 추가':' 기록 추가';
}
function foodTaskSummary(){const n=pendingFoodTasks().length;return n?`<div class="card food-task food-task-summary"><div><strong>구매한 식재료를 등록해 주세요 · ${n}건</strong><p class="food-help">가계부에 체크한 식품이 냉장고에서 기다리고 있어요.</p></div><button class="btn" onclick="openApp('fridge','pending')">냉장고 보기</button></div>`:''}
function foodSourceText(t){return `${t.date} · ${t.memo||t.cat} · ${won(t.amt)}`}
function foodTaskCard(t,history=false){
  const n=foodsForTask(t.id).length,stores=t.foodStores.filter(s=>Object.hasOwn(FOOD_STORES,s)).map(s=>FOOD_STORES[s]).join(' · ');
  return `<div class="card${history?'':' food-task'}"><div class="food-task-title"><strong>${esc(t.memo||t.cat)}</strong><span>${won(t.amt)}</span></div>
  <p class="food-task-meta">${t.date} · ${esc(stores)}<br>${n?`${n}개 품목 등록됨 · `:''}${history?(t.foodState==='skipped'?'등록할 식재료 없음':'등록 완료'):'구매한 제품을 하나씩 추가해 주세요.'}</p>
  <div class="food-actions"><button class="btn${history?' ghost':''}" onclick="openFoodTask(${t.id})">${history?'제품 추가·확인':'식재료 등록하기'}</button>${history?'':`<button class="btn ghost" onclick="skipFoodTask(${t.id})">등록할 식재료 없음</button>`}</div></div>`;
}
function foodDays(date){if(!date)return null;const days=(Date.parse(date+'T00:00:00Z')-Date.parse(today()+'T00:00:00Z'))/864e5;return Number.isFinite(days)?Math.round(days):null}
function foodExpiry(f){const n=foodDays(f.bestBefore);return n===null?{text:'기한 미입력',cls:''}:n<0?{text:`표시 기한 ${-n}일 지남`,cls:'past'}:n===0?{text:'표시 기한 오늘',cls:'soon'}:n<=3?{text:`표시 기한 D-${n}`,cls:'soon'}:{text:`표시 기한 ${f.bestBefore}`,cls:''}}
function foodStorageSummary(store,items=foodItems()){
  const summary={count:0,soon:0,expired:0,unknown:0};
  for(const f of items){
    if(f.status!=='active'||f.store!==store)continue;
    summary.count++;const days=foodDays(f.bestBefore);
    if(days===null)summary.unknown++;else if(days<0)summary.expired++;else if(days<=3)summary.soon++;
  }
  return summary;
}
function foodStorageStatus(summary){
  if(!summary.count)return '<span class="storage-status"><span class="storage-note">비어 있어요</span></span>';
  const badges=[];
  if(summary.soon)badges.push(`<span class="storage-badge soon">임박 ${summary.soon}</span>`);
  if(summary.expired)badges.push(`<span class="storage-badge past">기한 지남 ${summary.expired}</span>`);
  if(!summary.soon&&!summary.expired&&summary.count>summary.unknown)badges.push('<span class="storage-badge clear">임박 없음</span>');
  if(summary.unknown)badges.push(`<span class="storage-note">기한 미입력 ${summary.unknown}</span>`);
  return `<span class="storage-status">${badges.join('')}</span>`;
}
function selectFoodStorage(store){
  if(!Object.hasOwn(FOOD_STORES,store))return;
  openApp('fridge');foodStore=store;render();
  $('foodList')?.scrollIntoView?.({block:'start',behavior:'smooth'});
}
function foodStorageOverview(items){
  const summary=Object.fromEntries(Object.keys(FOOD_STORES).map(store=>[store,foodStorageSummary(store,items)]));
  const icons={frozen:'<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M8 4l4 3 4-3M8 20l4-3 4 3"/>',chilled:'<path d="M5 20C0 10 8 3 21 3c0 13-7 21-16 17Zm0 0L16 9"/>',pantry:'<path d="m3 7 9-4 9 4v11l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v11M8 5l9 4"/>'};
  const contents=store=>`<span class="storage-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[store]}</svg>${store==='pantry'?'실온':FOOD_STORES[store]+'실'}</span><span class="storage-count"><strong>${summary[store].count}</strong><small>개 품목</small></span>${foodStorageStatus(summary[store])}`;
  const attributes=store=>`id="storage-${store}" data-store="${store}" aria-pressed="${foodView==='active'&&foodStore===store}" aria-label="${FOOD_STORES[store]} 보관 ${summary[store].count}개 품목, 기한 임박 ${summary[store].soon}개, 기한 경과 ${summary[store].expired}개, 기한 미입력 ${summary[store].unknown}개. 목록 보기" onclick="selectFoodStorage('${store}')"`;
  return `<section class="storage-overview" aria-label="보관 장소별 식재료 현황"><div class="storage-overview-heading"><h2>우리 집 보관함</h2><span>총 ${items.length}개 품목</span></div><p class="storage-instruction">냉장고와 박스를 눌러 재료를 확인하세요.</p>
  <div class="storage-scene"><div class="storage-column"><div class="fridge-appliance" role="group" aria-label="냉장고"><button class="storage-door freezer-door" ${attributes('frozen')}>${contents('frozen')}</button><button class="storage-door chiller-door" ${attributes('chilled')}>${contents('chilled')}</button></div><p class="storage-caption">냉장고</p></div>
  <div class="storage-column pantry-column"><div class="pantry-box"><svg class="box-flaps" viewBox="0 0 240 100" preserveAspectRatio="none" aria-hidden="true"><path d="m20 56 100-28 100 28-100 27Z" fill="#a77d50"/><path d="m20 56 100-28L94 4 0 30Z" fill="#e8cba3" stroke="#c6a075" stroke-linejoin="round"/><path d="m120 28 100 28 20-26-94-26Z" fill="#f0d7b7" stroke="#c6a075" stroke-linejoin="round"/><path d="m20 56 100 27-28 17L0 73Z" fill="#dfba8b" stroke="#bf986d" stroke-linejoin="round"/><path d="m120 83 100-27 20 17-92 27Z" fill="#e9c9a1" stroke="#bf986d" stroke-linejoin="round"/></svg><button class="pantry-body" ${attributes('pantry')}><span class="pantry-label">${contents('pantry')}</span></button></div><p class="storage-caption">실온 보관함</p></div></div>
  <p class="storage-footnote">임박: 오늘부터 3일 이내 · 기한 지남: 지난 날짜<br>수량 대신 등록한 품목 수를 표시해요.</p></section>`;
}
function setFoodView(view){openApp('fridge',view)}
function setFoodStore(store){foodStore=store;render()}
function filterFoods(value){foodQuery=value;const input=$('foodSearch'),pos=input.selectionStart;render();$('foodSearch').focus();$('foodSearch').setSelectionRange(pos,pos)}
function foodStockSnapshot(f){return Object.fromEntries(['quantity','initialQuantity','unit','status','finishedAt','restoreQuantity'].map(key=>[key,f[key]]))}
function applyFoodStatus(f,status){
  f.initialQuantity=Math.max(f.quantity,f.initialQuantity||0);
  if(status==='consumed'&&f.quantity>0)f.restoreQuantity=f.quantity;
  if(status==='active')delete f.finishedAt;else if(f.status!==status||!f.finishedAt)f.finishedAt=today();
  f.status=status;
}
function useFood(id){
  const f=(S.foods||{})[id];
  if(!f||f.status!=='active'||!foodCountable(f)||f.quantity<=0)return false;
  const before=foodStockSnapshot(f),used=Math.min(1,f.quantity);
  f.initialQuantity=Math.max(f.quantity,f.initialQuantity||0);
  if(f.quantity<=1)applyFoodStatus(f,'consumed');else f.quantity=Number((f.quantity-1).toPrecision(12));
  lastFoodUse={id,before,after:foodStockSnapshot(f),used,name:f.name,unit:f.unit||'개'};
  save();render();
  ($(f.status==='active'?'use-'+id:'undoFoodUse'))?.focus?.({preventScroll:true});
  return true;
}
function undoFoodUse(){
  if(!lastFoodUse)return false;
  const action=lastFoodUse,f=(S.foods||{})[action.id];
  if(!f||JSON.stringify(foodStockSnapshot(f))!==JSON.stringify(action.after)){
    lastFoodUse=null;alert('수량이나 상태가 이미 바뀌었어요. 제품 수정에서 남은 수량을 확인해 주세요.');render();return false;
  }
  for(const [key,value] of Object.entries(action.before)){if(value===undefined)delete f[key];else f[key]=value}
  lastFoodUse=null;save();render();$('use-'+f.id)?.focus?.({preventScroll:true});return true;
}
function dismissFoodUse(){lastFoodUse=null;render()}
function foodUseNotice(){
  if(!lastFoodUse)return '';
  const current=(S.foods||{})[lastFoodUse.id];
  if(!current||JSON.stringify(foodStockSnapshot(current))!==JSON.stringify(lastFoodUse.after)){lastFoodUse=null;return ''}
  const a=lastFoodUse,remaining=foodRemaining(a.after);
  return `<div class="food-use-toast" role="status"><span>${esc(a.name)} ${foodAmount(a.used)}${esc(a.unit)} 사용 · ${remaining>0?`${foodAmount(remaining)}${esc(a.unit)} 남음`:'다 먹었어요'}</span><button id="undoFoodUse" onclick="undoFoodUse()">되돌리기</button><button class="food-use-dismiss" onclick="dismissFoodUse()" aria-label="수량 변경 알림 닫기">×</button></div>`;
}
function foodCard(f){
  const expiry=foodExpiry(f),unit=f.unit||'개',remaining=foodRemaining(f);
  return `<article class="card food-row" data-food-id="${f.id}"><button type="button" class="food-row-main" onclick="editFood('${f.id}')" aria-label="${esc(f.name)} 수정, 남은 수량 ${foodAmount(remaining)}${esc(unit)}, ${esc(expiry.text)}"><span class="food-row-copy"><span class="food-name">${esc(f.name)}</span><span class="food-row-meta">${foodStore==='all'?`<span class="food-store ${f.store}">${FOOD_STORES[f.store]}</span>`:''}<span class="food-expiry ${expiry.cls}" title="${esc(expiry.text)}">${esc(expiry.text.replace('표시 기한 ',''))}</span>${f.status!=='active'?`<span class="food-row-state">${FOOD_STATES[f.status]}</span>`:''}</span></span><span class="food-quantity"><strong>${foodAmount(remaining)}<small>${esc(unit)}</small></strong></span><span class="food-row-chevron" aria-hidden="true">›</span></button>
  ${f.status==='active'&&foodCountable(f)?`<button type="button" id="use-${f.id}" class="food-use" onclick="useFood('${f.id}')" aria-label="${esc(f.name)} ${foodAmount(Math.min(1,remaining))}${esc(unit)} 사용, 현재 ${foodAmount(remaining)}${esc(unit)} 남음"><span aria-hidden="true">−</span>${foodAmount(Math.min(1,remaining))}${esc(unit)} 사용</button>`:f.status!=='active'?`<button type="button" class="food-restore" onclick="changeFoodState('${f.id}','active')" aria-label="${esc(f.name)} 보관 중으로 복원">복원</button>`:''}</article>`;
}
function fridgePage(){
  const all=foodItems(),active=all.filter(f=>f.status==='active'),soon=active.filter(f=>{const d=foodDays(f.bestBefore);return d!==null&&d<=3}),pending=pendingFoodTasks();
  let items=foodView==='history'?all.filter(f=>f.status!=='active'):foodView==='soon'?soon:active;
  items=items.filter(f=>(foodStore==='all'||f.store===foodStore)&&f.name.toLocaleLowerCase().includes(foodQuery.trim().toLocaleLowerCase())).sort((a,b)=>(a.bestBefore||'9999').localeCompare(b.bestBefore||'9999')||a.name.localeCompare(b.name,'ko'));
  const history=foodPurchases().filter(t=>['done','skipped'].includes(t.foodState));
  return `${foodUseNotice()}<div class="food-heading"><div><h1>우리 집 냉장고</h1><p class="muted">장을 본 기록을, 먹을 재료로 정리해요.</p></div><button class="btn" onclick="openFoodSheet()">+ 직접 등록</button></div>
  ${foodStorageOverview(active)}
  <div class="food-quick-filters" aria-label="식재료 상태 필터"><button class="chip${foodView==='active'&&foodStore==='all'?' on':''}" onclick="setFoodView('active')">전체 ${active.length}</button><button class="chip${foodView==='soon'?' on':''}" onclick="setFoodView('soon')">기한 임박·경과 ${soon.length}</button></div>
  ${pending.length?`<h2 id="foodTasks" class="food-section-title">식재료 등록 대기 <span class="badge">${pending.length}건</span></h2><div class="food-task-grid">${pending.map(t=>foodTaskCard(t)).join('')}</div>`:fridgeSection==='pending'?'<div id="foodTasks" class="card food-empty"><strong>등록 대기 중인 장보기가 없어요.</strong><p class="muted">가계부에 지출을 기록할 때 냉장·냉동·실온을 체크해 주세요.</p></div>':''}
  <h2 id="foodList" class="food-section-title">${foodView==='history'?'소비·폐기 기록':foodView==='soon'?'표시 기한이 가까운 식재료':foodStore==='all'?'보관 중인 식재료':FOOD_STORES[foodStore]+' 보관 식재료'}<button class="chip${foodView==='history'?' on':''}" onclick="setFoodView('${foodView==='history'?'active':'history'}')">${foodView==='history'?'보관 목록':'소비·폐기 기록'}</button></h2>
  <div class="food-filters" aria-label="보관 장소 필터">${[['all','전체'],...Object.entries(FOOD_STORES)].map(([k,v])=>`<button class="chip${foodStore===k?' on':''}" aria-pressed="${foodStore===k}" onclick="setFoodStore('${k}')">${v}</button>`).join('')}</div>
  <input id="foodSearch" class="food-search" type="search" aria-label="식재료 이름 검색" placeholder="식재료 이름 검색" value="${esc(foodQuery)}" oninput="filterFoods(this.value)">
  <div class="food-grid">${items.map(foodCard).join('')||`<div class="card food-empty"><strong>${foodQuery||foodStore!=='all'?'조건에 맞는 식재료가 없어요.':foodView==='history'?'아직 소비·폐기 기록이 없어요.':foodView==='soon'?'기한이 임박하거나 지난 식재료가 없어요.':'아직 보관 중인 식재료가 없어요.'}</strong><p class="muted">${foodView==='active'&&!foodQuery&&foodStore==='all'?(pending.length?'위의 등록 대기에서 구매한 제품을 추가해 주세요.':'가계부에 지출을 쓸 때 냉장·냉동·실온을 체크해 보세요.<br>이미 가지고 있는 식재료는 직접 등록할 수 있어요.'):'다른 필터나 보관 목록도 확인해 보세요.'}</p></div>`}</div>
  <p class="food-help" style="margin:12px 2px">기한 임박은 입력한 표시 기한까지 3일 이내인 재료예요. 기한을 입력하지 않은 재료는 임박 목록에서 제외돼요.</p>
  ${history.length?`<details class="food-history"><summary>정리한 장보기 내역 ${history.length}건 · 제품 추가·확인</summary>${history.map(t=>foodTaskCard(t,true)).join('')}</details>`:''}`;
}
function skipFoodTask(id){
  const t=sourceTx(id);if(!t)return;
  if(!confirm('이 구매의 등록 대기를 해제할까요?\n이미 등록한 식재료는 그대로 남아요.'))return;
  t.foodState='skipped';save();render();
}
function openFoodTask(id){const t=sourceTx(id);if(!t||!t.foodStores?.length)return;openFoodSheet(null,id)}
function editFood(id){openFoodSheet(id)}
function foodPresetDate(purchasedAt,preset){
  if(!Object.hasOwn(FOOD_EXPIRY_PRESETS,preset)||!/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt||''))return null;
  const date=new Date(purchasedAt+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.getUTCFullYear()<1||date.toISOString().slice(0,10)!==purchasedAt)return null;
  const offset=FOOD_EXPIRY_PRESETS[preset];
  if(offset.days)date.setUTCDate(date.getUTCDate()+offset.days);
  else{
    const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+offset.months);
    const end=new Date(date);end.setUTCMonth(end.getUTCMonth()+1,0);
    date.setUTCDate(Math.min(day,end.getUTCDate()));
  }
  return date.getUTCFullYear()<=9999?date.toISOString().slice(0,10):null;
}
function foodExpiryDate(purchasedAt,steps,anchor=null){
  if(!Array.isArray(steps)||!steps.length)return null;
  let date=anchor||purchasedAt;
  for(const preset of steps){date=foodPresetDate(date,preset);if(!date)return null}
  return date;
}
function updateFoodExpiryUI(){
  document.querySelectorAll('#fdExpiryPresets button').forEach(button=>{
    const preset=button.dataset.preset,count=foodExpirySteps.filter(step=>step===preset).length;
    button.classList.toggle('on',count>0);button.dataset.count=String(count);
    button.setAttribute('aria-label',`${FOOD_EXPIRY_PRESETS[preset].label} 더하기${count?`, 누적 ${count}회`:''}`);
    const badge=button.querySelector('.expiry-press-count');badge.hidden=count===0;badge.textContent=count?`${count}회`:'';
  });
  const applied=Object.entries(FOOD_EXPIRY_PRESETS).map(([key,value])=>{const count=foodExpirySteps.filter(step=>step===key).length;return count?value.label+(count>1?` ×${count}`:''):''}).filter(Boolean).join(' + ');
  $('fdExpiryHint').textContent=foodExpirySteps.length?($('fdExpiry').value?`${foodExpiryAnchor||$('fdBought').value} + ${applied} → ${$('fdExpiry').value}`:'구매일을 선택하면 누적 기간을 계산해요.'):'누를 때마다 현재 기한에 더해요. 기한이 없으면 구매일부터 시작해요.';
}
function chooseFoodExpiry(preset){
  const current=$('fdExpiry').value,date=foodPresetDate(current||$('fdBought').value,preset);
  if(!date){alert('구매일 또는 현재 기한을 올바르게 입력해 주세요.');$('fdBought').focus();return false}
  if(!foodExpirySteps.length)foodExpiryAnchor=current||null;
  foodExpirySteps=[...foodExpirySteps,preset];$('fdExpiry').value=date;updateFoodExpiryUI();return true;
}
function changeFoodBought(){
  if(foodExpirySteps.length)$('fdExpiry').value=foodExpiryDate($('fdBought').value,foodExpirySteps,foodExpiryAnchor)||'';
  updateFoodExpiryUI();
}
function manualFoodExpiry(){foodExpirySteps=[];foodExpiryAnchor=null;updateFoodExpiryUI()}
function resetFoodExpiry(){$('fdExpiry').value='';manualFoodExpiry()}
function openFoodSheet(id=null,taskId=null){
  foodPreviousFocus=document.activeElement;
  foodEditId=id;foodTaskId=taskId;
  const f=id&&(S.foods||{})[id],t=sourceTx(taskId);
  if(id&&!f)return;
  $('fdTitle').textContent=f?'식재료 수정':t?'구매 식재료 등록':'식재료 직접 등록';
  $('fdSource').hidden=!t;
  $('fdSource').innerHTML=t?`<strong>${esc(t.memo||t.cat)}</strong><br>${t.date} · 결제 ${won(t.amt)} · ${t.foodStores.filter(s=>Object.hasOwn(FOOD_STORES,s)).map(s=>FOOD_STORES[s]).join(' · ')}<div class="food-help">구매 금액은 가계부에 한 번만 기록돼요. 제품별 가격은 입력하지 않아도 돼요.</div>`:'';
  const linked=f&&sourceTx(f.txId),source=linked?foodSourceText(linked):f&&f.sourceMemo;
  $('fdExtra').hidden=!f;$('fdExtra').open=false;
  $('fdExtraInfo').innerHTML=f?`<p>처음 수량 · ${foodAmount(f.initialQuantity??f.quantity)}${esc(f.unit||'개')}</p>${source?`<p>${linked?'연결된 장보기':'구매 메모'} · ${esc(source)}</p>`:''}${f.finishedAt?`<p>${FOOD_STATES[f.status]} · ${esc(f.finishedAt)}</p>`:''}`:'';
  $('fdName').value=f?f.name:'';
  $('fdStore').value=f?f.store:t?t.foodStores[0]:'chilled';
  if(!Object.hasOwn(FOOD_STORES,$('fdStore').value))$('fdStore').value='chilled';
  $('fdQty').value=f?foodRemaining(f):1;
  $('fdUnit').value=f?f.unit||'개':'개';
  $('fdBought').value=f?f.purchasedAt||'':t?t.date:today();
  $('fdExpiry').value=f?f.bestBefore||'':'';
  const steps=f&&(Array.isArray(f.expirySteps)?f.expirySteps:f.expiryPreset?[f.expiryPreset]:[])||[],anchor=f&&f.expiryAnchor||null;
  const valid=steps.length&&foodExpiryDate($('fdBought').value,steps,anchor)===$('fdExpiry').value;
  foodExpirySteps=valid?[...steps]:[];foodExpiryAnchor=valid?anchor:null;
  updateFoodExpiryUI();
  $('fdStatus').value=f?f.status:'active';
  $('fdStatusRow').hidden=!f;
  $('fdSave').textContent=f?'변경 저장':t?'이 제품 저장하고 계속':'식재료 저장';
  $('fdFinish').hidden=!t;
  $('fdDelete').hidden=!f;
  $('fdNotice').textContent='';
  updateFoodTaskProgress();
  $('foodSheet').classList.add('show');
  foodDraftBaseline=foodDraft();
  setTimeout(()=>$('fdName').focus(),50);
}
function foodDraft(){return JSON.stringify([['fdName','fdStore','fdQty','fdUnit','fdBought','fdExpiry','fdStatus'].map(id=>$(id).value),foodExpiryAnchor,foodExpirySteps])}
function closeFoodSheet(force=false){
  if(!force&&foodDraft()!==foodDraftBaseline&&!confirm('아직 저장하지 않은 입력을 닫을까요?\n이미 저장한 식재료는 그대로 남아요.'))return;
  $('foodSheet').classList.remove('show');
  foodEditId=foodTaskId=null;
  (foodPreviousFocus&&foodPreviousFocus.isConnected?foodPreviousFocus:$('f-active')).focus();
}
function syncFoodStatusInput(){
  const old=(S.foods||{})[foodEditId];
  if($('fdStatus').value!=='consumed'&&Number($('fdQty').value)===0)$('fdQty').value=old&&old.restoreQuantity>0?old.restoreQuantity:1;
}
function updateFoodTaskProgress(){
  const list=foodTaskId?foodsForTask(foodTaskId):[];
  $('fdProgress').hidden=!foodTaskId;
  $('fdProgress').textContent=list.length?`등록한 제품 ${list.length}개 · ${list.map(f=>f.name).join(', ')}`:'아직 등록한 제품이 없어요. 제품을 저장한 뒤 등록 완료를 눌러 주세요.';
}
function saveFood(event,finish=false){
  if(event)event.preventDefault();
  const name=$('fdName').value.trim(),quantity=Number($('fdQty').value),store=$('fdStore').value;
  const old=foodEditId&&(S.foods||{})[foodEditId],status=old?$('fdStatus').value:'active';
  if(foodExpirySteps.length&&!foodExpiryDate($('fdBought').value,foodExpirySteps,foodExpiryAnchor)){alert('기한을 계산할 기준 날짜를 입력해 주세요.');$('fdBought').focus();return false}
  if(!name){alert('제품 이름을 입력해 주세요.');$('fdName').focus();return false}
  if(!Number.isFinite(quantity)||quantity<0||(status!=='consumed'&&quantity===0)){alert('보관할 수량은 0보다 큰 숫자로 입력해 주세요.');$('fdQty').focus();return false}
  const t=sourceTx(foodTaskId);
  if(foodTaskId&&(!t||!t.foodStores?.length)){alert('연결된 구매 내역이 바뀌었어요. 가계부에서 확인해 주세요.');return false}
  if(foodEditId&&!old){alert('다른 기기에서 삭제한 식재료예요. 목록을 확인해 주세요.');closeFoodSheet(true);render();return false}
  const id=foodEditId||crypto.randomUUID(),unit=$('fdUnit').value.trim()||'개';
  const initialQuantity=old&&unit===(old.unit||'개')?Math.max(old.initialQuantity??old.quantity,quantity):quantity;
  const storedQuantity=status==='consumed'&&quantity===0?(old&&old.restoreQuantity>0?old.restoreQuantity:old&&old.quantity>0?old.quantity:1):quantity;
  const f={...old,id,name,store,quantity:storedQuantity,initialQuantity,unit,purchasedAt:$('fdBought').value||null,bestBefore:$('fdExpiry').value||null};
  delete f.openedAt;delete f.expiryPreset;delete f.expirySteps;delete f.expiryAnchor;
  if(foodExpirySteps.length&&foodExpiryDate(f.purchasedAt,foodExpirySteps,foodExpiryAnchor)===f.bestBefore){f.expirySteps=[...foodExpirySteps];if(foodExpiryAnchor)f.expiryAnchor=foodExpiryAnchor}
  if(t){f.txId=t.id;f.sourceMemo=foodSourceText(t)}
  applyFoodStatus(f,status);
  (S.foods||(S.foods={}))[id]=f;
  if(t){t.foodState=finish?'done':'pending'}
  save();render();
  if(!t||finish){closeFoodSheet(true);return true}
  $('fdName').value='';$('fdQty').value=1;resetFoodExpiry();
  $('fdNotice').textContent=`${name} 저장했어요. 다음 제품을 추가하거나 등록 완료를 눌러 주세요.`;
  updateFoodTaskProgress();foodDraftBaseline=foodDraft();$('fdName').focus();return true;
}
function finishFoodTask(){
  const t=sourceTx(foodTaskId);if(!t)return;
  if($('fdName').value.trim()){saveFood(null,true);return}
  if(foodDraft()!==foodDraftBaseline&&!confirm('제품 이름이 없는 입력은 저장되지 않아요. 등록을 완료할까요?'))return;
  if(!foodsForTask(t.id).length){alert('제품을 하나 이상 등록해 주세요.\n등록할 제품이 없다면 대기 목록에서 “등록할 식재료 없음”을 눌러 주세요.');return}
  t.foodState='done';save();closeFoodSheet(true);render();
}
function changeFoodState(id,state){
  const f=(S.foods||{})[id];if(!f)return;
  if(state==='discarded'&&!confirm(`“${f.name}”을(를) 폐기 처리할까요?\n소비·폐기 기록에서 복원할 수 있어요.`))return;
  if(Object.hasOwn(FOOD_STATES,state))applyFoodStatus(f,state);else return;
  save();render();
}
function deleteFood(){
  const f=(S.foods||{})[foodEditId];if(!f||!confirm(`“${f.name}” 기록을 삭제할까요?\n가계부 지출은 그대로 남아요.`))return;
  delete S.foods[foodEditId];save();closeFoodSheet(true);render();
}

// 서로 다른 제품과 서로 다른 필드의 동시 편집을 모두 살리는 3방향 병합.
function mergeFoodRecords(base={},local={},remote={}){
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),out={};
  for(const id of new Set([...Object.keys(local),...Object.keys(remote)])){
    const b=base[id],l=local[id],r=remote[id];
    if(!b){out[id]=l||r;continue}
    if(!l||!r){const other=l||r;if(!equal(other,b))out[id]=other;continue}
    const item={};
    for(const key of new Set([...Object.keys(l),...Object.keys(r)])){const value=equal(l[key],b[key])?r[key]:l[key];if(value!==undefined)item[key]=value}
    out[id]=item;
  }
  return out;
}

document.addEventListener('keydown',event=>{
  if(!$('foodSheet').classList.contains('show'))return;
  if(event.key==='Escape'){event.preventDefault();closeFoodSheet()}
  if(event.key==='Tab'){
    const fields=[...$('foodSheet').querySelectorAll('input,select,button')].filter(el=>!el.disabled&&el.getClientRects().length);
    const first=fields[0],last=fields.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
});
