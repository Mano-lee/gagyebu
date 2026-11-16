const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const core=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
const fridge=fs.readFileSync(path.join(root,'fridge.js'),'utf8');
const platform=fs.readFileSync(path.join(root,'platform.js'),'utf8');
const recipes=fs.readFileSync(path.join(root,'recipes.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function app(initial){
  const elements=new Map(),memory=new Map(),alerts=[];
  const element=id=>{
    if(!elements.has(id)){
      const classes=new Set();
      elements.set(id,{value:'',textContent:'',innerHTML:'',checked:false,hidden:false,style:{},dataset:{},files:[],classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){on??=!classes.has(x);on?classes.add(x):classes.delete(x)}},setAttribute(){},focus(){},setSelectionRange(){},querySelector(){return element('fabt')}});
    }
    return elements.get(id);
  };
  const checks=['chilled','frozen','pantry'].map(value=>({value,checked:false}));
  if(initial)memory.set('my-gagyebu-v2',JSON.stringify(initial));
  const listeners=new Map(),location={hash:'',get href(){return this.hash}},entries=[{hash:'',state:null}];let position=0;
  const history={
    get state(){return entries[position].state},get length(){return entries.length},
    pushState(state,_title,hash){entries.splice(position+1);entries.push({hash,state});position++;location.hash=hash},
    replaceState(state,_title,hash){entries[position]={hash,state};location.hash=hash},
    go(delta){const next=position+delta;if(next<0||next>=entries.length)return;position=next;location.hash=entries[position].hash;for(const listener of listeners.get('popstate')||[])listener({state:this.state})},
    back(){this.go(-1)},forward(){this.go(1)}
  };
  const context=vm.createContext({console,Date,crypto:webcrypto,Blob,URL,setTimeout(){},clearTimeout(){},alert:m=>alerts.push(m),confirm:()=>true,navigator:{},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},document:{body:element('body'),getElementById:element,addEventListener(){},querySelectorAll:selector=>selector==='#fFoodW input'?checks:selector==='#fFoodW input:checked'?checks.filter(c=>c.checked):[]},window:{location,history,matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(listener)}}});
  vm.runInContext(fs.readFileSync(path.join(root,'tasks.js'),'utf8'),context,{filename:'tasks.js'});
  vm.runInContext(recipes,context,{filename:'recipes.js'});
  vm.runInContext(fridge,context,{filename:'fridge.js'});
  vm.runInContext(platform,context,{filename:'platform.js'});
  vm.runInContext(core,context,{filename:'index-inline.js'});
  const run=code=>vm.runInContext(code,context);
  return {run,json:code=>clone(run(code)),el:element,checks,alerts,memory,context};
}
function addPurchase(a,stores=['chilled','pantry']){
  a.run('openSheet()');a.el('fAmt').value='42000';a.el('fMemo').value='마트(우유, 계란 등)';
  a.checks.forEach(c=>c.checked=stores.includes(c.value));a.run('saveTx()');
  return a.run('cur().tx.at(-1).id');
}
function addFood(a,name='우유'){
  a.el('fdName').value=name;a.el('fdQty').value='1';a.run('saveFood()');
  return a.run('foodItems().at(-1).id');
}
function addStock(a,quantity,unit='개'){
  a.run('openFoodSheet()');a.el('fdName').value='소분 식재료';a.el('fdQty').value=String(quantity);a.el('fdUnit').value=unit;a.run('saveFood()');return a.run('foodItems().at(-1).id');
}
test('old ledger data loads without changing transactions and acquires a separate inventory',()=>{
  const old={p:{'2026-10-01':{start:100000,fixed:[],tx:[{id:1,type:'out',amt:3000,cat:'식비',date:'2026-10-03',memo:'점심'}]}}};
  const a=app(old);assert.deepEqual(a.json('S.p["2026-10-01"].tx'),old.p['2026-10-01'].tx);assert.deepEqual(a.json('S.foods'),{});
});
test('platform is the initial screen and each app shows only its own menus',()=>{
  const a=app();assert.equal(a.run('activeApp'),'platform');assert.equal(a.el('appShell').hidden,true);assert.ok(a.el('view').innerHTML.includes('가계부 열기'));
  a.run('openApp("ledger")');assert.equal(a.run('activeApp'),'ledger');assert.equal(a.el('ledgerNav').hidden,false);assert.equal(a.el('fridgeNav').hidden,true);assert.equal(a.el('fridgeHeader').hidden,true);
  a.run('openPlatform();openApp("fridge")');assert.equal(a.el('ledgerHeader').hidden,true);assert.equal(a.el('ledgerNav').hidden,true);assert.equal(a.el('fridgeNav').hidden,false);
  a.run('openPlatform()');assert.equal(a.el('appShell').hidden,true);
});
test('shared settings contains sync and backup while ledger settings contains budget controls',()=>{
  const a=app();a.run('openSharedSettings()');assert.ok(a.el('view').innerHTML.includes('가계부·냉장고·레시피 백업'));assert.ok(!a.el('view').innerHTML.includes('id="sStart"'));
  a.run('go("set")');assert.ok(a.el('view').innerHTML.includes('id="sStart"'));assert.ok(!a.el('view').innerHTML.includes('onclick="resetAll()"'));
});
test('platform shortcuts clear old fridge filters and select the requested section',()=>{
  const a=app();a.run('foodStore="pantry";foodQuery="old";openApp("fridge","pending")');assert.equal(a.run('fridgeSection'),'pending');assert.equal(a.run('foodStore'),'all');assert.equal(a.run('foodQuery'),'');
  a.run('openApp("fridge","soon")');assert.equal(a.run('foodView'),'soon');
});
test('route restoration supports browser back and forward and unknown routes return to platform',()=>{
  const a=app();a.run('window.location.hash="#ledger/list";restoreAppRoute()');assert.equal(a.run('activeApp'),'ledger');assert.equal(a.run('tab'),'list');
  a.run('window.location.hash="#fridge/history";restoreAppRoute()');assert.equal(a.run('foodView'),'history');
  a.run('window.location.hash="#unknown";restoreAppRoute()');assert.equal(a.run('activeApp'),'platform');
});
test('platform shows app launchers and real pending alerts without exposing budget or inventory previews',()=>{
  const a=app();assert.equal(a.run('platformAlerts().length'),0);addPurchase(a);a.run('cur().start=100000;movePeriod(-1);openPlatform()');const page=a.run('platformPage()');assert.ok(!page.includes('58,000원'));assert.ok(!page.includes('이번 기간 남은 예산'));assert.ok(!page.includes('보관 중인 식재료'));assert.ok(page.includes('식재료 등록 대기 1건'));assert.ok(page.includes('id="platformPendingAlert"'));
});
test('ledger alerts include due unconfirmed expenses and disappear once handled',()=>{
  const a=app();a.run(`cur().fixed=[{name:'확인할 지출',amt:10000,day:Number(today().slice(-2))},{name:'확인한 지출',amt:10000,day:1,done:true}];cur().plan=[{id:999,type:'plan',amt:5000,date:today(),cat:'식비',memo:'확정할 예정'},{id:1000,type:'plan',amt:5000,date:'2999-01-01',cat:'식비',memo:'나중 예정'}]`);
  const alerts=a.json('ledgerPlatformAlerts()');assert.equal(alerts.length,1);assert.ok(alerts[0].text.includes('고정지출 1건'));assert.ok(alerts[0].text.includes('예정지출 1건'));
  a.run('cur().fixed[0].done=true;cur().plan.shift()');assert.equal(a.run('ledgerPlatformAlerts().length'),0);
});
test('cancelling navigation preserves unsaved product inputs and the current app',()=>{
  const a=app();a.run('openApp("fridge");openFoodSheet()');a.el('fdName').value='아직 입력 중';a.context.confirm=()=>false;
  const hash=a.run('window.location.hash');a.run('openPlatform()');assert.equal(a.run('activeApp'),'fridge');assert.equal(a.run('window.location.hash'),hash);assert.equal(a.el('fdName').value,'아직 입력 중');assert.equal(a.el('foodSheet').classList.contains('show'),true);
});

test('phone back closes the ingredient editor and preserves the fridge list before leaving the app',()=>{
  const a=app();a.run('openApp("fridge")');const id=addStock(a,3);
  a.run(`foodStore="chilled";foodQuery="milk";editFood('${id}')`);
  assert.equal(a.run('window.history.state.appSheet.id'),id);
  a.run('window.history.back()');
  assert.equal(a.el('foodSheet').classList.contains('show'),false);
  assert.equal(a.run('activeApp'),'fridge');assert.equal(a.run('foodStore'),'chilled');assert.equal(a.run('foodQuery'),'milk');
  a.run('window.history.forward()');assert.equal(a.run('foodEditId'),id);assert.equal(a.el('foodSheet').classList.contains('show'),true);
  a.run('window.history.back();window.history.back()');assert.equal(a.run('activeApp'),'platform');
});

