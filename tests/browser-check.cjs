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
  for(const [width,height,name] of [[390,844,'platform-mobile'],[360,800,'platform-small-mobile'],[1280,900,'platform-desktop']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<960});
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),`Platform overflow at ${width}px`);
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
  await evaluate(`$('backToPlatform').click()`);
  assert.equal(await evaluate('document.querySelector("#platformPending").textContent.includes("1건")'),true);
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
  await evaluate(`document.querySelector('.food-grid .food-actions .btn').click()`);
  assert.equal(await evaluate('foodItems().filter(f=>f.openedAt).length'),1);
  await evaluate(`document.querySelector('.food-grid .food-card-top .food-name').click();$('fdStore').value='frozen';$('fdSave').click()`);
  assert.equal(await evaluate('foodItems().filter(f=>f.store===\'frozen\').length'),1);
  for(const [width,height,name] of [[390,844,'mobile'],[360,800,'small-mobile'],[1280,900,'desktop']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<960});
    await delay(100);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),`Page overflow at ${width}px`);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('.food-heading .btn').click()`);
  assert.ok(await evaluate(`document.querySelector('#foodSheet .panel').scrollWidth <= document.querySelector('#foodSheet .panel').clientWidth`),'Product form horizontal overflow');
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
  assert.equal(await evaluate('foodItems().length'),2);
  assert.equal(await evaluate('document.querySelectorAll(".food-grid article").length'),2);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.food-grid')).display`),'grid');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: platform entry, separate app menus, task shortcut, shared settings, browser back/forward; purchase → partial registration → completion; 360/390/1280px layouts; offline platform reload with preserved inventory.');
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
