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
  const location={hash:''},history={pushState(_state,_title,hash){location.hash=hash},replaceState(_state,_title,hash){location.hash=hash}};
  const context=vm.createContext({console,Date,crypto:webcrypto,Blob,URL,setTimeout(){},clearTimeout(){},alert:m=>alerts.push(m),confirm:()=>true,navigator:{},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},document:{body:element('body'),getElementById:element,addEventListener(){},querySelectorAll:selector=>selector==='#fFoodW input'?checks:selector==='#fFoodW input:checked'?checks.filter(c=>c.checked):[]},window:{location,history,matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}}});
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
  const a=app();a.run('openSharedSettings()');assert.ok(a.el('view').innerHTML.includes('가계부·냉장고 백업'));assert.ok(!a.el('view').innerHTML.includes('id="sStart"'));
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
test('platform summaries show current budget and real pending purchase counts',()=>{
  const a=app();addPurchase(a);a.run('cur().start=100000;movePeriod(-1);openPlatform()');const page=a.run('platformPage()');assert.ok(page.includes('58,000원'));assert.ok(page.includes('장보기 1건'));assert.ok(page.includes('등록 대기 <b>1건</b>'));
});
test('cancelling navigation preserves unsaved product inputs and the current app',()=>{
  const a=app();a.run('openApp("fridge");openFoodSheet()');a.el('fdName').value='아직 입력 중';a.context.confirm=()=>false;
  const hash=a.run('window.location.hash');a.run('openPlatform()');assert.equal(a.run('activeApp'),'fridge');assert.equal(a.run('window.location.hash'),hash);assert.equal(a.el('fdName').value,'아직 입력 중');assert.equal(a.el('foodSheet').classList.contains('show'),true);
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
test('direct registration, same-name batches, opening, consumption and restoration',()=>{
  const a=app();a.run('openFoodSheet()');const id=addFood(a);a.run('openFoodSheet()');addFood(a);assert.equal(a.run('foodItems().length'),2);
  a.run(`changeFoodState('${id}','opened')`);assert.equal(a.run(`S.foods['${id}'].openedAt`),a.run('today()'));
  a.run(`changeFoodState('${id}','consumed')`);assert.equal(a.run(`S.foods['${id}'].status`),'consumed');
  a.run(`changeFoodState('${id}','active')`);assert.equal(a.run(`S.foods['${id}'].status`),'active');assert.equal(a.run(`S.foods['${id}'].finishedAt`),undefined);
  a.run(`changeFoodState('${id}','discarded')`);assert.equal(a.run(`S.foods['${id}'].status`),'discarded');
});
test('missing product name, invalid quantity and future opening date do not save',()=>{
  const a=app();a.run('openFoodSheet();saveFood()');assert.equal(a.run('foodItems().length'),0);
  a.el('fdName').value='우유';a.el('fdQty').value='0';a.run('saveFood()');assert.equal(a.run('foodItems().length'),0);
  a.el('fdQty').value='1';a.el('fdOpened').checked=true;a.el('fdOpenedAt').value='2999-01-01';a.run('saveFood()');assert.equal(a.run('foodItems().length'),0);
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
test('backup validation rejects unsafe inventory IDs and malformed inventory',()=>{
  const a=app();assert.throws(()=>a.run('prepareFoodData({p:{},foods:[]})'));
  assert.throws(()=>a.run(`prepareFoodData({p:{},foods:{"bad'":{id:"bad'",name:'x',store:'chilled',status:'active',quantity:1}}})`));
});
test('three-way sync combines distinct products and distinct edits to one product',()=>{
  const a=app();a.run('openFoodSheet()');const id=addFood(a),base=a.json('S'),l=clone(base),r=clone(base);
  l.foods[id].openedAt='2026-11-13';r.foods[id].quantity=2;r.foods.other={...r.foods[id],id:'other',name:'계란'};
  a.context.base=base;a.context.left=l;a.context.right=r;
  const result=a.json('merge3(JSON.stringify(base),left,right)');assert.equal(Object.keys(result.foods).length,2);assert.equal(result.foods[id].openedAt,'2026-11-13');assert.equal(result.foods[id].quantity,2);
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
  current={ver:1,data:{p:{}}};assert.equal(vm.runInContext('handle(SECRET,null,0).ver',d),1);
});