test('cancelling phone back keeps unsaved inputs and a subsequent back can discard them',()=>{
  const a=app();a.run('openApp("fridge")');const id=addStock(a,3),before=a.json(`S.foods['${id}']`);
  a.run(`editFood('${id}')`);a.el('fdName').value='unsaved';a.context.confirm=()=>false;
  a.run('window.history.back()');assert.equal(a.el('foodSheet').classList.contains('show'),true);assert.equal(a.el('fdName').value,'unsaved');assert.equal(a.run('window.history.state.appSheet.id'),id);
  a.context.confirm=()=>true;a.run('window.history.back()');assert.equal(a.el('foodSheet').classList.contains('show'),false);assert.equal(a.run('activeApp'),'fridge');assert.deepEqual(a.json(`S.foods['${id}']`),before);
});

test('close and save consume the editor history step and permit normal app navigation',()=>{
  for(const action of ['closeFoodSheet()','saveFood()','openSharedSettings()']){
    const a=app();a.run('openApp("fridge")');const id=addStock(a,3);
    a.run(`editFood('${id}');${action}`);assert.equal(a.el('foodSheet').classList.contains('show'),false);
    assert.equal(a.run('sheetHistoryBackPending'),false);assert.equal(a.run('window.history.state?.appSheet'),undefined);
    if(action==='openSharedSettings()'){assert.equal(a.run('activeApp'),'settings');a.run('window.history.back()');assert.equal(a.run('activeApp'),'fridge')}
    a.run('window.history.back()');assert.equal(a.run('activeApp'),'platform');
  }
});

test('forward cannot reopen an ingredient that was deleted from its editor',()=>{
  const a=app();a.run('openApp("fridge")');const id=addStock(a,3);
  a.run(`editFood('${id}');deleteFood();window.history.forward()`);
  assert.equal(a.el('foodSheet').classList.contains('show'),false);assert.equal(a.run('activeApp'),'fridge');assert.equal(a.run('window.history.state?.appSheet'),undefined);
});

test('phone back closes expense, income and planned-entry forms while preserving the ledger view',()=>{
  for(const type of ['out','in','plan']){
    const a=app();a.run(`openApp('ledger','list');selDay=today();selCat='food';openSheet();setType('${type}')`);
    const period=a.run('S.cur'),day=a.run('selDay');a.el('fAmt').value='5000';
    a.run('window.history.back()');
    assert.equal(a.el('sheet').classList.contains('show'),false);assert.equal(a.run('activeApp'),'ledger');assert.equal(a.run('tab'),'list');
    assert.equal(a.run('S.cur'),period);assert.equal(a.run('selDay'),day);assert.equal(a.run('selCat'),'food');assert.equal(a.run('cur().tx.length+(cur().plan||[]).length'),0);
    a.run('window.history.back()');assert.equal(a.run('activeApp'),'platform');
  }
});

test('back from an unchanged transaction editor needs no discard prompt and forward reopens it',()=>{
  const a=app();a.run('openApp("ledger","list")');const id=addPurchase(a),before=a.json('S.p');
  a.run(`openSheet(${id})`);a.context.confirm=()=>{throw new Error('unchanged editor must not prompt')};
  a.run('window.history.back()');assert.equal(a.run('activeApp'),'ledger');assert.deepEqual(a.json('S.p'),before);
  a.run('window.history.forward()');assert.equal(a.run('editId'),id);assert.equal(a.el('sheet').classList.contains('show'),true);
  a.run('window.history.back();window.history.back()');assert.equal(a.run('activeApp'),'platform');
});

test('cancelling ledger back or app navigation retains calculator inputs and food flags',()=>{
  const a=app();a.run('openApp("ledger","list");openSheet();setPay("credit");showDutch(true);setBackMode("mine")');
  a.el('fAmt').value='10,000 + 5,000';a.el('fBack').value='5000';a.el('fMemo').value='unsaved';a.checks[1].checked=true;
  const draft=a.run('txDraft()');a.context.confirm=()=>false;
  for(const action of ['window.history.back()','openSharedSettings()']){
    a.run(action);assert.equal(a.el('sheet').classList.contains('show'),true);assert.equal(a.run('txDraft()'),draft);assert.equal(a.run('activeApp'),'ledger');assert.equal(a.run('window.history.state.appSheet.kind'),'transaction');
  }
  a.context.confirm=()=>true;a.run('window.history.back()');assert.equal(a.el('sheet').classList.contains('show'),false);assert.equal(a.run('cur().tx.length'),0);
});

test('fixed expense forms close on back and preserve unsaved edits when discard is cancelled',()=>{
  for(const editing of [false,true]){
    const a=app();a.run('openApp("ledger","set");cur().fixed=[{name:"Rent",amt:10000,day:5,note:"memo"}]');
    const before=a.json('cur().fixed');a.run(editing?'openFx(0)':'openFx()');a.el('xNote').value='unsaved';a.context.confirm=()=>false;
    a.run('window.history.back()');assert.equal(a.el('fxSheet').classList.contains('show'),true);assert.equal(a.el('xNote').value,'unsaved');assert.equal(a.run('window.history.state.appSheet.kind'),'fixed');
    a.context.confirm=()=>true;a.run('window.history.back()');assert.equal(a.el('fxSheet').classList.contains('show'),false);assert.equal(a.run('activeApp'),'ledger');assert.equal(a.run('tab'),'set');assert.deepEqual(a.json('cur().fixed'),before);
    a.run('window.history.forward()');assert.equal(a.el('fxSheet').classList.contains('show'),true);assert.equal(a.el('xNote').value,editing?'memo':'');
  }
});

test('ledger saves, deletes and cancel buttons consume the dialog step before further navigation',()=>{
  for(const [open,actions] of [
    ['openSheet(123)',['closeSheet()','saveTx()','delTx()','openSharedSettings()']],
    ['openFx(0)',['closeFx()','saveFx()','delFixed()','openSharedSettings()']]
  ])for(const action of actions){
    const a=app();a.run(`openApp('ledger','list');cur().tx=[{id:123,type:'out',amt:5000,cat:OUT_CATS[0],memo:'Lunch',date:today()}];cur().fixed=[{name:'Rent',amt:10000,day:5}];${open};${action}`);
    assert.equal(a.el('sheet').classList.contains('show'),false);assert.equal(a.el('fxSheet').classList.contains('show'),false);assert.equal(a.run('sheetHistoryBackPending'),false);assert.equal(a.run('window.history.state?.appSheet'),undefined);
    if(action==='openSharedSettings()'){assert.equal(a.run('activeApp'),'settings');a.run('window.history.back()');assert.equal(a.run('activeApp'),'ledger')}
    a.run('window.history.back()');assert.equal(a.run('activeApp'),'platform');
  }
});

test('planned expense confirmation restores the correct form without changing the plan on back',()=>{
  const a=app();a.run(`openApp('ledger');cur().plan=[{id:123,type:'plan',amt:7000,cat:OUT_CATS[0],memo:'Dinner',date:today()}];confirmPlan(123)`);
  a.context.confirm=()=>{throw new Error('prefilled confirmation is unchanged')};
  a.run('window.history.back()');assert.equal(a.run('cur().plan.length'),1);assert.equal(a.run('cur().tx.length'),0);
  a.run('window.history.forward()');assert.equal(a.run('fromPlan'),123);assert.equal(a.el('fAmt').value,'7,000');assert.equal(a.el('sTitle').textContent,'예정 지출 확정');
});

test('deleted ledger records and shifted fixed-expense indexes do not reopen through forward',()=>{
  for(const action of ['openSheet(123);delTx()','openFx(0);delFixed()']){
    const a=app();a.run(`openApp('ledger');cur().tx=[{id:123,type:'out',amt:5000,cat:OUT_CATS[0],memo:'Lunch',date:today()}];cur().fixed=[{name:'Rent',amt:10000,day:5},{name:'Phone',amt:5000,day:10}];${action};window.history.forward()`);
    assert.equal(a.el('sheet').classList.contains('show'),false);assert.equal(a.el('fxSheet').classList.contains('show'),false);assert.equal(a.run('activeApp'),'ledger');assert.equal(a.run('window.history.state?.appSheet'),undefined);
  }
});

