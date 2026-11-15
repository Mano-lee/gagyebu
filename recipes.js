// 레시피는 기간과 독립적으로 공통 데이터에 보관한다. 사진도 백업에 포함한다.
const RECIPE_TEXT_FIELDS=['title','category','source','url','ingredients','steps','notes','original','tags'];
const RECIPE_CATEGORIES=['한식','중식','일식','양식','동남아 요리','칵테일','음료','베이킹·디저트','기타'];
const RECIPE_IMAGE_LIMIT=4,RECIPE_IMAGE_MAX=500000;
let recipeQuery='',recipeCategory='',recipeTag='',recipeSort='recent',recipeListSection='all',recipeEditId=null,recipeDraftBaseline='';
let recipeDraftImages=[],recipePreviousFocus=null,recipeUploading=false,recipeUploadVersion=0;

function recipeURL(value){
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:''}catch{return ''}
}
function prepareRecipeData(data){
  if(data.recipes!==undefined&&(!data.recipes||typeof data.recipes!=='object'||Array.isArray(data.recipes)))throw new Error('invalid-recipes');
  const recipes={};
  for(const [id,item] of Object.entries(data.recipes||{})){
    if(!item||item.id!==id||!/^[a-zA-Z0-9_-]+$/.test(id)||['__proto__','constructor','prototype'].includes(id)||typeof item.title!=='string'||!item.title.trim())throw new Error('invalid-recipe');
    for(const key of RECIPE_TEXT_FIELDS)if(item[key]!==undefined&&typeof item[key]!=='string')throw new Error('invalid-recipe-text');
    if(item.url&&!recipeURL(item.url))throw new Error('invalid-recipe-url');
    if(item.images!==undefined&&(!Array.isArray(item.images)||item.images.length>RECIPE_IMAGE_LIMIT||item.images.some(src=>typeof src!=='string'||src.length>RECIPE_IMAGE_MAX||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src))))throw new Error('invalid-recipe-images');
    recipes[id]={...item};
  }
  return {...data,recipes};
}
function recipeItems(){return Object.values(S.recipes||{})}
function recipeCategoryOf(item){const value=(item.category||'').trim();return value==='미분류'?'':value}
function recipeCategories(){return [...new Set([...RECIPE_CATEGORIES,...recipeItems().map(recipeCategoryOf).filter(Boolean)])]}
function recipeCategoryBadge(item){return `<span class="recipe-category">${esc(recipeCategoryOf(item)||'미분류')}</span>`}
function recipeMatchesCategory(item){return !recipeCategory||(recipeCategory==='uncategorized'?!recipeCategoryOf(item):recipeCategory==='category:'+recipeCategoryOf(item))}
function recipeTags(item){return [...new Set((item.tags||'').split(/[,，#\n]+/).map(tag=>tag.trim()).filter(Boolean))]}
function recipeResults(){
  const query=recipeQuery.trim().toLocaleLowerCase(),favorites=currentAppRoute.section==='favorites';
  return recipeItems().filter(item=>(!favorites||item.favorite)&&recipeMatchesCategory(item)&&(!recipeTag||recipeTags(item).includes(recipeTag))&&(!query||RECIPE_TEXT_FIELDS.some(key=>(item[key]||'').toLocaleLowerCase().includes(query))))
    .sort((a,b)=>recipeSort==='title'?a.title.localeCompare(b.title,'ko'):String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||a.title.localeCompare(b.title,'ko'));
}
function recipeFavoriteButton(item){return `<button class="recipe-star${item.favorite?' selected':''}" aria-label="${esc(item.title)} 즐겨찾기" aria-pressed="${!!item.favorite}" onclick="toggleRecipeFavorite('${item.id}')">${item.favorite?'★':'☆'}</button>`}
function recipeCard(item){
  return `<article class="recipe-card"><button class="recipe-card-open" onclick="openApp('recipes','${item.id}')">${item.images?.length?`<img src="${esc(item.images[0])}" alt="" loading="lazy">`:`<span class="recipe-cover" aria-hidden="true">${appIcon(PLATFORM_APPS.find(app=>app.id==='recipes'))}</span>`}<span class="recipe-card-copy"><strong>${esc(item.title)}</strong><span class="recipe-card-source">${esc(item.source|| (item.url?new URL(item.url).hostname:'내가 기록한 레시피'))}</span><span class="recipe-card-excerpt">${esc((item.ingredients||item.original||item.notes||'재료와 조리 순서를 나중에 채워보세요.').slice(0,100))}</span><span class="recipe-tags">${recipeCategoryBadge(item)}${recipeTags(item).slice(0,4).map(tag=>`<span>${esc(tag)}</span>`).join('')}</span></span></button>${recipeFavoriteButton(item)}</article>`;
}
function recipePage(){
  const item=Object.hasOwn(S.recipes||{},currentAppRoute.section)?S.recipes[currentAppRoute.section]:null;
  if(item)return recipeDetail(item);
  const favorites=currentAppRoute.section==='favorites',items=recipeResults(),tags=[...new Set(recipeItems().flatMap(recipeTags))].sort((a,b)=>a.localeCompare(b,'ko'));
  const categories=recipeCategories(),selectedCategory=recipeCategory.startsWith('category:')?recipeCategory.slice(9):'';
  if(selectedCategory&&!categories.includes(selectedCategory))categories.push(selectedCategory);
  return `<section class="recipe-app"><div class="recipe-heading"><div><p class="recipe-eyebrow">나만의 요리 기록</p><h1>${favorites?'즐겨찾는 레시피':'레시피 보관함'}</h1><p class="muted">다시 만들고 싶은 요리, 한곳에 모아두세요.</p></div><button class="btn" onclick="openRecipeSheet()">+ 레시피 추가</button></div>
  <div class="recipe-tools"><label class="recipe-search" for="recipeSearch">레시피 검색<input id="recipeSearch" type="search" placeholder="제목, 재료, 분류, 태그로 찾아보기" value="${esc(recipeQuery)}" oninput="searchRecipes(this.value)"></label>
  <label for="recipeCategory">분류<select id="recipeCategory" onchange="recipeCategory=this.value;render()"><option value="">모든 분류</option><option value="uncategorized"${recipeCategory==='uncategorized'?' selected':''}>미분류</option>${categories.map(name=>`<option value="category:${esc(name)}"${recipeCategory==='category:'+name?' selected':''}>${esc(name)}</option>`).join('')}</select></label>
  <label for="recipeTag">태그<select id="recipeTag" onchange="recipeTag=this.value;render()"><option value="">모든 태그</option>${tags.map(tag=>`<option value="${esc(tag)}"${recipeTag===tag?' selected':''}>${esc(tag)}</option>`).join('')}</select></label><label for="recipeSort">정렬<select id="recipeSort" onchange="recipeSort=this.value;render()"><option value="recent"${recipeSort==='recent'?' selected':''}>최근 수정순</option><option value="title"${recipeSort==='title'?' selected':''}>이름순</option></select></label></div>
  <p id="recipeResultCount" class="recipe-result-count" role="status">${items.length}개의 레시피</p><div id="recipeResults" class="recipe-grid">${recipeResultsMarkup(items,favorites)}</div></section>`;
}
function recipeResultsMarkup(items,favorites=currentAppRoute.section==='favorites'){
  return items.length?items.map(recipeCard).join(''):`<div class="recipe-empty"><span class="recipe-empty-icon" aria-hidden="true">${appIcon(PLATFORM_APPS.find(app=>app.id==='recipes'))}</span><h2>${recipeQuery||recipeTag||recipeCategory?'찾는 레시피가 없어요':favorites?'자주 만드는 요리를 모아보세요':'첫 레시피를 담아보세요'}</h2><p>${recipeQuery||recipeTag||recipeCategory?'검색어, 분류 또는 태그를 바꿔보세요.':favorites?'레시피의 별을 누르면 여기에 모여요.':'복사한 글, 출처 링크, 레시피 사진을 함께 저장할 수 있어요.'}</p>${!favorites&&!recipeQuery&&!recipeTag&&!recipeCategory?'<button class="btn" onclick="openRecipeSheet()">레시피 추가</button>':''}</div>`;
}
function searchRecipes(value){
  recipeQuery=value;const items=recipeResults();
  $('recipeResults').innerHTML=recipeResultsMarkup(items);$('recipeResultCount').textContent=`${items.length}개의 레시피`;
}
function recipeDetail(item){
  const lines=text=>text.split('\n').map(line=>line.trim()).filter(Boolean);
  return `<article class="recipe-app recipe-detail"><button class="recipe-back" onclick="openApp('recipes',recipeListSection)">← ${recipeListSection==='favorites'?'즐겨찾기':'레시피 목록'}</button><div class="recipe-heading"><div><p class="recipe-eyebrow">${esc(item.source||'나만의 요리 기록')}</p><h1>${esc(item.title)}</h1><div class="recipe-tags">${recipeCategoryBadge(item)}${recipeTags(item).map(tag=>`<span>${esc(tag)}</span>`).join('')}</div></div><div class="recipe-detail-actions">${recipeFavoriteButton(item)}<button class="btn ghost" onclick="openRecipeSheet('${item.id}')">수정</button></div></div>
  ${item.url?`<a class="recipe-source-link" href="${esc(recipeURL(item.url))}" target="_blank" rel="noopener noreferrer">출처 열기 ↗ <span>${esc(new URL(item.url).hostname)}</span></a>`:''}
  ${item.images?.length?`<section class="recipe-photos" aria-label="레시피 사진">${item.images.map((src,index)=>`<a href="${esc(src)}" target="_blank" rel="noopener" onclick="event.preventDefault();openRecipePhoto(${index})"><img src="${esc(src)}" alt="${esc(item.title)} 레시피 사진 ${index+1}"></a>`).join('')}</section>`:''}
  <div class="recipe-detail-columns">${item.ingredients?`<section class="card recipe-ingredients"><h2>재료</h2><ul>${lines(item.ingredients).map(line=>`<li>${esc(line)}</li>`).join('')}</ul></section>`:''}${item.steps?`<section class="card recipe-steps"><h2>만드는 순서</h2><ol>${lines(item.steps).map(line=>`<li>${esc(line.replace(/^\d+[.)]\s*/,''))}</li>`).join('')}</ol></section>`:''}</div>
  ${item.notes?`<section class="card"><h2>나만의 메모</h2><p class="recipe-text">${esc(item.notes)}</p></section>`:''}${item.original?`<details class="card recipe-original"${!item.ingredients&&!item.steps?' open':''}><summary>가져온 원문</summary><p class="recipe-text">${esc(item.original)}</p></details>`:''}
  ${!item.ingredients&&!item.steps&&!item.original&&!item.images?.length?'<p class="recipe-hint">출처를 보면서 재료와 조리 순서를 채워보세요.</p>':''}<p class="recipe-date">${item.updatedAt&&Number.isFinite(Date.parse(item.updatedAt))?'마지막 수정 '+esc(new Date(item.updatedAt).toLocaleDateString('ko-KR')):''}</p></article>`;
}
function openRecipePhoto(index){
  const item=S.recipes[currentAppRoute.section],src=item?.images?.[index];if(!src)return;
  // 브라우저의 data URL 새 탭 이동 제한을 피하고 원본 크기로 보여준다.
  const tab=window.open('about:blank','_blank');if(!tab)return;
  tab.opener=null;tab.document.title=item.title;
  const image=tab.document.createElement('img');image.src=src;image.alt=item.title;image.style.maxWidth='100%';tab.document.body.append(image);
}
function toggleRecipeFavorite(id){
  const item=S.recipes[id];if(!item)return;const before=item.favorite;item.favorite=!before;
  if(!save()){item.favorite=before;return}render();
}
function recipeDraft(){return JSON.stringify([RECIPE_TEXT_FIELDS.map(key=>$('rc-'+key).value),recipeDraftImages])}
function openRecipeSheet(id=null){
  const item=id&&S.recipes[id];if(id&&!item)return;
  if($('recipeSheet').classList.contains('show')&&!closeRecipeSheet())return;
  recipePreviousFocus=document.activeElement;recipeEditId=id;
  RECIPE_TEXT_FIELDS.forEach(key=>$('rc-'+key).value=item?.[key]||'');
  $('rcCategoryOptions').innerHTML=recipeCategories().map(name=>`<option value="${esc(name)}"></option>`).join('');
  recipeDraftImages=[...(item?.images||[])];recipeUploading=false;recipeUploadVersion++;
  $('rcTitle').textContent=item?'레시피 수정':'레시피 추가';$('rcSave').textContent=item?'변경 저장':'레시피 저장';$('rcDelete').hidden=!item;
  $('rcPaste').open=!!item?.original;$('rcImages').value='';$('rcNotice').textContent='';
  updateRecipeImages();$('recipeSheet').classList.add('show');recipeDraftBaseline=recipeDraft();trackAppSheetHistory();
  setTimeout(()=>{if($('recipeSheet').classList.contains('show'))$('rc-title').focus()},50);
}
function closeRecipeSheet(force=false,fromHistory=false){
  if(!$('recipeSheet').classList.contains('show'))return true;
  if(!force&&(recipeDraft()!==recipeDraftBaseline||recipeUploading)&&!confirm('아직 저장하지 않은 레시피 입력을 닫을까요?'))return false;
  recipeUploadVersion++;recipeUploading=false;$('recipeSheet').classList.remove('show');recipeEditId=null;
  (recipePreviousFocus?.isConnected?recipePreviousFocus:$('r-all')).focus({preventScroll:true});
  if(!fromHistory)leaveAppSheetHistory();return true;
}
function saveRecipe(){
  if(recipeUploading)return;
  const values=Object.fromEntries(RECIPE_TEXT_FIELDS.map(key=>[key,$('rc-'+key).value.trim()]));
  values.category=recipeCategoryOf(values);
  if(!values.title){$('rcNotice').textContent='레시피 제목을 입력해 주세요.';$('rc-title').focus();return}
  if(values.url&&!recipeURL(values.url)){$('rcNotice').textContent='출처 링크는 http:// 또는 https://로 시작하는 주소를 입력해 주세요.';$('rc-url').focus();return}
  if(values.url)values.url=recipeURL(values.url);
  const id=recipeEditId||'recipe_'+crypto.randomUUID(),old=S.recipes[id],stamp=new Date().toISOString();
  S.recipes[id]={...old,...values,id,images:[...recipeDraftImages],favorite:!!old?.favorite,createdAt:old?.createdAt||stamp,updatedAt:stamp};
  if(!save()){if(old)S.recipes[id]=old;else delete S.recipes[id];$('rcNotice').textContent='저장 공간이 부족할 수 있어요. 사진 수를 줄이거나 백업 후 다시 시도해 주세요.';return}
  closeRecipeSheet(true);openApp('recipes',id);
}
function deleteRecipe(){
  const id=recipeEditId,old=S.recipes[id];if(!old||!confirm(`“${old.title}” 레시피를 삭제할까요?`))return;
  delete S.recipes[id];if(!save()){S.recipes[id]=old;return}
  closeRecipeSheet(true);openApp('recipes',recipeListSection);
}
function splitRecipeText(){
  const text=$('rc-original').value.trim();if(!text){$('rcNotice').textContent='복사한 레시피 글을 먼저 붙여넣어 주세요.';return}
  if(($('rc-ingredients').value.trim()||$('rc-steps').value.trim())&&!confirm('입력한 재료와 조리 순서를 원문에서 나눈 내용으로 바꿀까요?'))return;
  let section='',ingredients=[],steps=[];
  for(const raw of text.split('\n')){
    const line=raw.trim(),heading=line.replace(/^[#\s*\[【]+|[\]】:*\s]+$/g,'').trim();
    const match=heading.match(/^(재료|준비물|양념|양념 재료|소스|ingredients|만드는 법|만드는 방법|조리 순서|조리 방법|만드는 순서|조리법|레시피|방법|순서|steps|instructions|directions)(?:\s*[:：]\s*(.*))?$/i);
    if(match){section=/^(재료|준비물|양념|양념 재료|소스|ingredients)$/i.test(match[1])?'ingredients':'steps';if(match[2])(section==='ingredients'?ingredients:steps).push(match[2]);continue}
    if(line&&section)(section==='ingredients'?ingredients:steps).push(line);
  }
  if(!ingredients.length&&!steps.length){$('rcNotice').textContent='재료·조리 순서 제목을 찾지 못했어요. 원문은 그대로 저장하고, 필요한 내용을 각 칸에 옮겨 주세요.';return}
  $('rc-ingredients').value=ingredients.join('\n');$('rc-steps').value=steps.join('\n');
  $('rcNotice').textContent='재료·조리 순서 제목을 기준으로 나눴어요. 저장 전에 내용을 확인해 주세요. 원문도 함께 보관해요.';
}
function updateRecipeImages(){
  $('rcImagePreview').innerHTML=recipeDraftImages.map((src,index)=>`<div><img src="${esc(src)}" alt="첨부 사진 ${index+1}"><button type="button" onclick="removeRecipeImage(${index})" aria-label="사진 ${index+1} 삭제">×</button></div>`).join('');
  $('rcImageCount').textContent=recipeUploading?'사진 준비 중…':`${recipeDraftImages.length}/${RECIPE_IMAGE_LIMIT}장`;
  $('rcSave').disabled=recipeUploading;$('rcImages').disabled=recipeUploading;
}
function removeRecipeImage(index){recipeDraftImages.splice(index,1);updateRecipeImages()}
async function compressRecipeImage(file){
  if(!file.type.startsWith('image/')||file.size>20*1024*1024)throw new Error('사진 파일은 한 장당 20MB 이하로 선택해 주세요.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const ratio=Math.min(1,1400/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    let result=canvas.toDataURL('image/jpeg',0.82);
    if(result.length>RECIPE_IMAGE_MAX)result=canvas.toDataURL('image/jpeg',0.55);
    if(result.length>RECIPE_IMAGE_MAX)throw new Error('사진이 너무 복잡하거나 커요. 필요한 부분을 잘라서 다시 첨부해 주세요.');
    return result;
  }finally{URL.revokeObjectURL(url)}
}
async function addRecipeImages(input){
  const files=[...input.files];input.value='';if(!files.length||recipeUploading)return;
  if(files.length+recipeDraftImages.length>RECIPE_IMAGE_LIMIT){$('rcNotice').textContent=`사진은 레시피마다 ${RECIPE_IMAGE_LIMIT}장까지 첨부할 수 있어요.`;return}
  const version=recipeUploadVersion;recipeUploading=true;updateRecipeImages();$('rcNotice').textContent='';
  try{const images=[];for(const file of files)images.push(await compressRecipeImage(file));if(version===recipeUploadVersion)recipeDraftImages.push(...images)}
  catch(error){if(version===recipeUploadVersion)$('rcNotice').textContent=error.message.includes('사진')?error.message:'사진을 읽지 못했어요. JPG, PNG, WebP 파일로 다시 시도해 주세요.'}
  finally{if(version===recipeUploadVersion){recipeUploading=false;updateRecipeImages()}}
}
document.addEventListener('keydown',event=>{
  if(!$('recipeSheet').classList.contains('show'))return;
  if(event.key==='Escape'){event.preventDefault();closeRecipeSheet()}
  if(event.key==='Tab'){
    const fields=[...$('recipeSheet').querySelectorAll('input,textarea,select,button,summary')].filter(el=>!el.disabled&&el.getClientRects().length),first=fields[0],last=fields.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
});
