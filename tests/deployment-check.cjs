// GitHub API 인증은 기존 Git credential manager에서 읽어 메모리에서만 사용한다.
// 인증 값이나 사용자의 실제 장부/구글 시트에는 접근하거나 출력하지 않는다.
const {spawnSync,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const repo='Mano-lee/gagyebu',site='https://mano-lee.github.io/gagyebu/';
const headers={'User-Agent':'gagyebu-deployment-check','Accept':'application/vnd.github+json'};
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const result=spawnSync('git',['credential','fill'],{cwd:root,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
if(result.status===0){const match=result.stdout.match(/^password=(.*)$/m);if(match)headers.Authorization='Bearer '+match[1].trim()}
async function api(endpoint){
  const response=await fetch('https://api.github.com/repos/'+repo+endpoint,{headers,signal:AbortSignal.timeout(20000)});
  if(response.status===404||response.status===403)return null;
  if(!response.ok)throw new Error(`GitHub API ${endpoint}: HTTP ${response.status}`);
  return response.json();
}
const hash=data=>createHash('sha256').update(data).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function inspect(){
  const [pages,build,runs,deployments]=await Promise.all([api('/pages'),api('/pages/builds/latest'),api('/actions/runs?per_page=5'),api('/deployments?environment=github-pages&per_page=3')]);
  console.log(JSON.stringify({repository:repo,site,authenticated:!!headers.Authorization,pages:pages&&{status:pages.status,build_type:pages.build_type,source:pages.source},latest_build:build&&{status:build.status,commit:build.commit,error:build.error?.message},workflow_runs:runs?.workflow_runs?.map(r=>({name:r.name,status:r.status,conclusion:r.conclusion,sha:r.head_sha,url:r.html_url})),recent_deployments:deployments?.map(d=>({sha:d.sha,environment:d.environment,created_at:d.created_at}))},null,2));
}
async function verify(){
  const sha=git(['rev-parse','HEAD']);
  const [build,runs]=await Promise.all([api('/pages/builds/latest'),api('/actions/runs?per_page=8')]);
  const pagesRun=runs?.workflow_runs?.find(r=>r.head_sha===sha&&/pages/i.test(r.name));
  if(pagesRun&&pagesRun.status==='completed'&&pagesRun.conclusion!=='success')throw new Error('GitHub Pages workflow failed: '+pagesRun.html_url);
  if(build?.commit===sha&&build.status==='errored')throw new Error('GitHub Pages build failed: '+(build.error?.message||'unknown error'));
  const assets=['index.html','platform.js','platform.css','fridge.js','fridge.css','sw.js','manifest.webmanifest','app-icon.svg','app-icon-192.png','app-icon-512.png','apple-touch-icon.png','favicon-32.png'];
  const checks=await Promise.all(assets.map(async name=>{
    const response=await fetch(site+(name==='index.html'?'':name)+'?deploy='+sha+'&t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok)return {name,ok:false,status:response.status};
    const actual=Buffer.from(await response.arrayBuffer()),expected=execFileSync('git',['show',sha+':'+name],{cwd:root,windowsHide:true});
    const text=/\.(html|js|css|webmanifest|svg)$/.test(name);
    const normalize=b=>text?Buffer.from(b.toString('utf8').replace(/\r\n/g,'\n')):b;
    return {name,ok:hash(normalize(actual))===hash(normalize(expected)),status:response.status};
  }));
  const workflowConfirmed=pagesRun?.status==='completed'&&pagesRun.conclusion==='success';
  const buildConfirmed=build?.commit===sha&&build.status==='built';
  const assetsMatch=checks.every(c=>c.ok);
  const info={site,commit:sha,deployment_confirmed:!!(workflowConfirmed||buildConfirmed),assets_match:assetsMatch,assets:checks,workflow_url:pagesRun?.html_url,build_status:build?.status};
  console.log(JSON.stringify(info,null,2));
  return assetsMatch&&!!(workflowConfirmed||buildConfirmed);
}
(async()=>{
  if(process.argv.includes('--inspect'))return inspect();
  if(process.argv.includes('--wait')){
    for(let i=0;i<24;i++){if(await verify())return;console.log('Waiting for GitHub Pages publication…');await delay(10000)}
    throw new Error('GitHub Pages has not been confirmed within four minutes.');
  }
  if(!await verify())process.exitCode=2;
})().catch(error=>{console.error(error.message);process.exitCode=1});