test('history left by the older fridge-only version restores using the common dialog handler',()=>{
  const a=app();a.run(`openApp('fridge');window.history.pushState({foodSheet:{id:null,taskId:null}},'',window.location.href);restoreAppRoute()`);
  assert.equal(a.el('foodSheet').classList.contains('show'),true);assert.equal(a.run('window.history.state.appSheet.kind'),'food');assert.equal(a.run('window.history.state.foodSheet'),undefined);
  a.run('window.history.back()');assert.equal(a.el('foodSheet').classList.contains('show'),false);assert.equal(a.run('activeApp'),'fridge');
});

test('forward restores the ledger dialog and visible budget period together after changing periods',()=>{
  for(const open of ['openSheet()','openFx(0)']){
    const a=app();a.run(`openApp('ledger');cur().fixed=[{name:'Rent',amt:10000,day:5}];render()`);
    const period=a.run('S.cur'),label=a.el('plabel').textContent;
    a.run(`${open};window.history.back();movePeriod(1);window.history.forward()`);
    assert.equal(a.run('S.cur'),period);assert.equal(a.el('plabel').textContent,label);assert.equal(a.run('currentAppSheet()!==null'),true);
  }
});
test('food check creates one pending purchase and no inventory or extra expense',()=>{
  const a=app();addPurchase(a);assert.equal(a.run('pendingFoodTasks().length'),1);assert.equal(a.run('foodItems().length'),0);assert.equal(a.run('cur().tx.length'),1);assert.equal(a.run('calc(S.cur).spent'),42000);assert.equal(a.el('foodNavCount').textContent,1);
});
test('ordinary expense, income and plan do not create food tasks',()=>{
  const a=app();addPurchase(a,[]);
  for(const type of ['in','plan']){a.run(`openSheet();setType('${type}')`);a.el('fAmt').value='1000';a.checks[0].checked=true;a.run('saveTx()')}
  assert.equal(a.run('pendingFoodTasks().length'),0);
});
test('new transaction IDs remain unique when saves happen in one millisecond',()=>{
  const a=app();a.run('Date.now=()=>12345');addPurchase(a);addPurchase(a);assert.equal(new Set(a.json('cur().tx.map(t=>t.id)')).size,2);
});
test('one purchase registers separate product batches and stays pending until manual completion',()=>{
  const a=app(),id=addPurchase(a);a.run(`openFoodTask(${id})`);const date=a.el('fdBought').value;
  addFood(a);assert.equal(a.run('pendingFoodTasks().length'),1);a.run('closeFoodSheet();openFoodTask('+id+')');addFood(a,'계란');
  assert.equal(a.run('foodItems().length'),2);assert.equal(a.run('cur().tx.length'),1);assert.ok(a.json('foodItems()').every(f=>f.txId===id&&f.purchasedAt===date));
  a.run('finishFoodTask()');assert.equal(a.run('pendingFoodTasks().length'),0);assert.equal(a.run('cur().tx[0].foodState'),'done');
});
test('editing a linked ingredient changes only that ingredient and keeps purchase details collapsed',()=>{
  const a=app(),purchase=addPurchase(a);a.run(`openFoodTask(${purchase})`);const food=addFood(a),before=a.json(`findTx(${purchase}).t`);
  a.run(`closeFoodSheet(true);editFood('${food}')`);assert.equal(a.run('foodEditId'),food);assert.equal(a.el('fdTitle').textContent,'식재료 수정');assert.equal(a.el('fdExtra').open,false);assert.ok(a.el('fdExtraInfo').innerHTML.includes('마트'));
  a.el('fdName').value='저지방 우유';a.el('fdQty').value='3';a.run('saveFood()');assert.equal(a.run(`S.foods['${food}'].txId`),purchase);assert.equal(a.run(`S.foods['${food}'].name`),'저지방 우유');assert.equal(a.run(`S.foods['${food}'].quantity`),3);assert.deepEqual(a.json(`findTx(${purchase}).t`),before);
});
test('finish can save the last entered product and complete the purchase together',()=>{
  const a=app(),id=addPurchase(a);a.run(`openFoodTask(${id})`);a.el('fdName').value='두부';a.run('finishFoodTask()');assert.equal(a.run('foodItems().length'),1);assert.equal(a.run('pendingFoodTasks().length'),0);
});
test('empty purchase cannot be completed and can instead be explicitly dismissed',()=>{
  const a=app(),id=addPurchase(a);a.run(`openFoodTask(${id});finishFoodTask()`);assert.equal(a.run('pendingFoodTasks().length'),1);assert.ok(a.alerts.length);a.run(`skipFoodTask(${id})`);assert.equal(a.run('pendingFoodTasks().length'),0);assert.equal(a.run('cur().tx[0].foodState'),'skipped');
});
test('editing purchase date and memo preserves completion; adding a storage type reopens it',()=>{
  const a=app(),id=addPurchase(a,['chilled']);a.run(`openFoodTask(${id})`);addFood(a);a.run('finishFoodTask()');
  a.run(`openSheet(${id})`);a.el('fMemo').value='수정한 장보기';a.el('fDate').value='2026-10-20';a.run('saveTx()');assert.equal(a.run('pendingFoodTasks().length'),0);
  a.run(`openSheet(${id})`);a.checks[1].checked=true;a.run('saveTx()');assert.equal(a.run('pendingFoodTasks().length'),1);assert.equal(a.run('foodPurchases().length'),1);
});
test('deleting a purchase removes its pending task but preserves registered inventory',()=>{
  const a=app(),id=addPurchase(a);a.run(`openFoodTask(${id})`);addFood(a);a.run(`closeFoodSheet();openSheet(${id});delTx()`);assert.equal(a.run('pendingFoodTasks().length'),0);assert.equal(a.run('foodItems().length'),1);assert.ok(a.run('foodItems()[0].sourceMemo.includes("마트")'));
});
test('unchecking food cancels the pending task without deleting registered products',()=>{
  const a=app(),id=addPurchase(a);a.run(`openFoodTask(${id})`);addFood(a);a.run(`closeFoodSheet();openSheet(${id})`);a.checks.forEach(c=>c.checked=false);a.run('saveTx()');assert.equal(a.run('pendingFoodTasks().length'),0);assert.equal(a.run('foodItems().length'),1);
});
test('direct registration, same-name batches, consumption and restoration',()=>{
  const a=app();a.run('openFoodSheet()');const id=addFood(a);a.run('openFoodSheet()');addFood(a);assert.equal(a.run('foodItems().length'),2);
  a.run(`changeFoodState('${id}','consumed')`);assert.equal(a.run(`S.foods['${id}'].status`),'consumed');
  a.run(`changeFoodState('${id}','active')`);assert.equal(a.run(`S.foods['${id}'].status`),'active');assert.equal(a.run(`S.foods['${id}'].finishedAt`),undefined);
  a.run(`changeFoodState('${id}','discarded')`);assert.equal(a.run(`S.foods['${id}'].status`),'discarded');
});
test('missing product name and invalid quantities do not save',()=>{
  const a=app();a.run('openFoodSheet();saveFood()');assert.equal(a.run('foodItems().length'),0);
  a.el('fdName').value='우유';a.el('fdQty').value='0';a.run('saveFood()');assert.equal(a.run('foodItems().length'),0);
  a.el('fdQty').value='-1';a.run('saveFood()');assert.equal(a.run('foodItems().length'),0);
});
test('inventory and pending tasks persist when loading the same saved state again',()=>{
  const a=app(),id=addPurchase(a);a.run(`openFoodTask(${id})`);addFood(a);const b=app(JSON.parse(a.memory.get('my-gagyebu-v2')));assert.equal(b.run('foodItems().length'),1);assert.equal(b.run('pendingFoodTasks().length'),1);
});
test('products survive budget period moves and start-day changes',()=>{
  const a=app();a.run('openFoodSheet()');addFood(a);a.el('sDay').value='21';a.run('saveDay();movePeriod(1)');assert.equal(a.run('foodItems().length'),1);assert.equal(a.run('START_DAY'),21);
});
test('expiry calculation handles missing, past, today and distant dates without local DST arithmetic',()=>{
  const a=app();assert.equal(a.run('foodDays(null)'),null);assert.equal(a.run('foodDays(today())'),0);assert.equal(a.run('foodExpiry({bestBefore:"2000-01-01"}).cls'),'past');assert.equal(a.run('foodExpiry({bestBefore:today()}).cls'),'soon');assert.equal(a.run('foodExpiry({bestBefore:"2999-01-01"}).cls'),'');
});
test('product names and purchase memos are escaped in the rendered UI',()=>{
  const a=app();a.run('openFoodSheet()');addFood(a,'<img src=x onerror=alert(1)>');const page=a.run('fridgePage()');assert.ok(page.includes('&lt;img'));assert.ok(!page.includes('<img src=x'));
});
test('storage overview counts active batches and separates upcoming, expired, missing and distant dates',()=>{
  const a=app();
  a.run(`const dateOffset=n=>new Date(Date.parse(today()+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
    const stored=(id,days,status='active',store='chilled')=>({id,name:id,store,status,quantity:20,bestBefore:days===null?null:dateOffset(days)});
    S.foods=Object.fromEntries([stored('today',0),stored('three-days',3),stored('expired',-1),stored('unknown',null),stored('later',4),stored('eaten',0,'consumed'),stored('discarded',-1,'discarded'),stored('frozen',0,'active','frozen')].map(f=>[f.id,f]));`);
  assert.deepEqual(a.json('foodStorageSummary("chilled")'),{count:5,soon:2,expired:1,unknown:1});
  assert.deepEqual(a.json('foodStorageSummary("frozen")'),{count:1,soon:1,expired:0,unknown:0});
  assert.deepEqual(a.json('foodStorageSummary("pantry")'),{count:0,soon:0,expired:0,unknown:0});
});
test('missing expiry is clearly marked and never presented as no upcoming expiry when all dates are unknown',()=>{
  const a=app();assert.ok(!a.run('foodStorageStatus({count:2,soon:0,expired:0,unknown:2})').includes('임박 없음'));
  assert.ok(a.run('foodStorageStatus({count:2,soon:0,expired:0,unknown:2})').includes('기한 미입력 2'));
  assert.ok(a.run('foodStorageStatus({count:1,soon:0,expired:0,unknown:0})').includes('임박 없음'));
  assert.ok(a.run('foodStorageStatus({count:0,soon:0,expired:0,unknown:0})').includes('비어 있어요'));
});
test('selecting a pictured storage resets search/history and shows its active inventory',()=>{
  const a=app();a.run('openApp("fridge","history");foodQuery="not found";selectFoodStorage("pantry")');
  assert.equal(a.run('foodView'),'active');assert.equal(a.run('foodStore'),'pantry');assert.equal(a.run('foodQuery'),'');
  assert.ok(a.el('view').innerHTML.includes('실온 보관 식재료'));
});
test('backup validation rejects unsafe inventory IDs and malformed inventory',()=>{
  const a=app();assert.throws(()=>a.run('prepareFoodData({p:{},foods:[]})'));
  assert.throws(()=>a.run(`prepareFoodData({p:{},foods:{"bad'":{id:"bad'",name:'x',store:'chilled',status:'active',quantity:1}}})`));
});
test('expiry buttons repeatedly add days and weeks from the initial purchase date',()=>{
  const a=app();assert.equal(a.run('foodPresetDate("2026-12-31","1d")'),'2027-01-01');assert.equal(a.run('foodPresetDate("2026-12-28","1w")'),'2027-01-04');
  a.run('openFoodSheet()');a.el('fdBought').value='2026-11-13';a.run('chooseFoodExpiry("1d");chooseFoodExpiry("1d")');assert.equal(a.el('fdExpiry').value,'2026-11-15');a.run('chooseFoodExpiry("1w")');assert.equal(a.el('fdExpiry').value,'2026-11-22');
});
test('expiry month shortcuts clamp month ends and handle leap years without using fixed-day approximations',()=>{
  const a=app();
  for(const [source,preset,expected] of [['2026-01-31','1m','2026-02-28'],['2024-01-31','1m','2024-02-29'],['2026-01-31','3m','2026-04-30'],['2023-08-31','6m','2024-02-29'],['2026-11-13','6m','2027-05-13']])assert.equal(a.run(`foodPresetDate('${source}','${preset}')`),expected);
});
test('expiry shortcuts reject missing or invalid purchase dates without overwriting an existing expiry',()=>{
  const a=app();for(const date of ['',null,'2026-02-30','2026-13-01','invalid']){a.context.date=date;assert.equal(a.run('foodPresetDate(date,"1m")'),null)}
  assert.equal(a.run('foodPresetDate("2026-11-13","invalid")'),null);a.run('openFoodSheet()');a.el('fdBought').value='';assert.equal(a.run('chooseFoodExpiry("1w")'),false);assert.equal(a.el('fdExpiry').value,'');
  a.el('fdExpiry').value='2026-12-01';assert.equal(a.run('chooseFoodExpiry("1w")'),true);assert.equal(a.el('fdExpiry').value,'2026-12-08');
});
test('changing purchase date recalculates a selected expiry shortcut and blocks saving until purchase date is present',()=>{
  const a=app();a.run('openFoodSheet()');a.el('fdBought').value='2024-01-31';a.run('chooseFoodExpiry("1m")');a.el('fdBought').value='2024-02-29';a.run('changeFoodBought()');assert.equal(a.el('fdExpiry').value,'2024-03-29');
  a.el('fdBought').value='';a.run('changeFoodBought()');assert.equal(a.el('fdExpiry').value,'');a.el('fdName').value='우유';assert.equal(a.run('saveFood()'),false);assert.equal(a.run('foodItems().length'),0);
});
test('manual expiry clears the shortcut and subsequent purchase-date changes leave the manual date unchanged',()=>{
  const a=app();a.run('openFoodSheet()');a.el('fdBought').value='2026-01-31';a.run('chooseFoodExpiry("1m")');a.el('fdExpiry').value='2026-03-10';a.run('manualFoodExpiry()');a.el('fdBought').value='2026-02-02';a.run('changeFoodBought()');assert.equal(a.el('fdExpiry').value,'2026-03-10');assert.deepEqual(a.json('foodExpirySteps'),[]);
});
test('saved expiry shortcuts reopen selected and survive reload, while batch registration resets the next product',()=>{
  const a=app(),purchase=addPurchase(a);a.run(`openFoodTask(${purchase})`);a.el('fdBought').value='2026-01-31';a.run('chooseFoodExpiry("1m")');const id=addFood(a);assert.deepEqual(a.json('foodExpirySteps'),[]);assert.equal(a.el('fdExpiry').value,'');
  assert.equal(a.run(`S.foods['${id}'].bestBefore`),'2026-02-28');const b=app(JSON.parse(a.memory.get('my-gagyebu-v2')));b.run(`editFood('${id}')`);assert.deepEqual(b.json('foodExpirySteps'),['1m']);assert.equal(b.el('fdExpiry').value,'2026-02-28');
  b.el('fdExpiry').value='2026-03-05';b.run('manualFoodExpiry();saveFood()');assert.equal(b.run(`S.foods['${id}'].expirySteps`),undefined);
});
test('existing manually entered expiry dates remain unchanged when editing purchase date',()=>{
  const a=app(),id=addStock(a,2);a.run(`S.foods['${id}'].bestBefore='2026-12-01';editFood('${id}')`);a.el('fdBought').value='2026-11-20';a.run('changeFoodBought()');assert.equal(a.el('fdExpiry').value,'2026-12-01');assert.deepEqual(a.json('foodExpirySteps'),[]);
});
test('cumulative expiry follows month-end clamping in click order and recalculates after purchase changes',()=>{
  const a=app();a.run('openFoodSheet()');a.el('fdBought').value='2026-01-31';a.run('chooseFoodExpiry("1m");chooseFoodExpiry("1m")');assert.equal(a.el('fdExpiry').value,'2026-03-28');
  a.el('fdBought').value='2024-01-31';a.run('changeFoodBought()');assert.equal(a.el('fdExpiry').value,'2024-03-29');
});
test('manually entered deadlines can be extended, saved and extended again without changing their anchor',()=>{
  const a=app();a.run('openFoodSheet()');a.el('fdBought').value='2026-01-01';a.el('fdExpiry').value='2026-02-01';a.run('manualFoodExpiry();chooseFoodExpiry("1d");chooseFoodExpiry("1w")');const id=addFood(a);assert.equal(a.run(`S.foods['${id}'].bestBefore`),'2026-02-09');
  const b=app(JSON.parse(a.memory.get('my-gagyebu-v2')));b.run(`editFood('${id}')`);b.el('fdBought').value='2026-01-20';b.run('changeFoodBought()');assert.equal(b.el('fdExpiry').value,'2026-02-09');b.run('chooseFoodExpiry("1d")');assert.equal(b.el('fdExpiry').value,'2026-02-10');
});
test('reset clears accumulated expiry and a legacy single preset can be extended',()=>{
  const a=app(),id=addStock(a,1);a.run(`S.foods['${id}'].purchasedAt='2026-01-31';S.foods['${id}'].bestBefore='2026-02-28';S.foods['${id}'].expiryPreset='1m';editFood('${id}');chooseFoodExpiry('1d')`);assert.equal(a.el('fdExpiry').value,'2026-03-01');a.run('saveFood()');assert.deepEqual(a.json(`S.foods['${id}'].expirySteps`),['1m','1d']);
  a.run(`editFood('${id}');resetFoodExpiry();chooseFoodExpiry('1d')`);assert.equal(a.el('fdExpiry').value,'2026-02-01');assert.deepEqual(a.json('foodExpirySteps'),['1d']);
});
test('legacy opening metadata is removed without losing inventory, amounts or ledger links',()=>{
  const a=app(),id=addStock(a,5),data=a.json('S');data.foods[id].openedAt='2026-11-13';const b=app(data);assert.equal(b.run(`S.foods['${id}'].openedAt`),undefined);assert.equal(b.run(`S.foods['${id}'].quantity`),5);assert.ok(!b.run('fridgePage()').includes('개봉'));
  b.run('openApp("fridge","opened")');assert.equal(b.run('foodView'),'active');
});
test('one-tap use reduces only the selected batch and keeps initial and remaining amounts across reloads',()=>{
  const a=app(),id=addStock(a,10);addStock(a,3,'통');a.run(`useFood('${id}');useFood('${id}')`);
  assert.equal(a.run(`S.foods['${id}'].quantity`),8);assert.equal(a.run(`S.foods['${id}'].initialQuantity`),10);assert.equal(a.run('foodItems()[1].quantity'),3);
  const b=app(JSON.parse(a.memory.get('my-gagyebu-v2')));assert.equal(b.run(`S.foods['${id}'].quantity`),8);assert.equal(b.run(`S.foods['${id}'].initialQuantity`),10);
});
test('last unit becomes consumed at zero and further taps cannot create negative stock',()=>{
  const a=app();addPurchase(a);const id=addStock(a,1,'팩');a.run(`useFood('${id}')`);
  assert.equal(a.run(`foodRemaining(S.foods['${id}'])`),0);assert.equal(a.run(`S.foods['${id}'].status`),'consumed');assert.equal(a.run('foodStorageSummary("chilled").count'),0);assert.equal(a.run(`useFood('${id}')`),false);
  const saved=JSON.parse(a.memory.get('my-gagyebu-v2')),b=app(saved);assert.ok(saved.foods[id].quantity>0);assert.equal(b.run('foodItems().length'),1);assert.equal(b.run(`foodRemaining(S.foods['${id}'])`),0);assert.equal(b.run('Object.values(S.p).flatMap(p=>p.tx).length'),1);
});
test('countable containers use one unit while weight and volume amounts require explicit edits',()=>{
  const a=app();for(const unit of ['개','통','팩','봉','병']){const id=addStock(a,3,unit);assert.equal(a.run(`useFood('${id}')`),true);assert.equal(a.run(`S.foods['${id}'].quantity`),2)}
  for(const unit of ['g','kg','ml','L']){const id=addStock(a,500,unit);assert.equal(a.run(`useFood('${id}')`),false);assert.equal(a.run(`S.foods['${id}'].quantity`),500)}
});
test('a last partial portion consumes its actual remainder without going negative',()=>{
  const a=app(),id=addStock(a,1.5,'팩');a.run(`useFood('${id}')`);assert.equal(a.run(`S.foods['${id}'].quantity`),0.5);a.run(`useFood('${id}')`);assert.equal(a.run(`foodRemaining(S.foods['${id}'])`),0);assert.equal(a.run('lastFoodUse.used'),0.5);
});
test('undo restores the last decrement or last-unit completion without changing unrelated fields',()=>{
  const a=app(),id=addStock(a,2);a.run(`useFood('${id}');S.foods['${id}'].name='수정한 이름';undoFoodUse()`);assert.equal(a.run(`S.foods['${id}'].quantity`),2);assert.equal(a.run(`S.foods['${id}'].name`),'수정한 이름');
  a.run(`useFood('${id}');useFood('${id}');undoFoodUse()`);assert.equal(a.run(`S.foods['${id}'].quantity`),1);assert.equal(a.run(`S.foods['${id}'].status`),'active');assert.equal(a.run(`S.foods['${id}'].finishedAt`),undefined);assert.equal(a.run('undoFoodUse()'),false);
});
test('undo refuses to overwrite a newer quantity change',()=>{
  const a=app(),id=addStock(a,10);a.run(`useFood('${id}');S.foods['${id}'].quantity=4`);assert.equal(a.run('undoFoodUse()'),false);assert.equal(a.run(`S.foods['${id}'].quantity`),4);assert.ok(a.alerts.length);
});
test('consumption restoration uses the last remaining amount, not the original purchase amount',()=>{
  const a=app(),id=addStock(a,10);a.run(`useFood('${id}');useFood('${id}');changeFoodState('${id}','consumed')`);assert.equal(a.run(`foodRemaining(S.foods['${id}'])`),0);a.run(`changeFoodState('${id}','active')`);assert.equal(a.run(`S.foods['${id}'].quantity`),8);
  a.run(`changeFoodState('${id}','discarded');changeFoodState('${id}','active')`);assert.equal(a.run(`S.foods['${id}'].quantity`),8);
});
test('legacy consumed batches are normalized without losing their restoration quantity or modifying the input',()=>{
  const a=app(),id=addStock(a,5),data=a.json('S');data.foods[id].status='consumed';a.context.legacy=data;const normalized=a.json('prepareFoodData(legacy)');assert.equal(a.run(`foodRemaining(prepareFoodData(legacy).foods['${id}'])`),0);assert.equal(normalized.foods[id].restoreQuantity,5);assert.equal(data.foods[id].quantity,5);
  const b=app(data);b.run(`changeFoodState('${id}','active')`);assert.equal(b.run(`S.foods['${id}'].quantity`),5);
});
test('editing exhausted stock preserves zero and offers a positive quantity when restoring from the editor',()=>{
  const a=app(),id=addStock(a,1,'통');a.run(`useFood('${id}');editFood('${id}')`);assert.equal(a.el('fdQty').value,0);a.el('fdName').value='이름 변경';a.run('saveFood()');assert.equal(a.run(`foodRemaining(S.foods['${id}'])`),0);
  a.run(`editFood('${id}')`);a.el('fdStatus').value='active';a.run('syncFoodStatusInput();saveFood()');assert.equal(a.run(`S.foods['${id}'].quantity`),1);assert.equal(a.run(`S.foods['${id}'].status`),'active');
});
test('sync combines zero-stock completion with a remote metadata edit and can reload the result',()=>{
  const a=app(),id=addStock(a,1),base=a.json('S');a.run(`useFood('${id}')`);const local=a.json('S'),remote=clone(base);remote.foods[id].name='다른 기기 이름';a.context.base=base;a.context.left=local;a.context.right=remote;
  const merged=a.json('merge3(JSON.stringify(base),left,right)'),b=app(merged);assert.equal(b.run(`S.foods['${id}'].status`),'consumed');assert.equal(b.run(`foodRemaining(S.foods['${id}'])`),0);assert.equal(b.run(`S.foods['${id}'].name`),'다른 기기 이름');
});
test('three-way sync combines distinct products and distinct edits to one product',()=>{
  const a=app();a.run('openFoodSheet()');const id=addFood(a),base=a.json('S'),l=clone(base),r=clone(base);
  l.foods[id].bestBefore='2026-12-01';r.foods[id].quantity=2;r.foods.other={...r.foods[id],id:'other',name:'계란'};
  a.context.base=base;a.context.left=l;a.context.right=r;
  const result=a.json('merge3(JSON.stringify(base),left,right)');assert.equal(Object.keys(result.foods).length,2);assert.equal(result.foods[id].bestBefore,'2026-12-01');assert.equal(result.foods[id].quantity,2);
});
test('three-way sync preserves expense edits alongside completing its food task',()=>{
  const a=app(),id=addPurchase(a),base=a.json('S'),l=clone(base),r=clone(base),k=base.cur;
  l.p[k].tx[0].foodState='done';r.p[k].tx[0].memo='메모 수정';a.context.base=base;a.context.left=l;a.context.right=r;
  const result=a.json('merge3(JSON.stringify(base),left,right)');assert.equal(result.p[k].tx[0].foodState,'done');assert.equal(result.p[k].tx[0].memo,'메모 수정');assert.equal(result.p[k].tx[0].id,id);
});
test('a remote purchase date move stays in the correct period alongside local task completion',()=>{
  const a=app();addPurchase(a);const base=a.json('S'),l=clone(base),r=clone(base),k=base.cur;
  l.p[k].tx[0].foodState='done';const moved=r.p[k].tx.pop();moved.date='2026-12-02';r.p['2026-12-01']={start:0,fixed:[],tx:[moved]};
  a.context.base=base;a.context.left=l;a.context.right=r;
  const result=a.json('merge3(JSON.stringify(base),left,right)');assert.equal(result.p[k].tx.length,0);assert.equal(result.p['2026-12-01'].tx[0].foodState,'done');assert.equal(result.p['2026-12-01'].tx[0].date,'2026-12-02');
});
test('sync preserves deletion and concurrent editing according to three-way rules',()=>{
  const a=app();a.context.b={x:{id:'x',name:'우유',quantity:1}};a.context.l={};a.context.r=clone(a.context.b);
  assert.deepEqual(a.json('mergeFoodRecords(b,l,r)'),{});a.context.r.x.quantity=2;assert.equal(a.run('mergeFoodRecords(b,l,r).x.quantity'),2);
});
test('finance merge uses the parsed baseline so remote changes are not overwritten by unchanged local values',()=>{
  const a=app();addPurchase(a);const base=a.json('S'),l=clone(base),r=clone(base);r.p[base.cur].start=123456;a.context.base=base;a.context.left=l;a.context.right=r;
  assert.equal(a.run('merge3(JSON.stringify(base),left,right).p[base.cur].start'),123456);
});
test('Apps Script accepts new clients and blocks older clients after fridge migration',()=>{
  const src=fs.readFileSync(path.join(root,'구글시트-동기화-코드.gs'),'utf8');let current={ver:1,data:{schemaVersion:3,p:{},foods:{}}},writes=0;
  const c=vm.createContext({LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}});
  vm.runInContext(src,c);c.testCurrent=()=>current;c.writeCount=()=>{writes++};
  vm.runInContext('readData=()=>testCurrent();out=x=>x;writeData=()=>writeCount();writeList=()=>{};',c);
  assert.equal(vm.runInContext('handle("incorrect",null,3).error',c),'auth');
  assert.equal(vm.runInContext('handle(SECRET,null,0).error',c),'auth');
  // Test with a configured password; the shipped placeholder intentionally refuses access.
  const configured=src.replace("const SECRET = '여기에-비밀번호-입력';","const SECRET = 'test-only';");
  const d=vm.createContext({LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}});vm.runInContext(configured,d);d.testCurrent=()=>current;d.writeCount=()=>{writes++};vm.runInContext('readData=()=>testCurrent();out=x=>x;writeData=()=>writeCount();writeList=()=>{};',d);
  assert.equal(vm.runInContext('handle(SECRET,null,0).error',d),'upgrade');
  assert.equal(vm.runInContext('handle(SECRET,{base:1,data:{}},0).error',d),'upgrade');assert.equal(writes,0);
  assert.equal(vm.runInContext('handle(SECRET,{base:1,data:{}},3).ok',d),true);assert.equal(writes,1);
  current={ver:2,data:{schemaVersion:4,p:{},recipes:{}}};
  assert.equal(vm.runInContext('handle(SECRET,null,3).error',d),'upgrade');
  assert.equal(vm.runInContext('handle(SECRET,{base:2,data:{}},3).error',d),'upgrade');assert.equal(writes,1);
  assert.equal(vm.runInContext('handle(SECRET,{base:2,data:{}},4).ok',d),true);assert.equal(writes,2);
  current={ver:3,data:{schemaVersion:5,p:{},tasks:{}}};
  assert.equal(vm.runInContext('handle(SECRET,null,4).error',d),'upgrade');
  assert.equal(vm.runInContext('handle(SECRET,{base:3,data:{}},4).error',d),'upgrade');assert.equal(writes,2);
  assert.equal(vm.runInContext('handle(SECRET,{base:3,data:{}},5).ok',d),true);assert.equal(writes,3);
  current={ver:1,data:{p:{}}};assert.equal(vm.runInContext('handle(SECRET,null,0).ver',d),1);
});

