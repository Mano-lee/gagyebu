// 식품 구매 알림은 지출에서 파생하고, 재고는 예산 기간과 독립적으로 보관한다.
const FOOD_STORES={chilled:'냉장',frozen:'냉동',pantry:'실온'};
const FOOD_STATES={active:'보관 중',consumed:'다 먹음',discarded:'폐기'};
let foodStore='all',foodView='active',foodQuery='';
let foodEditId=null,foodTaskId=null,foodDraftBaseline='';
let foodPreviousFocus=null;

function prepareFoodData(data){
  if(!data||typeof data!=='object'||!data.p||Array.isArray(data.p)||typeof data.p!=='object')throw new Error('invalid-data');
  for(const p of Object.values(data.p))if(!p||!Array.isArray(p.tx)||!Array.isArray(p.fixed))throw new Error('invalid-data');
  if(data.foods!==undefined&&(!data.foods||Array.isArray(data.foods)||typeof data.foods!=='object'))throw new Error('invalid-foods');
  for(const [id,f] of Object.entries(data.foods||{})){
    if(!f||f.id!==id||!/^[a-zA-Z0-9_-]+$/.test(id)||['__proto__','constructor','prototype'].includes(id)||typeof f.name!=='string'||!Object.hasOwn(FOOD_STORES,f.store)||!Object.hasOwn(FOOD_STATES,f.status)||!Number.isFinite(f.quantity)||f.quantity<=0)throw new Error('invalid-food');
  }
  return {...data,schemaVersion:Math.max(3,Number(data.schemaVersion)||0),foods:data.foods||{}};
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
function setFoodView(view){openApp('fridge',view)}
function setFoodStore(store){foodStore=store;render()}
function filterFoods(value){foodQuery=value;const input=$('foodSearch'),pos=input.selectionStart;render();$('foodSearch').focus();$('foodSearch').setSelectionRange(pos,pos)}
function foodCard(f){
  const expiry=foodExpiry(f),t=sourceTx(f.txId),src=t?foodSourceText(t):f.sourceMemo;
  return `<article class="card"><div class="food-card-top"><button class="food-name" onclick="editFood('${f.id}')">${esc(f.name)}</button><span class="food-store ${f.store}">${FOOD_STORES[f.store]}</span></div>
  <div class="food-dates">${esc(f.quantity)}${esc(f.unit||'개')} · ${f.openedAt?'개봉 '+esc(f.openedAt):'미개봉'}<br>구매 ${esc(f.purchasedAt||'미입력')}${f.status!=='active'?` · ${FOOD_STATES[f.status]} ${esc(f.finishedAt||'')}`:''}</div>
  <span class="food-expiry ${expiry.cls}">${esc(expiry.text)}</span>
  ${src?`<div style="margin-top:10px">${t?`<button class="food-source" onclick="openSheet(${t.id})">구매 내역 · ${esc(src)} ›</button>`:`<span class="food-help">구매 메모 · ${esc(src)} (원래 지출 없음)</span>`}</div>`:''}
  <div class="food-actions">${f.status==='active'?`${!f.openedAt?`<button class="btn ghost" onclick="changeFoodState('${f.id}','opened')">개봉</button>`:''}<button class="btn ghost" onclick="changeFoodState('${f.id}','consumed')">다 먹음</button><button class="btn ghost" onclick="changeFoodState('${f.id}','discarded')">폐기</button>`:`<button class="btn ghost" onclick="changeFoodState('${f.id}','active')">보관 중으로 복원</button>`}<button class="btn ghost" onclick="editFood('${f.id}')">수정</button></div></article>`;
}
function fridgePage(){
  const all=foodItems(),active=all.filter(f=>f.status==='active'),soon=active.filter(f=>{const d=foodDays(f.bestBefore);return d!==null&&d<=3}),opened=active.filter(f=>f.openedAt),pending=pendingFoodTasks();
  let items=foodView==='history'?all.filter(f=>f.status!=='active'):foodView==='soon'?soon:foodView==='opened'?opened:active;
  items=items.filter(f=>(foodStore==='all'||f.store===foodStore)&&f.name.toLocaleLowerCase().includes(foodQuery.trim().toLocaleLowerCase())).sort((a,b)=>(a.bestBefore||'9999').localeCompare(b.bestBefore||'9999')||a.name.localeCompare(b.name,'ko'));
  const history=foodPurchases().filter(t=>['done','skipped'].includes(t.foodState));
  return `<div class="food-heading"><div><h1>우리 집 냉장고</h1><p class="muted">장을 본 기록을, 먹을 재료로 정리해요.</p></div><button class="btn" onclick="openFoodSheet()">+ 직접 등록</button></div>
  <div class="food-stats"><button class="food-stat${foodView==='active'?' on':''}" onclick="setFoodView('active')">보관 중<b>${active.length}</b></button><button class="food-stat warn${foodView==='soon'?' on':''}" onclick="setFoodView('soon')">기한 임박·경과<b>${soon.length}</b></button><button class="food-stat${foodView==='opened'?' on':''}" onclick="setFoodView('opened')">개봉한 식품<b>${opened.length}</b></button></div>
  ${pending.length?`<h2 id="foodTasks" class="food-section-title">식재료 등록 대기 <span class="badge">${pending.length}건</span></h2><div class="food-task-grid">${pending.map(t=>foodTaskCard(t)).join('')}</div>`:fridgeSection==='pending'?'<div id="foodTasks" class="card food-empty"><strong>등록 대기 중인 장보기가 없어요.</strong><p class="muted">가계부에 지출을 기록할 때 냉장·냉동·실온을 체크해 주세요.</p></div>':''}
  <h2 class="food-section-title">${foodView==='history'?'소비·폐기 기록':foodView==='soon'?'표시 기한이 가까운 식재료':foodView==='opened'?'개봉한 식재료':'보관 중인 식재료'}<button class="chip${foodView==='history'?' on':''}" onclick="setFoodView('${foodView==='history'?'active':'history'}')">${foodView==='history'?'보관 목록':'소비·폐기 기록'}</button></h2>
  <div class="food-filters" aria-label="보관 장소 필터">${[['all','전체'],...Object.entries(FOOD_STORES)].map(([k,v])=>`<button class="chip${foodStore===k?' on':''}" aria-pressed="${foodStore===k}" onclick="setFoodStore('${k}')">${v}</button>`).join('')}</div>
  <input id="foodSearch" class="food-search" type="search" aria-label="식재료 이름 검색" placeholder="식재료 이름 검색" value="${esc(foodQuery)}" oninput="filterFoods(this.value)">
  <div class="food-grid">${items.map(foodCard).join('')||`<div class="card food-empty"><strong>${foodQuery||foodStore!=='all'?'조건에 맞는 식재료가 없어요.':foodView==='history'?'아직 소비·폐기 기록이 없어요.':foodView==='soon'?'기한이 임박하거나 지난 식재료가 없어요.':foodView==='opened'?'개봉한 식재료가 없어요.':'아직 보관 중인 식재료가 없어요.'}</strong><p class="muted">${foodView==='active'&&!foodQuery&&foodStore==='all'?(pending.length?'위의 등록 대기에서 구매한 제품을 추가해 주세요.':'가계부에 지출을 쓸 때 냉장·냉동·실온을 체크해 보세요.<br>이미 가지고 있는 식재료는 직접 등록할 수 있어요.'):'다른 필터나 보관 목록도 확인해 보세요.'}</p></div>`}</div>
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
function openFoodSheet(id=null,taskId=null){
  foodPreviousFocus=document.activeElement;
  foodEditId=id;foodTaskId=taskId;
  const f=id&&(S.foods||{})[id],t=sourceTx(taskId);
  if(id&&!f)return;
  $('fdTitle').textContent=f?'식재료 수정':t?'구매 식재료 등록':'식재료 직접 등록';
  $('fdSource').hidden=!t;
  $('fdSource').innerHTML=t?`<strong>${esc(t.memo||t.cat)}</strong><br>${t.date} · 결제 ${won(t.amt)} · ${t.foodStores.filter(s=>Object.hasOwn(FOOD_STORES,s)).map(s=>FOOD_STORES[s]).join(' · ')}<div class="food-help">구매 금액은 가계부에 한 번만 기록돼요. 제품별 가격은 입력하지 않아도 돼요.</div>`:'';
  $('fdName').value=f?f.name:'';
  $('fdStore').value=f?f.store:t?t.foodStores[0]:'chilled';
  if(!Object.hasOwn(FOOD_STORES,$('fdStore').value))$('fdStore').value='chilled';
  $('fdQty').value=f?f.quantity:1;
  $('fdUnit').value=f?f.unit||'개':'개';
  $('fdBought').value=f?f.purchasedAt||'':t?t.date:today();
  $('fdExpiry').value=f?f.bestBefore||'':'';
  $('fdOpened').checked=!!(f&&f.openedAt);
  $('fdOpenedAt').value=f&&f.openedAt||today();
  $('fdOpenedAt').max=today();
  toggleFoodOpened();
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
function foodDraft(){return JSON.stringify(['fdName','fdStore','fdQty','fdUnit','fdBought','fdExpiry','fdOpenedAt','fdStatus'].map(id=>$(id).value).concat($('fdOpened').checked))}
function closeFoodSheet(force=false){
  if(!force&&foodDraft()!==foodDraftBaseline&&!confirm('아직 저장하지 않은 입력을 닫을까요?\n이미 저장한 식재료는 그대로 남아요.'))return;
  $('foodSheet').classList.remove('show');
  foodEditId=foodTaskId=null;
  (foodPreviousFocus&&foodPreviousFocus.isConnected?foodPreviousFocus:$('t-fridge')).focus();
}
function toggleFoodOpened(){$('fdOpenedDate').hidden=!$('fdOpened').checked}
function updateFoodTaskProgress(){
  const list=foodTaskId?foodsForTask(foodTaskId):[];
  $('fdProgress').hidden=!foodTaskId;
  $('fdProgress').textContent=list.length?`등록한 제품 ${list.length}개 · ${list.map(f=>f.name).join(', ')}`:'아직 등록한 제품이 없어요. 제품을 저장한 뒤 등록 완료를 눌러 주세요.';
}
function saveFood(event,finish=false){
  if(event)event.preventDefault();
  const name=$('fdName').value.trim(),quantity=Number($('fdQty').value),store=$('fdStore').value;
  if(!name){alert('제품 이름을 입력해 주세요.');$('fdName').focus();return false}
  if(!Number.isFinite(quantity)||quantity<=0){alert('수량은 0보다 큰 숫자로 입력해 주세요.');$('fdQty').focus();return false}
  const openedAt=$('fdOpened').checked?$('fdOpenedAt').value:null;
  if($('fdOpened').checked&&(!openedAt||openedAt>today())){alert('개봉일을 오늘 또는 이전 날짜로 입력해 주세요.');return false}
  const t=sourceTx(foodTaskId);
  if(foodTaskId&&(!t||!t.foodStores?.length)){alert('연결된 구매 내역이 바뀌었어요. 가계부에서 확인해 주세요.');return false}
  const old=foodEditId&&(S.foods||{})[foodEditId];
  if(foodEditId&&!old){alert('다른 기기에서 삭제한 식재료예요. 목록을 확인해 주세요.');closeFoodSheet(true);render();return false}
  const id=foodEditId||crypto.randomUUID(),status=old?$('fdStatus').value:'active';
  const f={...old,id,name,store,quantity,unit:$('fdUnit').value.trim()||'개',purchasedAt:$('fdBought').value||null,bestBefore:$('fdExpiry').value||null,openedAt,status};
  if(t){f.txId=t.id;f.sourceMemo=foodSourceText(t)}
  if(status!=='active')f.finishedAt=old&&old.status===status&&old.finishedAt||today();else delete f.finishedAt;
  (S.foods||(S.foods={}))[id]=f;
  if(t){t.foodState=finish?'done':'pending'}
  save();render();
  if(!t||finish){closeFoodSheet(true);return true}
  $('fdName').value='';$('fdQty').value=1;$('fdExpiry').value='';$('fdOpened').checked=false;$('fdOpenedAt').value=today();toggleFoodOpened();
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
  if(state==='opened')f.openedAt=today();else{f.status=state;if(state==='active')delete f.finishedAt;else f.finishedAt=today()}
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
