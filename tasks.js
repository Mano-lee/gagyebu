// 일정과 날짜 없는 할 일을 공통 백업·동기화 데이터에 함께 보관한다.
let taskDay='',taskMonth='',taskOverviewMonth='',taskQuery='',taskEditId=null,taskDraftBaseline='',taskPreviousFocus=null;
function validTaskDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0100-01-01'&&value<='9999-12-31'&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value}
function prepareTaskData(data){
  if(data.tasks!==undefined&&(!data.tasks||typeof data.tasks!=='object'||Array.isArray(data.tasks)))throw new Error('invalid-tasks');
  const tasks={};
  for(const [id,item] of Object.entries(data.tasks||{})){
    if(!item||item.id!==id||!/^[a-zA-Z0-9_-]+$/.test(id)||['__proto__','constructor','prototype'].includes(id)||typeof item.title!=='string'||!item.title.trim())throw new Error('invalid-task');
    for(const key of ['notes','date','time','createdAt','updatedAt','completedAt'])if(item[key]!==undefined&&typeof item[key]!=='string')throw new Error('invalid-task-text');
    for(const key of ['done','important'])if(item[key]!==undefined&&typeof item[key]!=='boolean')throw new Error('invalid-task-flag');
    if(item.date&&!validTaskDate(item.date)||item.time&&(!item.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)))throw new Error('invalid-task-date');
    tasks[id]={...item};
  }
  return {...data,tasks};
}
function taskItems(){return Object.values(S.tasks||{})}
function taskSort(a,b){return Number(!!a.done)-Number(!!b.done)||(a.date||'9999').localeCompare(b.date||'9999')||(a.time||'00:00').localeCompare(b.time||'00:00')||Number(!!b.important)-Number(!!a.important)||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.title.localeCompare(b.title,'ko')}
function taskMatches(item){const q=taskQuery.trim().toLocaleLowerCase();return !q||[item.title,item.notes||''].some(v=>v.toLocaleLowerCase().includes(q))}
function taskPlatformAlerts(){
  const pending=taskItems().filter(t=>!t.done&&t.date),items=pending.filter(t=>t.date<=today()),late=items.filter(t=>t.date<today()).length,current=items.length-late,alerts=[];
  if(items.length)alerts.push({id:'platformTaskAlert',section:'today',text:[late?`기한 지난 일 ${late}건`:'',current?`오늘 할 일·일정 ${current}건`:''].filter(Boolean).join(' · ')});
  const upcoming=pending.filter(t=>{const days=foodDays(t.date);return days!==null&&days>=1&&days<=3}).sort(taskSort);
  if(upcoming.length){const first=upcoming[0];alerts.push({id:'platformUpcomingTaskAlert',section:'today',text:`3일 이내 예정 일정 ${upcoming.length}건\n${first.date.slice(5).replace('-','/')} ${first.title.slice(0,60)}`})}
  return alerts;
}
function taskRow(item){
  const past=!item.done&&item.date&&item.date<today();
  return `<article class="task-row${item.done?' task-done':''}" data-task-id="${item.id}"><button class="task-check" onclick="toggleTask('${item.id}')" aria-label="${esc(item.title)} ${item.done?'완료 취소':'완료'}" aria-pressed="${!!item.done}">${item.done?'✓':''}</button><button class="task-copy" onclick="openTaskSheet('${item.id}')"><strong>${item.important?'<span class="task-star" aria-label="중요">★</span> ':''}${esc(item.title)}</strong><span class="task-meta${past?' task-late':''}">${past?'기한 지남 · ':''}${item.date?esc(dayLabel(item.date)):'날짜 없는 할 일'}${item.time?' · '+esc(item.time):item.date?' · 종일':''}${item.done?' · 완료':''}</span>${item.notes?`<span class="task-note">${esc(item.notes)}</span>`:''}</button></article>`;
}
function taskGroup(title,items,empty){return `<section class="task-group"><h2>${title}<span>${items.length}</span></h2>${items.length?items.sort(taskSort).map(taskRow).join(''):`<p class="task-empty">${empty}</p>`}</section>`}
function taskCalendar(compact=false){
  const displayedMonth=compact?(taskOverviewMonth||today().slice(0,7)):taskMonth;
  const [year,month]=displayedMonth.split('-').map(Number),first=new Date(year,month-1,1),count=new Date(year,month,0).getDate(),items=taskItems().filter(taskMatches),counts={};
  items.forEach(t=>{if(t.date&&!t.done)counts[t.date]=(counts[t.date]||0)+1});
  let days='<span class="task-blank"></span>'.repeat(first.getDay());
  for(let day=1;day<=count;day++){
    const date=`${year}-${pad(month)}-${pad(day)}`,n=counts[date]||0;
    const selected=date===(compact?today():taskDay);
    days+=`<button class="task-day${date===today()?' is-today':''}${selected?' selected':''}${n?' has-tasks':''}" data-date="${date}" aria-label="${date}${n?`, 미완료 ${n}건`:''}" aria-pressed="${selected}" onclick="${compact?'openTaskCalendarDay':'selectTaskDay'}('${date}')"><span>${day}</span>${n?`<small>${n}건</small>`:'<small aria-hidden="true">&nbsp;</small>'}</button>`;
  }
  return `<section class="task-calendar${compact?' task-mini-calendar':''}" aria-label="${compact?'오늘 화면의 작은 캘린더':'월간 일정'}">${compact?'<p class="task-mini-heading">일정 미리보기</p>':''}<div class="task-month"><button onclick="${compact?'moveTaskOverviewMonth':'moveTaskMonth'}(-1)" aria-label="이전 달">‹</button><h2>${year}년 ${month}월</h2><button onclick="${compact?'resetTaskOverviewMonth':'taskGoToday'}()" class="task-today-button">오늘</button><button onclick="${compact?'moveTaskOverviewMonth':'moveTaskMonth'}(1)" aria-label="다음 달">›</button></div><div class="task-week" aria-hidden="true">${[...'일월화수목금토'].map(d=>`<span>${d}</span>`).join('')}</div><div class="task-days">${days}</div><p class="task-calendar-help">${compact?'날짜를 눌러 일정 보기 · 미완료 건수':'날짜를 누르면 아래에 일정이 보여요. 건수는 미완료 기준이에요.'}</p></section>`;
}
function taskPage(){
  if(!taskDay)taskDay=today();if(!taskMonth)taskMonth=taskDay.slice(0,7);
  const section=currentAppRoute.section,items=taskItems().filter(taskMatches),pending=items.filter(t=>!t.done),labels={today:'오늘 챙길 일',calendar:'나의 캘린더',inbox:'메모·할 일',done:'완료한 일'};
  let content='';
  if(section==='calendar')content=`<div class="task-calendar-layout">${taskCalendar()}<div>${taskGroup(esc(dayLabel(taskDay)),items.filter(t=>t.date===taskDay),'이날은 등록한 일정이 없어요.')}<button class="btn ghost task-inline-add" onclick="openTaskSheet(null,'${taskDay}')">+ 이날 일정 추가</button></div></div>`;
  else if(section==='inbox')content=taskGroup('날짜 없이 기억해 둘 일',pending.filter(t=>!t.date),'생각나는 일을 메모해 두세요. 필요할 때 날짜를 정해 일정으로 옮길 수 있어요.');
  else if(section==='done')content=taskGroup('차근차근 해낸 일',items.filter(t=>t.done),'완료한 일이 여기에 모여요. 체크를 다시 누르면 할 일로 돌아가요.');
  else content=`<div class="task-today-layout"><div class="task-today-primary">${taskGroup('오늘의 일정·할 일',pending.filter(t=>t.date===today()),'오늘 일정이 비어 있어요. 할 일을 추가해 보세요.')}${taskGroup('기한이 지난 일',pending.filter(t=>t.date&&t.date<today()),'밀린 일이 없어요.')}</div><aside class="task-outlook" aria-label="다가오는 일정">${taskCalendar(true)}${taskGroup('다가오는 7일',pending.filter(t=>t.date>today()&&foodDays(t.date)<=7),'일주일 안에 예정된 일이 없어요.')}</aside></div>`;
  return `<section class="task-app"><div class="task-heading"><div><p class="task-eyebrow">하루를 가볍게, 하나씩</p><h1>${labels[section]||labels.today}</h1><p class="muted">${section==='inbox'?'날짜를 정하지 않은 일과 메모를 모아두세요.':section==='calendar'?'약속부터 작은 할 일까지, 날짜별로 살펴보세요.':section==='done'?'해낸 일도 기록으로 남겨요.':esc(dayLabel(today()))+' · 잊기 전에 여기에 적어두세요.'}</p></div><button class="btn" onclick="openTaskSheet()">+ 추가</button></div><label class="task-search" for="taskSearch">할 일·메모 검색<input id="taskSearch" type="search" placeholder="제목이나 메모로 찾아보기" value="${esc(taskQuery)}" oninput="searchTasks(this.value)"></label>${taskQuery?'<p class="task-search-notice">현재 화면에서 검색한 결과예요.</p>':''}${content}<p class="task-footnote">오늘·기한 지난 일은 플랫폼 홈에도 표시돼요. 앱을 닫아 두었을 때의 푸시 알림은 지원하지 않아요.</p></section>`;
}
function searchTasks(value){const input=$('taskSearch'),pos=input.selectionStart;taskQuery=value;render();$('taskSearch').focus();if(pos!==null)$('taskSearch').setSelectionRange(pos,pos)}
function selectTaskDay(date){taskDay=date;render()}
function openTaskCalendarDay(date){taskDay=date;taskMonth=date.slice(0,7);openApp('tasks','calendar')}
function moveTaskOverviewMonth(dir){const [y,m]=(taskOverviewMonth||today().slice(0,7)).split('-').map(Number),d=new Date(y,m-1+dir,1);if(d.getFullYear()<100||d.getFullYear()>9999)return;taskOverviewMonth=`${d.getFullYear()}-${pad(d.getMonth()+1)}`;render()}
function resetTaskOverviewMonth(){taskOverviewMonth='';render()}
function moveTaskMonth(dir){const [y,m]=taskMonth.split('-').map(Number),d=new Date(y,m-1+dir,1);if(d.getFullYear()<100||d.getFullYear()>9999)return;taskMonth=`${d.getFullYear()}-${pad(d.getMonth()+1)}`;taskDay=taskMonth+'-01';render()}
function taskGoToday(){taskDay=today();taskMonth=taskDay.slice(0,7);render()}
function taskDraft(){return JSON.stringify({title:$('tkTitle').value,notes:$('tkNotes').value,date:$('tkDate').value,time:$('tkTime').value,important:$('tkImportant').checked})}
function syncTaskTime(){const date=$('tkDate').value;$('tkTime').disabled=!date;if(!date)$('tkTime').value=''}
function openTaskSheet(id=null,date){
  const item=id&&S.tasks[id];if(id&&!item)return;
  if($('taskSheet').classList.contains('show')&&!closeTaskSheet())return;
  taskPreviousFocus=document.activeElement;taskEditId=id;
  $('tkTitle').value=item?.title||'';$('tkNotes').value=item?.notes||'';
  $('tkDate').value=item?item.date||'':date??(currentAppRoute.section==='calendar'?taskDay:currentAppRoute.section==='inbox'?'':today());
  $('tkTime').value=item?.time||'';$('tkImportant').checked=!!item?.important;syncTaskTime();
  $('tkHeading').textContent=item?'할 일·일정 수정':'할 일·일정 추가';$('tkDelete').hidden=!item;$('tkNotice').textContent='';
  $('taskSheet').classList.add('show');taskDraftBaseline=taskDraft();trackAppSheetHistory();
  setTimeout(()=>{if($('taskSheet').classList.contains('show'))$('tkTitle').focus()},50);
}
function closeTaskSheet(force=false,fromHistory=false){
  if(!$('taskSheet').classList.contains('show'))return true;
  if(!force&&taskDraft()!==taskDraftBaseline&&!confirm('아직 저장하지 않은 할 일 입력을 닫을까요?'))return false;
  $('taskSheet').classList.remove('show');taskEditId=null;
  (taskPreviousFocus?.isConnected?taskPreviousFocus:$('tk-today')).focus({preventScroll:true});
  if(!fromHistory)leaveAppSheetHistory();return true;
}
function saveTask(){
  const title=$('tkTitle').value.trim(),date=$('tkDate').value,time=date?$('tkTime').value:'';
  if(!title){$('tkNotice').textContent='해야 할 일을 입력해 주세요.';$('tkTitle').focus();return}
  if(date&&!validTaskDate(date)||time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){$('tkNotice').textContent='날짜와 시간을 확인해 주세요.';return}
  const id=taskEditId||'task_'+crypto.randomUUID(),old=S.tasks[id],stamp=new Date().toISOString();
  S.tasks[id]={...old,id,title,notes:$('tkNotes').value.trim(),date,time,important:$('tkImportant').checked,done:!!old?.done,createdAt:old?.createdAt||stamp,updatedAt:stamp};
  if(!save()){if(old)S.tasks[id]=old;else delete S.tasks[id];$('tkNotice').textContent='저장하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.';return}
  if(date){taskDay=date;taskMonth=date.slice(0,7)}
  closeTaskSheet(true);taskQuery='';openApp('tasks',old?.done?'done':date?'calendar':'inbox');
}
function toggleTask(id){
  const old=S.tasks[id];if(!old)return;const done=!old.done,stamp=new Date().toISOString();
  S.tasks[id]={...old,done,completedAt:done?stamp:'',updatedAt:stamp};if(!save())S.tasks[id]=old;render();
}
function deleteTask(){const id=taskEditId,old=S.tasks[id];if(!old||!confirm(`“${old.title}” 기록을 삭제할까요?`))return;delete S.tasks[id];if(!save()){S.tasks[id]=old;return}closeTaskSheet(true);render()}
document.addEventListener('keydown',event=>{
  if(!$('taskSheet').classList.contains('show'))return;
  if(event.key==='Escape'){event.preventDefault();closeTaskSheet()}
  if(event.key==='Tab'){
    const fields=[...$('taskSheet').querySelectorAll('input,textarea,button')].filter(el=>!el.disabled&&el.getClientRects().length),first=fields[0],last=fields.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
});