function addRecipe(a,title='김치볶음밥'){
  a.run('openApp("recipes");openRecipeSheet()');a.el('rc-title').value=title;
  a.el('rc-ingredients').value='김치 100g\n밥 1공기';a.el('rc-steps').value='김치를 볶아요.\n밥을 넣어요.';a.el('rc-tags').value='한식, 간단 요리';
  a.run('saveRecipe()');return a.run('recipeItems().at(-1).id');
}
test('recipe app preserves old data and uses only its own navigation',()=>{
  const a=app();addPurchase(a);const purchase=a.json('cur().tx');
  a.run('openApp("recipes")');assert.equal(a.el('recipeNav').hidden,false);assert.equal(a.el('recipeHeader').hidden,false);
  assert.equal(a.el('ledgerNav').hidden,true);assert.equal(a.el('fridgeNav').hidden,true);assert.deepEqual(a.json('S.recipes'),{});
  assert.deepEqual(a.json('cur().tx'),purchase);assert.equal(a.run('PLATFORM_APPS.some(app=>app.id==="recipes")'),true);
});
test('recipes save, edit and reload with source, text and photos included in shared state',()=>{
  const a=app(),id=addRecipe(a);a.run(`openRecipeSheet('${id}')`);a.el('rc-source').value='가족 노트';a.el('rc-url').value='https://example.com/recipe';
  a.el('rc-original').value='가져온 원문';a.run(`recipeDraftImages=['data:image/png;base64,aGVsbG8='];saveRecipe()`);
  assert.equal(a.run('currentAppRoute.section'),id);const b=app(a.json('S'));
  assert.equal(b.run(`S.recipes['${id}'].source`),'가족 노트');assert.equal(b.run(`S.recipes['${id}'].images.length`),1);
  assert.equal(b.run('recipeItems().length'),1);assert.equal(b.run('S.schemaVersion'),5);
  b.run(`openApp('recipes','${id}')`);assert.ok(b.el('view').innerHTML.includes('가져온 원문'));assert.ok(b.el('view').innerHTML.includes('rel="noopener noreferrer"'));
});
test('recipe search covers ingredients, source and tags and favorites filter independently',()=>{
  const a=app(),id=addRecipe(a);addRecipe(a,'우유 푸딩');a.run(`S.recipes['${id}'].source='엄마';S.recipes['${id}'].favorite=true;openApp('recipes','favorites')`);
  assert.equal(a.run('recipeResults().length'),1);a.run(`recipeQuery='김치'`);assert.equal(a.run('recipeResults().length'),1);
  a.run(`recipeQuery='엄마'`);assert.equal(a.run('recipeResults().length'),1);a.run(`recipeQuery='없는 재료'`);assert.equal(a.run('recipeResults().length'),0);
  a.run(`recipeQuery='';recipeTag='간단 요리';openApp('recipes')`);assert.equal(a.run('recipeResults().length'),2);
});
test('recipe paste splits labeled sections and keeps original unstructured text unchanged',()=>{
  const a=app();a.run('openRecipeSheet()');a.el('rc-original').value='김치볶음밥\n[재료]\n김치 100g\n밥 1공기\n[만드는 법]\n1. 김치를 볶아요.\n2. 밥을 넣어요.';a.run('splitRecipeText()');
  assert.equal(a.el('rc-ingredients').value,'김치 100g\n밥 1공기');assert.equal(a.el('rc-steps').value,'1. 김치를 볶아요.\n2. 밥을 넣어요.');
  a.el('rc-original').value='제목 없는 복사한 글';a.run('splitRecipeText()');assert.equal(a.el('rc-original').value,'제목 없는 복사한 글');assert.ok(a.el('rcNotice').textContent.includes('찾지 못했어요'));
});
test('recipe title and safe URL validation prevent invalid saves and escape all displayed text',()=>{
  const a=app();a.run('openRecipeSheet();saveRecipe()');assert.equal(a.run('recipeItems().length'),0);
  a.el('rc-title').value='<img src=x onerror=alert(1)>';a.el('rc-url').value='javascript:alert(1)';a.run('saveRecipe()');assert.equal(a.run('recipeItems().length'),0);
  a.el('rc-url').value='https://example.com';a.run('saveRecipe()');assert.equal(a.run('recipeItems().length'),1);
  assert.ok(a.el('view').innerHTML.includes('&lt;img'));assert.ok(!a.el('view').innerHTML.includes('<img src=x'));
  assert.throws(()=>a.run(`prepareRecipeData({recipes:{bad:{id:'bad',title:'x',url:'javascript:alert(1)'}}})`));
  assert.throws(()=>a.run(`prepareRecipeData({recipes:{bad:{id:'bad',title:'x',images:['data:image/svg+xml;base64,aGVsbG8=']}}})`));
  assert.throws(()=>a.run(`prepareRecipeData({recipes:JSON.parse('{"__proto__":{"id":"__proto__","title":"x"}}')})`));
  assert.throws(()=>a.run(`prepareRecipeData({recipes:[]})`));
});
test('recipe back protects unsaved text and photos and restores list filters',()=>{
  const a=app();a.run(`openApp('recipes','favorites');recipeQuery='김치';openRecipeSheet()`);a.el('rc-title').value='작성 중';
  a.context.confirm=()=>false;a.run('window.history.back()');assert.equal(a.el('recipeSheet').classList.contains('show'),true);assert.equal(a.el('rc-title').value,'작성 중');
  a.run('openPlatform()');assert.equal(a.run('activeApp'),'recipes');
  a.context.confirm=()=>true;a.run('window.history.back()');assert.equal(a.el('recipeSheet').classList.contains('show'),false);assert.equal(a.run('recipeQuery'),'김치');assert.equal(a.run('currentAppRoute.section'),'favorites');
  a.run(`openRecipeSheet();recipeDraftImages=['data:image/png;base64,aGVsbG8=']`);a.context.confirm=()=>false;a.run('closeRecipeSheet()');assert.equal(a.el('recipeSheet').classList.contains('show'),true);
});
test('recipe saving and deletion consume dialog history and deleted editors cannot restore',()=>{
  const a=app(),id=addRecipe(a);a.run(`openRecipeSheet('${id}');deleteRecipe()`);assert.equal(a.run('recipeItems().length'),0);assert.equal(a.run('activeApp'),'recipes');
  a.run('window.history.back();window.history.forward()');assert.equal(a.el('recipeSheet').classList.contains('show'),false);
});
test('recipe save failure retains editor draft and rolls back memory and favorite state',()=>{
  const a=app(),id=addRecipe(a);a.run(`openRecipeSheet('${id}')`);a.el('rc-title').value='저장 실패한 제목';
  a.context.localStorage.setItem=()=>{throw new Error('QuotaExceededError')};a.run('saveRecipe()');
  assert.equal(a.run(`S.recipes['${id}'].title`),'김치볶음밥');assert.equal(a.el('rc-title').value,'저장 실패한 제목');assert.equal(a.el('recipeSheet').classList.contains('show'),true);
  a.run(`toggleRecipeFavorite('${id}')`);assert.equal(a.run(`S.recipes['${id}'].favorite`),false);
});
test('recipe sync combines additions, field edits and deletion without changing linked purchases',()=>{
  const a=app(),id=addRecipe(a);addPurchase(a);const base=a.json('S'),left=clone(base),right=clone(base);
  left.recipes[id].notes='소금 적게';right.recipes[id].title='새 이름';right.recipes.remote={...right.recipes[id],id:'remote'};
  a.context.base=base;a.context.left=left;a.context.right=right;const merged=a.json('merge3(JSON.stringify(base),left,right)');
  assert.equal(merged.recipes[id].notes,'소금 적게');assert.equal(merged.recipes[id].title,'새 이름');assert.equal(Object.keys(merged.recipes).length,2);assert.deepEqual(merged.p,base.p);
  delete left.recipes[id];right.recipes[id]=clone(base.recipes[id]);assert.equal(a.run(`merge3(JSON.stringify(base),left,right).recipes['${id}']`),undefined);
});
test('backup import and remote adoption keep existing records when larger recipe data cannot be stored',()=>{
  const a=app();addRecipe(a);addPurchase(a);const before=a.json('S');
  a.context.FileReader=class{readAsText(file){this.result=file;this.onload()}};
  a.el('imp').files=[JSON.stringify({p:{},recipes:{remote:{id:'remote',title:'더 큰 사진 백업'}}})];
  a.context.localStorage.setItem=()=>{throw new Error('QuotaExceededError')};a.run(`importData($('imp'))`);assert.deepEqual(a.json('S'),before);
  a.context.remote={ver:9,data:{p:{},recipes:{remote:{id:'remote',title:'다른 기기의 사진'}}}};
  assert.equal(a.run('adopt(remote)'),false);assert.deepEqual(a.json('S'),before);assert.notEqual(a.run('SY.ver'),9);
});
test('a full storage clears a stale merge baseline rather than keeping the wrong synced version',()=>{
  const a=app();a.memory.set('my-gagyebu-base','outdated');a.context.localStorage.setItem=()=>{throw new Error('QuotaExceededError')};
  a.run('setBase("new baseline")');assert.equal(a.memory.has('my-gagyebu-base'),false);
});
test('recipes without a category stay uncategorized without rewriting legacy records',()=>{
  const initial={p:{},recipes:{old:{id:'old',title:'예전 레시피',tags:'간단 요리'}}},a=app(initial);
  a.run(`openApp('recipes');recipeCategory='uncategorized'`);assert.equal(a.run('recipeResults().length'),1);
  assert.equal(a.run(`recipeCategoryOf(S.recipes.old)`),'');assert.equal(Object.hasOwn(initial.recipes.old,'category'),false);
  assert.ok(a.run('recipePage()').includes('미분류'));a.run(`openRecipeSheet('old')`);assert.equal(a.el('rc-category').value,'');
});
test('custom recipe categories survive reload and become reusable escaped choices',()=>{
  const a=app(),id=addRecipe(a),name='나만의 <요리> & 음료';a.run(`openRecipeSheet('${id}')`);a.el('rc-category').value='  '+name+'  ';a.run('saveRecipe()');
  const b=app(a.json('S'));assert.equal(b.run(`S.recipes['${id}'].category`),name);b.run(`openRecipeSheet('${id}')`);
  assert.equal(b.el('rc-category').value,name);assert.ok(b.el('rcCategoryOptions').innerHTML.includes('나만의 &lt;요리&gt; &amp; 음료'));
  assert.equal(b.json('recipeCategories()').filter(value=>value===name).length,1);
  assert.throws(()=>b.run(`prepareRecipeData({recipes:{bad:{id:'bad',title:'x',category:[]}}})`));
});
test('category filters combine with search, tags and favorites and distinguish custom names from special options',()=>{
  const a=app(),food=addRecipe(a),drink=addRecipe(a,'하이볼'),custom=addRecipe(a,'실험 음료');
  a.run(`S.recipes['${food}'].category='한식';S.recipes['${drink}'].category='칵테일';S.recipes['${drink}'].favorite=true;S.recipes['${custom}'].category='uncategorized';recipeCategory='category:칵테일'`);
  assert.deepEqual(a.json('recipeResults().map(item=>item.id)'),[drink]);a.run(`recipeTag='간단 요리';recipeQuery='칵테일';openApp('recipes','favorites')`);assert.equal(a.run('recipeResults().length'),1);
  a.run(`recipeQuery='볶음밥'`);assert.equal(a.run('recipeResults().length'),0);a.run(`recipeQuery='';recipeTag='';openApp('recipes');recipeCategory='category:uncategorized'`);
  assert.deepEqual(a.json('recipeResults().map(item=>item.id)'),[custom]);a.run(`recipeCategory='uncategorized'`);assert.equal(a.run('recipeResults().length'),0);
  a.run(`delete S.recipes['${food}'].category`);assert.deepEqual(a.json('recipeResults().map(item=>item.id)'),[food]);
});
test('category-only changes are protected on Back and roll back if storage is full',()=>{
  const a=app(),id=addRecipe(a);a.run(`openRecipeSheet('${id}')`);a.el('rc-category').value='한식';a.context.confirm=()=>false;a.run('window.history.back()');
  assert.equal(a.el('recipeSheet').classList.contains('show'),true);assert.equal(a.el('rc-category').value,'한식');
  a.context.localStorage.setItem=()=>{throw new Error('QuotaExceededError')};a.run('saveRecipe()');assert.equal(a.run(`S.recipes['${id}'].category`),'');assert.equal(a.el('rc-category').value,'한식');
});
test('recipe sync preserves category edits alongside notes from another device',()=>{
  const a=app(),id=addRecipe(a),base=a.json('S'),left=clone(base),right=clone(base);
  left.recipes[id].category='퓨전';right.recipes[id].notes='두 기기의 수정';a.context.base=base;a.context.left=left;a.context.right=right;
  const merged=a.json('merge3(JSON.stringify(base),left,right)'),b=app(merged);assert.equal(b.run(`S.recipes['${id}'].category`),'퓨전');assert.equal(b.run(`S.recipes['${id}'].notes`),'두 기기의 수정');
});

