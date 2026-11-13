// 설치된 Chrome/Edge와 Node.js로 검증. --live는 공개 사이트를 새 임시 프로필에서 점검한다.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const browserPath=process.env.BROWSER_PATH||[
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome','/usr/bin/chromium'
].find(p=>fs.existsSync(p));
if(!browserPath)throw new Error('Set BROWSER_PATH to an installed Chromium browser.');
const allowed=new Set(['index.html','fridge.js','fridge.css','platform.js','platform.css','sw.js','manifest.webmanifest','icon-192.png','icon-512.png','app-icon.svg','app-icon-192.png','app-icon-512.png','apple-touch-icon.png','favicon-32.png']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!allowed.has(name)){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-cache'});
  res.end(fs.readFileSync(path.join(root,name)));
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,label){for(let n=0;n<100;n++){if(await fn())return;await delay(100)}throw new Error('Timed out: '+label)}
let browser,socket,profile;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=process.argv.includes('--live')?'https://mano-lee.github.io/gagyebu':`http://127.0.0.1:${server.address().port}`;
  profile=fs.mkdtempSync(path.join(os.tmpdir(),'gagyebu-fridge-qa-'));
  browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr='';browser.stderr.on('data',data=>{stderr+=data});
  let spawnError;browser.on('error',error=>{spawnError=error});
  await waitFor(()=>{if(spawnError)throw spawnError;return /DevTools listening on (ws:\/\/\S+)/.test(stderr)},'Chrome debugging endpoint');
  console.log('Browser launched; connecting to isolated test session.');
  socket=new WebSocket(stderr.match(/DevTools listening on (ws:\/\/\S+)/)[1]);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Browser WebSocket connection timed out')),10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Browser WebSocket connection failed'))},{once:true})});
  const pending=new Map(),errors=[];let sequence=0,sessionId;
  socket.addEventListener('message',event=>{
    const m=JSON.parse(event.data);
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if(m.id&&pending.has(m.id)){const {resolve,reject,timer}=pending.get(m.id);clearTimeout(timer);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result)}
  });
  function send(method,params={},session=true){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser command timed out: '+method))},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(session&&sessionId?{sessionId}:{})}))})}
  const {targetId}=await send('Target.createTarget',{url:'about:blank'},false);
  ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},false));
  for(const domain of ['Runtime','Page','Network'])await send(domain+'.enable');
  const evaluate=async expression=>{
    const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  };
  if(process.argv.includes('--render-icons')){
    for(const [size,name] of [[512,'app-icon-512.png'],[192,'app-icon-192.png'],[180,'apple-touch-icon.png'],[32,'favicon-32.png']]){
      await send('Emulation.setDeviceMetricsOverride',{width:size,height:size,deviceScaleFactor:1,mobile:false});
      await send('Page.navigate',{url:origin+'/app-icon.svg'});
      await waitFor(()=>evaluate('document.documentElement.tagName.toLowerCase()==="svg" && document.readyState==="complete"'),'icon SVG load');
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const data=Buffer.from(shot.data,'base64');assert.equal(data.readUInt32BE(16),size);assert.equal(data.readUInt32BE(20),size);
      fs.writeFileSync(path.join(root,name),data);console.log(`Rendered ${name}: ${size}×${size}`);
    }
    await send('Browser.close',{},false).catch(()=>{});return;
  }
  const ready=()=>evaluate('typeof S!=="undefined" && !!document.getElementById("foodNavCount") && document.getElementById("view").children.length>0');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:origin+'/'});await waitFor(ready,'app ready');
  console.log('App loaded; checking purchase and registration flow.');
  const out=path.join(root,'.qa-preview');fs.mkdirSync(out,{recursive:true});
  assert.equal(await evaluate('activeApp'),'platform');
  assert.equal(await evaluate('document.querySelector(".platform-logo").complete && document.querySelector(".platform-logo").naturalWidth>0'),true);
  assert.equal(await evaluate(`fetch('manifest.webmanifest').then(r=>r.json()).then(m=>m.name==='내 생활'&&m.icons.every(i=>i.src.startsWith('app-icon-')))`),true);
  assert.equal(await evaluate('getComputedStyle($("appShell")).display'),'none');
  assert.equal(await evaluate('document.querySelectorAll(".platform-apps .app-launch").length===PLATFORM_APPS.length'),true);
  assert.equal(await evaluate('document.querySelector(".app-summary,.app-metric,.app-description,.app-enter")===null'),true);
  assert.equal(await evaluate('document.querySelector(".platform-alerts")===null'),true);
  for(const [width,height,name] of [[390,844,'platform-mobile'],[360,800,'platform-small-mobile'],[1280,900,'platform-desktop']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<960});
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),`Platform overflow at ${width}px`);
    assert.ok(await evaluate('$("t-fridge").getBoundingClientRect().left>$("t-ledger").getBoundingClientRect().right'),`App icons must share a row at ${width}px`);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('$("t-ledger").click()');
  assert.equal(await evaluate('activeApp'),'ledger');
  assert.equal(await evaluate('getComputedStyle($("fridgeNav")).display'),'none');
  await evaluate('window.__alerts=[];window.alert=m=>__alerts.push(m);window.confirm=()=>true');
  await evaluate(`document.getElementById('addRecord').click();$('fAmt').value='42000';$('fMemo').value='마트(우유, 계란 등)';document.querySelector('#fFoodW input[value=chilled]').click();document.querySelector('#fFoodW input[value=pantry]').click();document.querySelector('#sheet .btn').click()`);
  assert.equal(await evaluate('pendingFoodTasks().length'),1);
  assert.equal(await evaluate('foodItems().length'),0);
  assert.equal(await evaluate('calc(S.cur).spent'),42000);
  console.log('Checking native Back for ledger records, planned expenses and fixed expenses.');
  const ledgerTxId=await evaluate('cur().tx[0].id');
  await waitFor(()=>evaluate('!sheetHistoryBackPending'),'purchase history settled');
  await evaluate(`openPlatform();openApp('ledger','list');selDay=today();render()`);
  const ledgerView=await evaluate('[activeApp,tab,S.cur,selDay]');
  for(const type of ['out','in','plan']){
    await evaluate(`openSheet();setType('${type}');$('fAmt').value='5000';window.history.back()`);
    await waitFor(()=>evaluate(`!$('sheet').classList.contains('show')`),'back closes '+type+' entry');
    assert.deepEqual(await evaluate('[activeApp,tab,S.cur,selDay]'),ledgerView);
    assert.equal(await evaluate('cur().tx.length'),1);
  }
  await evaluate(`openSheet(${ledgerTxId});$('fMemo').value='저장 전 가계부';$('fAmt').value='42,000 + 1,000';window.__ledgerBackPrompts=0;window.confirm=()=>{window.__ledgerBackPrompts++;return false};window.history.back()`);
  await waitFor(()=>evaluate(`__ledgerBackPrompts===1 && window.history.state?.appSheet?.kind==='transaction'`),'cancel ledger back');
  assert.equal(await evaluate(`$('sheet').classList.contains('show') && $('fMemo').value==='저장 전 가계부' && $('fAmt').value==='42,000 + 1,000'`),true);
  assert.equal(await evaluate('cur().tx[0].amt'),42000);
  await evaluate('openSharedSettings()');assert.equal(await evaluate('activeApp'),'ledger');
  await evaluate('window.confirm=()=>true;window.history.back()');
  await waitFor(()=>evaluate(`!$('sheet').classList.contains('show')`),'discard ledger edit');
  assert.deepEqual(await evaluate('[activeApp,tab,S.cur,selDay]'),ledgerView);
  await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'next back leaves ledger');
  for(const action of ['saveTx()','closeSheet()']){
    await evaluate(`openApp('ledger','list');openSheet(${ledgerTxId});${action}`);
    await waitFor(()=>evaluate('!sheetHistoryBackPending'),'ledger close history settled');
    await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'back after ledger '+action);
  }
  // Close and immediately reopen before the asynchronous native back event arrives.
  await evaluate(`openApp('ledger','list');openSheet(${ledgerTxId});closeSheet();openSheet(${ledgerTxId})`);
  await waitFor(()=>evaluate(`!sheetHistoryBackPending && window.history.state?.appSheet?.id===${ledgerTxId}`),'immediate ledger reopen');
  await evaluate('window.history.back()');await waitFor(()=>evaluate(`!$('sheet').classList.contains('show')`),'back after immediate reopen');
  assert.equal(await evaluate('activeApp'),'ledger');
  await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'leave ledger after reopen');
  await evaluate(`openApp('ledger','set');openFx();$('xName').value='테스트 고정지출';$('xAmt').value='1000';$('xDay').value='5';window.__fixedBackPrompts=0;window.confirm=()=>{window.__fixedBackPrompts++;return false};window.history.back()`);
  await waitFor(()=>evaluate(`__fixedBackPrompts===1 && window.history.state?.appSheet?.kind==='fixed'`),'cancel fixed expense back');
  assert.equal(await evaluate(`$('fxSheet').classList.contains('show') && $('xName').value==='테스트 고정지출'`),true);
  await evaluate('window.confirm=()=>true;window.history.back()');
  await waitFor(()=>evaluate(`!$('fxSheet').classList.contains('show')`),'back closes fixed expense');
  assert.deepEqual(await evaluate('[activeApp,tab,cur().fixed.length]'),['ledger','set',0]);
  await evaluate(`openFx();$('xName').value='테스트 고정지출';$('xAmt').value='1000';$('xDay').value='5';saveFx()`);
  await waitFor(()=>evaluate('!sheetHistoryBackPending'),'fixed save history settled');
  await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'back after fixed save');
  await evaluate(`openApp('ledger','set');openFx(0);window.history.back()`);
  await waitFor(()=>evaluate(`!$('fxSheet').classList.contains('show')`),'back closes fixed editor');
  assert.deepEqual(await evaluate('[activeApp,tab]'),['ledger','set']);
  await evaluate('window.history.forward()');await waitFor(()=>evaluate(`$('fxSheet').classList.contains('show')`),'forward restores fixed editor');
  assert.equal(await evaluate(`$('xName').value`),'테스트 고정지출');
  await evaluate('delFixed()');await waitFor(()=>evaluate('!sheetHistoryBackPending'),'fixed deletion history settled');
  await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'back after fixed delete');
  await evaluate(`openApp('ledger');openSheet();setType('plan');$('fAmt').value='8000';$('fMemo').value='테스트 예정';saveTx()`);
  await waitFor(()=>evaluate('!sheetHistoryBackPending'),'plan save history settled');
  const planId=await evaluate('cur().plan[0].id');
  await evaluate(`confirmPlan(${planId});window.history.back()`);
  await waitFor(()=>evaluate(`!$('sheet').classList.contains('show')`),'back closes planned confirmation');
  assert.equal(await evaluate('cur().plan.length'),1);assert.equal(await evaluate('cur().tx.length'),1);
  await evaluate('window.history.forward()');await waitFor(()=>evaluate(`$('sheet').classList.contains('show')`),'forward restores planned confirmation');
  assert.equal(await evaluate('fromPlan'),planId);assert.equal(await evaluate(`$('sTitle').textContent`),'예정 지출 확정');
  await evaluate(`closeSheet();openSheet(${planId});delTx()`);
  await waitFor(()=>evaluate('!sheetHistoryBackPending'),'plan deletion history settled');
  assert.equal(await evaluate('cur().plan.length'),0);
  await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'back after record delete');
  await evaluate(`openApp('ledger')`);
  await evaluate(`$('backToPlatform').click()`);
  assert.equal(await evaluate('document.querySelector("#platformPendingAlert").textContent.includes("1건")'),true);
  assert.ok(await evaluate('document.querySelector(".platform-alerts").getBoundingClientRect().bottom<=document.querySelector(".platform-apps").getBoundingClientRect().top'),'App alerts must appear above icons');
  const alertShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,'platform-notification.png'),Buffer.from(alertShot.data,'base64'));
  await evaluate(`$('platformPendingAlert').click();document.querySelector('.food-task .food-actions .btn').click()`);
  assert.equal(await evaluate('getComputedStyle($("ledgerHeader")).display'),'none');
  assert.equal(await evaluate('getComputedStyle($("ledgerNav")).display'),'none');
  assert.equal(await evaluate('foodTaskId'),await evaluate('cur().tx[0].id'));
  await evaluate(`$('fdName').value='우유';$('fdExpiry').value=today();$('fdSave').click()`);
  assert.equal(await evaluate('foodItems().length'),1);
  assert.equal(await evaluate('pendingFoodTasks().length'),1);
  await evaluate(`document.querySelector('#foodSheet form button:last-child').click();document.querySelector('.food-task .food-actions .btn').click();$('fdName').value='계란';$('fdQty').value='10';$('fdUnit').value='개';$('fdSave').click();$('fdFinish').click()`);
  assert.equal(await evaluate('foodItems().length'),2);
  assert.equal(await evaluate('pendingFoodTasks().length'),0);
  assert.equal(await evaluate('cur().tx.length'),1);
  assert.equal(await evaluate('document.body.textContent.includes("개봉")'),false);
  assert.equal(await evaluate('document.querySelector(".food-grid").textContent.includes("마트")'),false);
  assert.equal(await evaluate('document.querySelector(".food-grid").textContent.includes("42,000")'),false);
  await evaluate(`document.querySelector('.food-grid .food-row-main').focus();document.querySelector('.food-grid .food-row-main').click()`);
  assert.equal(await evaluate(`$('foodSheet').classList.contains('show')`),true);
  assert.equal(await evaluate(`$('sheet').classList.contains('show')`),false);
  assert.equal(await evaluate(`$('fdTitle').textContent`),'식재료 수정');
  assert.equal(await evaluate(`$('fdName').value`),'우유');
  assert.equal(await evaluate(`$('fdExtra').open`),false);
  await evaluate(`document.querySelector('#fdExtra summary').click()`);
  assert.equal(await evaluate(`$('fdExtraInfo').textContent.includes('마트')`),true);
  assert.equal(await evaluate(`$('fdExtraInfo').textContent.includes('42,000원')`),true);
  assert.equal(await evaluate(`$('sheet').classList.contains('show')`),false);
  await evaluate(`$('fdStore').value='frozen';$('fdSave').click()`);
  assert.equal(await evaluate('foodItems().filter(f=>f.store===\'frozen\').length'),1);
  await evaluate(`openFoodSheet();$('fdName').value='양파';$('fdStore').value='pantry';$('fdExpiry').value=new Date(Date.parse(today()+'T00:00:00Z')-864e5).toISOString().slice(0,10);$('fdSave').click();openApp('fridge')`);
  assert.equal(await evaluate(`$('storage-frozen').textContent.includes('임박 1')`),true);
  assert.equal(await evaluate(`$('storage-chilled').textContent.includes('기한 미입력 1')`),true);
  assert.equal(await evaluate(`$('storage-pantry').textContent.includes('기한 지남 1')`),true);
  await evaluate('openPlatform()');
  assert.equal(await evaluate('$("platformSoonAlert").textContent.includes("2개 품목")'),true);
  await evaluate('$("platformSoonAlert").click()');assert.equal(await evaluate('foodView'),'soon');assert.equal(await evaluate('document.querySelectorAll(".food-grid article").length'),2);
  await evaluate('openApp("fridge")');
  for(const store of ['chilled','frozen','pantry']){
    await evaluate(`$('storage-${store}').click()`);
    assert.equal(await evaluate('foodStore'),store);
    assert.equal(await evaluate('document.querySelectorAll(".food-grid article").length'),1);
    assert.equal(await evaluate(`$('storage-${store}').getAttribute('aria-pressed')`),'true');
    assert.equal(await evaluate('document.querySelector(".storage-overview-heading").textContent.includes("총 3개 품목")'),true);
  }
  const eggId=await evaluate(`foodItems().find(f=>f.name==='계란').id`),milkId=await evaluate(`foodItems().find(f=>f.name==='우유').id`),onionId=await evaluate(`foodItems().find(f=>f.name==='양파').id`);
  // A phone Back uses the same native history transition as browser Back.
  await waitFor(()=>evaluate('!sheetHistoryBackPending'),'editor history settled');
  await evaluate(`openPlatform();openApp('fridge');setFoodStore('chilled');filterFoods('계란');document.querySelector('[data-food-id="${eggId}"] .food-row-main').click()`);
  await evaluate('window.history.back()');
  await waitFor(()=>evaluate(`!$('foodSheet').classList.contains('show')`),'back closes only ingredient editor');
  assert.deepEqual(await evaluate('[activeApp,foodStore,foodQuery,window.location.hash]'),['fridge','chilled','계란','#fridge/active']);
  await evaluate('window.history.forward()');
  await waitFor(()=>evaluate(`$('foodSheet').classList.contains('show')`),'forward reopens ingredient editor');
  assert.equal(await evaluate('foodEditId'),eggId);
  await evaluate(`$('fdName').value='저장 전 이름';window.__backPrompts=0;window.confirm=()=>{window.__backPrompts++;return false};window.history.back()`);
  await waitFor(()=>evaluate(`window.__backPrompts===1 && window.history.state?.appSheet && $('fdName').value==='저장 전 이름'`),'cancel back retains unsaved input');
  assert.equal(await evaluate(`$('foodSheet').classList.contains('show')`),true);
  await evaluate('window.confirm=()=>true;window.history.back()');
  await waitFor(()=>evaluate(`!$('foodSheet').classList.contains('show')`),'confirmed back discards edits');
  assert.equal(await evaluate(`S.foods['${eggId}'].name`),'계란');
  await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'next back leaves fridge');
  await evaluate(`openApp('fridge');editFood('${eggId}');$('fdSave').click()`);
  await waitFor(()=>evaluate('!sheetHistoryBackPending'),'save removes editor step');
  await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'back after save leaves fridge directly');
  await evaluate(`openApp('fridge');editFood('${eggId}');closeFoodSheet()`);
  await waitFor(()=>evaluate('!sheetHistoryBackPending'),'close removes editor step');
  await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'back after close leaves fridge directly');
  await evaluate(`openApp('fridge')`);
  await evaluate(`$('storage-chilled').click();document.querySelector('[data-food-id="${eggId}"] .food-quantity').click()`);
  assert.equal(await evaluate('foodEditId'),eggId);assert.equal(await evaluate(`$('sheet').classList.contains('show')`),false);
  assert.equal(await evaluate(`$('fdExtra').open`),false);
  await evaluate(`closeFoodSheet();document.querySelector('[data-food-id="${eggId}"] .food-expiry').click()`);
  assert.equal(await evaluate('foodEditId'),eggId);assert.equal(await evaluate(`$('sheet').classList.contains('show')`),false);
  await evaluate('closeFoodSheet()');
  await evaluate(`$('storage-chilled').click();$('use-${eggId}').click()`);
  assert.equal(await evaluate(`$('foodSheet').classList.contains('show')`),false);
  assert.equal(await evaluate(`$('sheet').classList.contains('show')`),false);
  assert.equal(await evaluate(`foodRemaining(S.foods['${eggId}'])`),9);
  assert.equal(await evaluate(`S.foods['${eggId}'].initialQuantity`),10);
  assert.equal(await evaluate(`$('storage-chilled').querySelector('.storage-count strong').textContent`),'1');
  await evaluate(`$('use-${eggId}').click();$('undoFoodUse').click()`);
  assert.equal(await evaluate(`foodRemaining(S.foods['${eggId}'])`),9);
  await evaluate(`$('storage-frozen').click();$('use-${milkId}').click()`);
  assert.equal(await evaluate(`foodRemaining(S.foods['${milkId}'])`),0);
  assert.equal(await evaluate(`S.foods['${milkId}'].status`),'consumed');
  assert.equal(await evaluate('document.querySelectorAll(".food-grid article").length'),0);
  assert.equal(await evaluate(`$('storage-frozen').querySelector('.storage-count strong').textContent`),'0');
  await evaluate(`$('undoFoodUse').click()`);
  assert.equal(await evaluate(`foodRemaining(S.foods['${milkId}'])`),1);
  await evaluate(`$('use-${milkId}').click();openApp('fridge','history')`);
  assert.equal(await evaluate('document.querySelector(".food-quantity strong").textContent'),'0개');
  await evaluate(`document.querySelector('.food-grid .food-restore').click();editFood('${onionId}');$('fdUnit').value='통';$('fdQty').value='2';$('fdSave').click();selectFoodStorage('pantry')`);
  assert.equal(await evaluate(`$('use-${onionId}').textContent.includes('1통 사용')`),true);
  await evaluate(`$('use-${onionId}').click()`);
  assert.equal(await evaluate(`foodRemaining(S.foods['${onionId}'])`),1);
  await evaluate('dismissFoodUse()');
  await evaluate(`openApp('fridge')`);
  for(const [width,height,name] of [[390,844,'mobile'],[360,800,'small-mobile'],[1280,900,'desktop']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<960});
    await delay(100);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),`Page overflow at ${width}px`);
    assert.ok(await evaluate(`$('storage-pantry').getBoundingClientRect().left > $('storage-frozen').getBoundingClientRect().right`),`Pantry must remain to the right at ${width}px`);
    assert.ok(await evaluate(`['#storage-frozen','#storage-chilled','#storage-pantry .pantry-label'].every(selector=>{const el=document.querySelector(selector);return el.scrollWidth<=el.clientWidth})`),`Storage text overflow at ${width}px`);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));
    fs.writeFileSync(path.join(out,'fridge-overview-'+name+'.png'),Buffer.from(shot.data,'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  await evaluate(`selectFoodStorage('chilled');$('foodList').scrollIntoView({block:'start',behavior:'instant'})`);
  assert.ok(await evaluate(`document.querySelector('.food-quantity').scrollWidth <= document.querySelector('.food-quantity').clientWidth`),'Quantity control overflow');
  const quantityShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'remaining-stock-mobile.png'),Buffer.from(quantityShot.data,'base64'));
  await evaluate(`document.querySelector('.food-heading .btn').click()`);
  await evaluate(`$('fdBought').value='2026-01-31';$('fdBought').dispatchEvent(new Event('input',{bubbles:true}))`);
  for(const [preset,expected] of [['1d','2026-02-01'],['1w','2026-02-07'],['1m','2026-02-28'],['3m','2026-04-30'],['6m','2026-07-31']]){
    await evaluate(`resetFoodExpiry();document.querySelector('[data-preset="${preset}"]').click()`);
    assert.equal(await evaluate(`$('fdExpiry').value`),expected);
    assert.equal(await evaluate(`document.querySelector('[data-preset="${preset}"]').dataset.count`),'1');
    assert.equal(await evaluate('foodItems().length'),3);
  }
  await evaluate(`resetFoodExpiry();$('fdBought').value='2024-01-31';$('fdBought').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-preset="1m"]').click()`);
  assert.equal(await evaluate(`$('fdExpiry').value`),'2024-02-29');
  await evaluate(`document.querySelector('[data-preset="1m"]').click()`);
  assert.equal(await evaluate(`$('fdExpiry').value`),'2024-03-29');
  await evaluate(`resetFoodExpiry();$('fdBought').value='2026-11-13';$('fdBought').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-preset="1d"]').click();document.querySelector('[data-preset="1d"]').click()`);
  assert.equal(await evaluate(`$('fdExpiry').value`),'2026-11-15');
  assert.equal(await evaluate(`document.querySelector('[data-preset="1d"]').dataset.count`),'2');
  await evaluate(`document.querySelector('[data-preset="1w"]').click();$('fdBought').value='2026-11-20';$('fdBought').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await evaluate(`$('fdExpiry').value`),'2026-11-29');
  await evaluate(`$('fdExpiry').value='2024-03-15';$('fdExpiry').dispatchEvent(new Event('input',{bubbles:true}));$('fdBought').value='2024-03-01';$('fdBought').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await evaluate(`$('fdExpiry').value`),'2024-03-15');
  assert.equal(await evaluate(`document.querySelectorAll('#fdExpiryPresets .on').length`),0);
  await evaluate(`document.querySelector('[data-preset="1d"]').click()`);
  assert.equal(await evaluate(`$('fdExpiry').value`),'2024-03-16');
  await evaluate(`closeFoodSheet(true);editFood('${eggId}');resetFoodExpiry();$('fdBought').value='2024-03-01';$('fdBought').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-preset="3m"]').click();document.querySelector('[data-preset="3m"]').click();$('fdSave').click();editFood('${eggId}')`);
  assert.equal(await evaluate(`$('fdExpiry').value`),'2024-09-01');
  assert.equal(await evaluate(`document.querySelector('[data-preset="3m"]').dataset.count`),'2');
  assert.equal(await evaluate('document.getElementById("fdOpened")===null'),true);
  assert.equal(await evaluate('document.body.textContent.includes("개봉")'),false);
  assert.ok(await evaluate(`document.querySelector('#foodSheet .panel').scrollWidth <= document.querySelector('#foodSheet .panel').clientWidth`),'Product form horizontal overflow');
  assert.ok(await evaluate(`[...document.querySelectorAll('#fdExpiryPresets button')].every(b=>b.scrollWidth<=b.clientWidth)`),'Expiry shortcut text overflow');
  const formShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'product-form.png'),Buffer.from(formShot.data,'base64'));
  await evaluate('closeFoodSheet()');
  await waitFor(()=>evaluate('navigator.serviceWorker.controller!==null'),'service worker control');
  await evaluate('openPlatform();openSharedSettings()');
  assert.equal(await evaluate('!!document.getElementById("imp")'),true);
  assert.equal(await evaluate('document.getElementById("sStart")===null'),true);
  await evaluate('window.history.back()');await waitFor(()=>evaluate('activeApp==="platform"'),'browser back to platform');
  await evaluate('window.history.forward()');await waitFor(()=>evaluate('activeApp==="settings"'),'browser forward to settings');
  await evaluate('openPlatform()');
  assert.equal(await evaluate(`caches.keys().then(async keys=>{const c=await caches.open(keys.find(k=>k.startsWith('gagyebu-platform-')));return !!(await c.match('./fridge.js'))&&!!(await c.match('./platform.css'))&&!!(await c.match('./platform.js'))})`),true);
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await send('Page.reload');await waitFor(ready,'offline reload');
  assert.equal(await evaluate('activeApp'),'platform');
  await evaluate(`$('t-fridge').click()`);
  assert.equal(await evaluate('foodItems().length'),3);
  assert.equal(await evaluate('document.querySelectorAll(".food-grid article").length'),3);
  assert.equal(await evaluate(`foodRemaining(S.foods['${eggId}'])`),9);
  assert.equal(await evaluate(`S.foods['${eggId}'].initialQuantity`),10);
  assert.equal(await evaluate(`S.foods['${eggId}'].bestBefore`),'2024-09-01');
  assert.deepEqual(await evaluate(`S.foods['${eggId}'].expirySteps`),['3m','3m']);
  assert.equal(await evaluate(`foodRemaining(S.foods['${milkId}'])`),1);
  assert.equal(await evaluate(`$('storage-pantry').textContent.includes('기한 지남 1')`),true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.food-grid')).display`),'grid');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: native Back closes ledger records, planned confirmations, fixed expenses and ingredient editors; unsaved-input cancellation, save/delete/close history, immediate reopening, app navigation, linked purchases, mobile layouts and offline persistence.');
  console.log('Screenshots: .qa-preview/platform-mobile.png, .qa-preview/platform-desktop.png, .qa-preview/mobile.png');
  await send('Browser.close',{},false).catch(()=>{});
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  socket?.close();
  if(browser&&browser.exitCode===null)browser.kill();
  await new Promise(resolve=>server.close(resolve));
  if(profile){
    // 이 테스트가 tmp 안에 만든 전용 프로필만 정리한다.
    const target=path.resolve(profile),tmp=path.resolve(os.tmpdir())+path.sep;
    if(target.startsWith(tmp)&&path.basename(target).startsWith('gagyebu-fridge-qa-')){
      for(let n=0;n<10;n++){try{fs.rmSync(target,{recursive:true,force:true});break}catch{await delay(100)}}
    }
  }
});