function addTask(a,title='병원 예약',date='',time=''){
  a.run(`openApp('tasks','inbox');openTaskSheet()`);a.el('tkTitle').value=title;a.el('tkDate').value=date;a.el('tkTime').value=time;a.el('tkNotes').value='준비물과 장소 메모';a.run('saveTask()');return a.run('taskItems().at(-1).id');
}
test('task migration preserves legacy apps and app routes only expose task navigation',()=>{
  const a=app();addPurchase(a);addRecipe(a);const ledger=a.json('S.p'),recipes=a.json('S.recipes');
  assert.deepEqual(a.json('S.tasks'),{});a.run(`openApp('tasks')`);
  assert.equal(a.el('taskNav').hidden,false);assert.equal(a.el('taskHeader').hidden,false);assert.equal(a.el('recipeNav').hidden,true);assert.equal(a.el('fridgeNav').hidden,true);assert.equal(a.el('ledgerNav').hidden,true);
  assert.deepEqual(a.json('S.p'),ledger);assert.deepEqual(a.json('S.recipes'),recipes);
  a.run(`window.location.hash='#tasks/calendar';restoreAppRoute()`);assert.equal(a.run('currentAppRoute.section'),'calendar');
  a.run(`openApp('tasks','invalid')`);assert.equal(a.run('currentAppRoute.section'),'today');
});
test('undated notes and timed events save, edit, complete, undo and reload',()=>{
  const a=app(),note=addTask(a),event=addTask(a,'약속','2026-11-20','14:30');
  assert.equal(a.run('currentAppRoute.section'),'calendar');assert.equal(a.run('taskDay'),'2026-11-20');
  a.run(`openTaskSheet('${note}')`);a.el('tkDate').value='2026-11-21';a.el('tkImportant').checked=true;a.run('saveTask()');
  assert.equal(a.run(`S.tasks['${note}'].important`),true);a.run(`toggleTask('${event}')`);assert.equal(a.run(`S.tasks['${event}'].done`),true);
  a.run(`openApp('tasks','done')`);assert.ok(a.el('view').innerHTML.includes('약속'));a.run(`toggleTask('${event}')`);assert.equal(a.run(`S.tasks['${event}'].done`),false);
  const b=app(a.json('S'));assert.equal(b.run(`S.tasks['${event}'].time`),'14:30');assert.equal(b.run(`S.tasks['${note}'].date`),'2026-11-21');
  b.run(`openTaskSheet('${event}')`);b.el('tkDate').value='';b.run('syncTaskTime();saveTask()');assert.equal(b.run(`S.tasks['${event}'].time`),'');assert.equal(b.run('currentAppRoute.section'),'inbox');
});
test('home task alerts exclude completed, undated and future work and open the today page',()=>{
  const a=app(),date=a.run('today()'),id=addTask(a,'오늘 일',date);addTask(a,'밀린 일','2020-01-01');addTask(a,'언젠가');addTask(a,'먼 미래','2999-01-01');
  const alerts=a.json('taskPlatformAlerts()');assert.equal(alerts.length,1);assert.ok(alerts[0].text.includes('기한 지난 일 1건'));assert.ok(alerts[0].text.includes('오늘 할 일·일정 1건'));
  a.run(`toggleTask('${id}');openPlatform()`);assert.ok(!a.el('view').innerHTML.includes('오늘 할 일·일정 1건'));assert.ok(a.el('view').innerHTML.includes('platformTaskAlert'));
});
test('calendar handles leap years, month boundaries and task counts independently of ledger periods',()=>{
  const a=app();addTask(a,'윤일','2024-02-29');a.run(`openApp('tasks','calendar')`);
  assert.equal((a.run('taskCalendar()').match(/aria-label="2024-02-\d{2}/g)||[]).length,29);
  assert.ok(a.run('taskCalendar()').includes('미완료 1건'));a.run('moveTaskMonth(1)');assert.equal(a.run('taskDay'),'2024-03-01');a.run(`taskMonth='2026-12';moveTaskMonth(1)`);assert.equal(a.run('taskMonth'),'2027-01');
  const before=a.json('S.tasks');a.run('movePeriod(-1)');assert.deepEqual(a.json('S.tasks'),before);
});
test('task drafts are protected on app navigation and native Back and deleted tasks cannot reopen',()=>{
  const a=app(),id=addTask(a);a.run(`openApp('tasks','inbox');openTaskSheet('${id}')`);a.el('tkNotes').value='아직 저장 안 함';a.context.confirm=()=>false;
  a.run('openPlatform()');assert.equal(a.run('activeApp'),'tasks');a.run('window.history.back()');assert.equal(a.el('taskSheet').classList.contains('show'),true);assert.equal(a.el('tkNotes').value,'아직 저장 안 함');
  a.context.confirm=()=>true;a.run('window.history.back()');assert.equal(a.el('taskSheet').classList.contains('show'),false);a.run('window.history.forward()');assert.equal(a.run('taskEditId'),id);
  a.run('deleteTask();window.history.forward()');assert.equal(a.el('taskSheet').classList.contains('show'),false);assert.equal(a.run('taskItems().length'),0);
});
test('task save, completion and deletion failures roll back memory and retain drafts',()=>{
  const a=app(),id=addTask(a),before=a.json('S.tasks');a.run(`openTaskSheet('${id}')`);a.el('tkTitle').value='실패할 수정';a.context.localStorage.setItem=()=>{throw Error('full')};
  a.run('saveTask()');assert.deepEqual(a.json('S.tasks'),before);assert.equal(a.el('taskSheet').classList.contains('show'),true);assert.equal(a.el('tkTitle').value,'실패할 수정');
  a.run(`toggleTask('${id}');deleteTask()`);assert.deepEqual(a.json('S.tasks'),before);
});
test('task validation rejects impossible dates, unsafe ids and malformed fields and escapes notes',()=>{
  const a=app();assert.equal(a.run(`validTaskDate('2024-02-29')`),true);assert.equal(a.run(`validTaskDate('2026-02-29')`),false);
  for(const tasks of [[],{x:{id:'x',title:'x',date:'2026-02-30'}},{x:{id:'x',title:'x',time:'09:00'}},{x:{id:'x',title:'x',date:'2026-11-01',time:'24:00'}},{x:{id:'x',title:'x',done:'false'}},{x:{id:'x',title:'x',notes:[]}},JSON.parse('{"__proto__":{"id":"__proto__","title":"x"}}')]){
    a.context.invalid={p:{},tasks};assert.throws(()=>a.run('prepareFoodData(invalid)'));
  }
  const id=addTask(a,'<img src=x onerror=alert(1)>');a.run(`S.tasks['${id}'].notes='<script>bad</script>';openApp('tasks','inbox')`);
  assert.ok(!a.el('view').innerHTML.includes('<script>'));assert.ok(a.el('view').innerHTML.includes('&lt;img'));a.run(`taskQuery='준비물'`);assert.equal(a.run(`taskItems().filter(taskMatches).length`),0);
});
test('task sync merges distinct additions, completion with remote notes and intentional deletion',()=>{
  const a=app(),id=addTask(a);addPurchase(a);const base=a.json('S'),left=clone(base),right=clone(base);
  left.tasks[id].done=true;left.tasks[id].completedAt='2026-11-16T10:00:00Z';right.tasks[id].notes='다른 기기 메모';right.tasks.remote={id:'remote',title:'새로운 일'};
  a.context.base=base;a.context.left=left;a.context.right=right;const merged=a.json('merge3(JSON.stringify(base),left,right)');assert.equal(merged.tasks[id].done,true);assert.equal(merged.tasks[id].notes,'다른 기기 메모');assert.equal(Object.keys(merged.tasks).length,2);assert.deepEqual(merged.p,base.p);
  assert.equal(app(merged).run('taskItems().length'),2);delete left.tasks[id];right.tasks[id]=clone(base.tasks[id]);assert.equal(a.run(`merge3(JSON.stringify(base),left,right).tasks['${id}']`),undefined);
});
test('task backup import round trips and legacy backup explicitly replaces all app records',()=>{
  const a=app(),id=addTask(a),saved=JSON.stringify(a.json('S'));a.context.FileReader=class{readAsText(file){this.result=file;this.onload()}};
  a.run('S.tasks={}');a.el('imp').files=[saved];a.run(`importData($('imp'))`);assert.equal(a.run(`S.tasks['${id}'].title`),'병원 예약');
  a.el('imp').files=[JSON.stringify({p:{}})];a.run(`importData($('imp'))`);assert.deepEqual(a.json('S.tasks'),{});
});
