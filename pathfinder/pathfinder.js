#!/usr/bin/env node
// Pathfinder - AI job board in ONE file.   Run:  node pathfinder.js   then open http://localhost:3000
// Needs only Node.js 18+. No API keys or accounts. Optional: poppler (OCR of scanned PDFs).
// Optional: Ollama (free local AI, https://ollama.com) powers resume tailoring, cover letters and the plain-English explanations.  Setup:  ollama pull llama3.2
//
// HOW THE FILE IS ORGANISED (search for the "=====" banners):
//   COMPANIES / boards.json   which companies and job sources are downloaded
//   M.adapters                one adapter per job source (Greenhouse, Lever, Ashby, Recruitee, Workable + Remotive, RemoteOK, Arbeitnow, Himalayas)
//   M.resume                  resume file reading (PDF, DOCX, images)
//   M.geo                     locations -> countries/cities/remote scope
//   M.enrich                  facts derived from each posting: work mode, remote scope, visa, relocation, languages, skills, level, years...
//   M.profile                 resume text -> structured profile (dated roles, weighted experience, education, languages)
//   M.fit                     the explainable 0-100 job fit score + "can I take this job from where I live?" check
//   M.search                  query understanding, filters, ranking, facets, recommendations
//   M.ai                      Ollama integration (tailoring, cover letters, explanations)
//   client / server           the web page (client function) and the HTTP API
if(+process.versions.node.split('.')[0]<18){console.error('Node 18 or newer is required (you have '+process.version+'). Get it at https://nodejs.org');process.exit(1)}
const M={};
const COMPANIES={
  "greenhouse": ["stripe","airbnb","cloudflare","gitlab","databricks","anthropic"],
  "lever": ["spotify","palantir"],
  "ashby": ["ramp","notion","linear","openai","mistral.ai"],
  // Boards on Recruitee / Workable can be listed by their company slug, e.g. "recruitee": ["acme"], "workable": ["acme"]
  "recruitee": [],
  "workable": [],
  // Remote-job aggregators: one request returns many companies. Remote - Worldwide / region / country rules are read from each posting.
  // Remove a name to turn it off. They are only contacted every 6 hours. (remotive, remoteok, arbeitnow = Germany/EU incl. visa-sponsored jobs, himalayas)
  "aggregators": ["remotive","remoteok","arbeitnow","himalayas"],
  // "try": company names that are checked on Greenhouse, Lever (US + EU) and Ashby. Whichever one a company really uses is kept;
  // the others answer "not found" and are skipped quietly (and remembered for 14 days). To add a company just add its name here.
  "try": [
    // cybersecurity
    "sentinelone","snyk","wizinc","wiz","abnormalsecurity","tanium","huntress","expel","axonius","netskope","drata","vanta","1password","cribl","sumologic",
    "rapid7","tenable","okta","crowdstrike","zscaler","cyberark","proofpoint","recordedfuture","bitsight","securityscorecard","arcticwolf","cohesity","rubrik",
    "illumio","lacework","orcasecurity","cyera","armis","semperis","socure","sardine","chainguard","tailscale","teleport","hashicorp","bugcrowd","hackerone",
    "synack","veracode","sonatype","sailpoint","beyondtrust","delinea","pingidentity","darktrace","trellix","claroty","dragos","nozominetworks","coalitioninc",
    "sophos","mimecast","knowbe4","secureworks","vectra","exabeam","blumira","datadog","elastic","immersivelabs",
    // software / tech (many hire remote)
    "coinbase","figma","discord","reddit","pinterest","dropbox","instacart","robinhood","lyft","twilio","mongodb","asana","carta","gusto","brex","affirm",
    "doordash","duolingo","grammarly","scaleai","samsara","vercel","pagerduty","newrelic","webflow","zoominfo","toast","squarespace","etsy","peloton","roblox",
    "nerdwallet","intercom","mixpanel","amplitude","airtable","fivetran","dbtlabs","andurilindustries","anduril","spacex","retool","replit","perplexity",
    "supabase","clerk","posthog","benchling","hex","mercury","lattice","harvey","cohere","deel","plaid","chime","sofi","block","hubspot","zapier","confluent",
    "cockroachlabs","planetscale","sourcegraph","launchdarkly","circleci","flexport","rippling","doximity","veeva","hims","attentive","coursera","udemy",
    "chainalysis","circle","gemini","kraken","zendesk","docusign","gong","glean",
    "elevenlabs","huggingface","weightsandbiases","anyscale","together",
    // companies that hire in Europe / Spain / Japan or worldwide (names that are not found on a platform are simply skipped)
    "sentry","docker","canonical","mozilla","grafanalabs","mattermost","buffer","monzo","n26","bolt","typeform","glovo","cabify","wallapop","personio","celonis",
    "contentful","algolia","mollie","wise","mercari","paypay","smarthr","moneyforward","remote","oysterhr","omnipresent","papayaglobal",
    // Pittsburgh / Pennsylvania area tech
    "aurorainnovation","geckorobotics","astrobotic","carnegierobotics","contrastsecurity"
  ]
};
let cfg=COMPANIES;try{cfg=JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'boards.json'),'utf8'))}catch{}
// ===== Job sources. Each adapter returns jobs in ONE normalized shape. =====
M.adapters=(()=>{const module={exports:{}};
// Source adapters: each returns jobs in ONE normalized shape. Add a source = add one object to ADAPTERS.
const UA='PathfinderBot/1.0 (aggregates publicly posted jobs; respects each board\'s public API)';
const get=async u=>{const r=await fetch(u,{headers:{'User-Agent':UA,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error('HTTP '+r.status);return r.json()};
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
const plain=h=>{let s=String(h||'');if(/&lt;/.test(s))s=dec(s);
  s=s.replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi,'\n').replace(/<li[^>]*>/gi,'• ').replace(/<[^>]+>/g,'');
  return dec(s).replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n+/g,'\n\n').trim()};
const PRETTY={openai:'OpenAI',gitlab:'GitLab',sentinelone:'SentinelOne',crowdstrike:'CrowdStrike',doordash:'DoorDash',scaleai:'Scale AI','1password':'1Password',pagerduty:'PagerDuty',newrelic:'New Relic',mongodb:'MongoDB',wizinc:'Wiz',abnormalsecurity:'Abnormal Security',sumologic:'Sumo Logic',aurorainnovation:'Aurora',andurilindustries:'Anduril',dbtlabs:'dbt Labs',geckorobotics:'Gecko Robotics',hackerone:'HackerOne',knowbe4:'KnowBe4',github:'GitHub',hubspot:'HubSpot',spacex:'SpaceX',nerdwallet:'NerdWallet',launchdarkly:'LaunchDarkly',zoominfo:'ZoomInfo',cyberark:'CyberArk',securityscorecard:'SecurityScorecard',bitsight:'BitSight',recordedfuture:'Recorded Future',arcticwolf:'Arctic Wolf',beyondtrust:'BeyondTrust',sailpoint:'SailPoint',pingidentity:'Ping Identity',orcasecurity:'Orca Security',cockroachlabs:'Cockroach Labs',planetscale:'PlanetScale',huggingface:'Hugging Face',weightsandbiases:'Weights & Biases',elevenlabs:'ElevenLabs',epicgames:'Epic Games',riotgames:'Riot Games',unity3d:'Unity',geckorobotics:'Gecko Robotics',carnegierobotics:'Carnegie Robotics',coalitioninc:'Coalition',nozominetworks:'Nozomi Networks'};
const pretty=b=>PRETTY[b]||b.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const SK=['JavaScript','TypeScript','React','Node.js','Python','Java','Go','Rust','C++','C#','SQL','PostgreSQL','AWS','GCP','Azure','Kubernetes','Docker','Terraform','GraphQL','Machine Learning','LLM','PyTorch','Figma','Excel','Salesforce','Product Management','Agile','CI/CD','Linux','Swift','Kotlin','Ruby','PHP','Tableau','Data Analysis','Project Management','SEO','Accounting'];
const esc=s=>s.replace(/[.+*?^${}()|[\]\\\/]/g,'\\$&');
const skills=t=>SK.filter(s=>new RegExp('(^|[^A-Za-z0-9+#])'+esc(s)+'($|[^A-Za-z0-9+#])',s.length<=3?'':'i').test(t)).slice(0,12);
const level=t=>/\b(intern|junior|jr|associate|entry)\b/i.test(t)?'junior':/\b(staff|principal|lead|head|director|vp|manager)\b/i.test(t)?'lead':/\b(senior|sr)\b/i.test(t)?'senior':'mid';
const ctype=s=>{s=String(s||'');return /full/i.test(s)||/permanent/i.test(s)?'Full-time':/part/i.test(s)?'Part-time':/contract|temp|freelance/i.test(s)?'Contract':/intern/i.test(s)?'Internship':'Unspecified'};
const annual=(min,max,iv)=>{const a=+min||0,b=+max||0,m=a&&b?(a+b)/2:a||b;if(!m)return null;
  const i=String(iv||'');const f=/hour/i.test(i)?2080:/month/i.test(i)?12:/week/i.test(i)?52:1;return Math.round(m*f/1000)};
const mk=o=>({id:('j-'+o.source+'-'+o.board+'-'+o.ext).toLowerCase().replace(/[^a-z0-9]+/g,'-'),title:o.title,company:o.company,
  loc:o.loc||'Unspecified',remote:!!o.remote||/remote/i.test(o.loc||''),type:o.type||'Unspecified',salary:o.salary||null,cur:o.cur||null,
  mode:o.mode||undefined,desc:o.desc||'',source:o.source,
  sourceKey:o.source+':'+o.board,url:o.url,posted:o.posted||null});

const greenhouse={name:'Greenhouse',async fetch(board,o){
  const [info,data]=await Promise.all([get(`https://boards-api.greenhouse.io/v1/boards/${board}`).catch(()=>({})),
    get(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true&pay_transparency=true`)]);
  return (data.jobs||[]).map(j=>{const p=(j.pay_input_ranges||[])[0];
    return mk({source:'Greenhouse',board,ext:j.id,title:j.title,company:o.company||j.company_name||info.name||pretty(board),
      loc:j.location?.name,desc:plain(j.content),url:j.absolute_url,posted:j.first_published||j.updated_at,
      salary:p?annual(p.min_cents/100,p.max_cents/100):null,cur:p?.currency_type})})}};

const lever={name:'Lever',async fetch(board,o){
  const data=await get(`https://${o.eu?'api.eu.lever.co':'api.lever.co'}/v0/postings/${board}?mode=json`);
  return data.map(j=>{const c=j.categories||{},s=j.salaryRange;
    const desc=[j.descriptionPlain||plain(j.description),...(j.lists||[]).map(l=>l.text+'\n'+plain(l.content)),j.additionalPlain||plain(j.additional)].filter(Boolean).join('\n\n');
    const wt=String(j.workplaceType||'').toLowerCase().replace(/[^a-z]/g,'');
    return mk({source:o.eu?'Lever EU':'Lever',board,ext:j.id,mode:{onsite:'onsite',remote:'remote',hybrid:'hybrid'}[wt],title:j.text,company:o.company||pretty(board),loc:(c.allLocations||[c.location]).filter(Boolean).join(' / '),
      remote:wt==='remote',type:ctype(c.commitment),desc,url:j.hostedUrl||j.applyUrl,
      posted:j.createdAt?new Date(j.createdAt).toISOString():null,salary:s?annual(s.min,s.max,s.interval):null,cur:s?.currency})})}};

const ashby={name:'Ashby',async fetch(board,o){
  const data=await get(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`);
  return (data.jobs||[]).filter(j=>j.isListed!==false).map(j=>{
    const c=(j.compensation?.summaryComponents||[]).find(x=>/salary/i.test(x.compensationType||''));
    const wt=String(j.workplaceType||'').toLowerCase().replace(/[^a-z]/g,''),mode={onsite:'onsite',remote:'remote',hybrid:'hybrid'}[wt]||(j.isRemote?'remote':undefined);
    return mk({source:'Ashby',board,ext:j.id||j.jobUrl,mode,title:j.title,company:o.company||pretty(board),
      loc:[j.location,...(j.secondaryLocations||[]).map(x=>x.location||x)].filter(Boolean).join(' / '),
      remote:mode==='remote',type:ctype(String(j.employmentType||'').replace(/([a-z])([A-Z])/g,'$1 $2')),
      desc:j.descriptionPlain||plain(j.descriptionHtml),url:j.jobUrl||j.applyUrl,posted:j.publishedAt,
      salary:c?annual(c.minValue,c.maxValue,c.interval):null,cur:c?.currencyCode})})}};


// ---- Extra sources (all public job-board APIs; every job keeps its original posting URL). Add more by adding an object here. ----
const iso=v=>{if(v==null||v==='')return null;const d=typeof v==='number'?new Date(v<1e12?v*1000:v):new Date(v);return isNaN(d)?null:d.toISOString()};
const leverEU={...lever,name:'Lever EU',fetch:(b,o)=>lever.fetch(b,{...o,eu:true})};
// Recruitee: https://{company}.recruitee.com  (many European companies)
const recruitee={name:'Recruitee',async fetch(board,o){const d=await get(`https://${board}.recruitee.com/api/offers/`);
  return (d.offers||[]).filter(j=>j.status?j.status==='published':true).map(j=>{const loc=[j.city,j.country].filter(Boolean).join(', ')||j.location||'';
    return mk({source:'Recruitee',board,ext:j.id,title:j.title,company:o.company||j.company_name||pretty(board),loc:j.remote?('Remote - '+(j.country||'')).replace(/ - $/,''):loc,mode:j.remote?'remote':'onsite',
      desc:plain((j.description||'')+'\n'+(j.requirements||'')),url:j.careers_url||j.url,posted:j.published_at||j.created_at,type:ctype(j.employment_type_code),
      salary:j.min_salary||j.max_salary?annual(j.min_salary,j.max_salary,'year'):null,cur:j.salary_currency})})}};
// Workable: https://apply.workable.com/{company}
const workable={name:'Workable',async fetch(board,o){const d=await get(`https://apply.workable.com/api/v1/widget/accounts/${board}?details=true`);
  return (d.jobs||[]).map(j=>{const loc=[j.city,j.state,j.country].filter(Boolean).join(', ');
    return mk({source:'Workable',board,ext:j.shortcode||j.id,title:j.title,company:o.company||d.name||pretty(board),loc:j.telecommuting?('Remote'+(j.country?' - '+j.country:'')):loc,mode:j.telecommuting?'remote':undefined,
      desc:plain(j.description),url:j.url||j.shortlink||j.application_url,posted:j.published_on||j.created_at,type:ctype(j.employment_type)})})}};
// Aggregators (one request = many companies). They are rate-limited by us (see minHours) to stay polite.
const remotiveLoc=s=>{s=String(s||'').trim();return !s||/worldwide|anywhere|global/i.test(s)?'Remote - Worldwide':/usa only|us only/i.test(s)?'Remote - USA':'Remote - '+s};
const remotive={name:'Remotive',minHours:6,async fetch(){const d=await get('https://remotive.com/api/remote-jobs');
  return (d.jobs||[]).filter(j=>j.title&&j.url).map(j=>mk({source:'Remotive',board:'remotive',ext:j.id,title:j.title,company:j.company_name,loc:remotiveLoc(j.candidate_required_location),mode:'remote',
    type:ctype(String(j.job_type||'').replace(/_/g,' ')),desc:plain(j.description),url:j.url,posted:j.publication_date}))}};
const remoteok={name:'RemoteOK',minHours:6,async fetch(){const d=await get('https://remoteok.com/api');
  return (Array.isArray(d)?d:[]).filter(j=>j&&j.position&&(j.url||j.apply_url)).map(j=>{const sMin=+j.salary_min||0,sMax=+j.salary_max||0;
    return mk({source:'RemoteOK',board:'remoteok',ext:j.id||j.slug,title:j.position,company:j.company,loc:remotiveLoc(j.location),mode:'remote',desc:plain(j.description),url:j.url||j.apply_url,posted:j.date||iso(j.epoch),
      salary:sMin||sMax?annual(sMin,sMax,'year'):null,cur:sMin||sMax?'USD':null})})}};
const arbeitnow={name:'Arbeitnow',minHours:6,async fetch(){const out=[];for(let p=1;p<=4;p++){const d=await get('https://www.arbeitnow.com/api/job-board-api?page='+p);const L=d.data||[];if(!L.length)break;
    for(const j of L)if(j.title&&j.url)out.push(mk({source:'Arbeitnow',board:'arbeitnow',ext:j.slug,title:j.title,company:j.company_name,loc:j.remote?('Remote - '+(j.location||'Germany')):(j.location||''),mode:j.remote?'remote':'onsite',
      desc:plain(j.description),url:j.url,posted:iso(j.created_at),type:ctype((j.job_types||[]).join(' '))}));if(!d.links?.next)break}return out}};
const himalayas={name:'Himalayas',minHours:6,async fetch(){const out=[];const seen=new Set();for(let off=0;off<100;off+=20){const d=await get('https://himalayas.app/jobs/api?limit=20&offset='+off);const L=(d.jobs||[]).filter(j=>!seen.has(j.guid||j.applicationLink));if(!L.length)break;L.forEach(j=>seen.add(j.guid||j.applicationLink));
    for(const j of L){if(!j.title||!(j.applicationLink||j.guid))continue;const r=(j.locationRestrictions||[]).filter(Boolean);
      out.push(mk({source:'Himalayas',board:'himalayas',ext:j.guid||j.applicationLink,title:j.title,company:j.companyName,loc:'Remote - '+(r.length?r.join(', '):'Worldwide'),mode:'remote',desc:plain(j.description||j.excerpt),
        url:j.applicationLink||j.guid,posted:iso(j.pubDate),type:ctype(j.employmentType),salary:j.minSalary||j.maxSalary?annual(j.minSalary,j.maxSalary,'year'):null,cur:j.currency}))}}return out}};
const AGGREGATORS={remotive,remoteok,arbeitnow,himalayas};

const ADAPTERS={greenhouse,lever,ashby,recruitee,workable};   // boards you list by name
const PROBE=[greenhouse,lever,leverEU,ashby];   // "try" names are checked on these
// Boards under "try" are checked on all three platforms: the one that knows the company is used, the rest answer 404 and are skipped quietly.
const GF=require('path').join(__dirname,'pathfinder-data','boards-gone.json');let GONE={};try{GONE=JSON.parse(require('fs').readFileSync(GF,'utf8'))}catch{}
const gone=k=>GONE[k]&&Date.now()-GONE[k]<14*864e5;   // "not found" answers are remembered for 14 days so we do not keep asking
const LF=require('path').join(__dirname,'pathfinder-data','last-fetch.json');let LAST={};try{LAST=JSON.parse(require('fs').readFileSync(LF,'utf8'))}catch{}
const due=ad=>!ad.minHours||!LAST[ad.name]||Date.now()-LAST[ad.name]>ad.minHours*36e5;
async function fetchAll(cfg,conc=8){
  const tasks=[];
  for(const [k,list] of Object.entries(cfg))for(const b of list||[]){const o=typeof b==='string'?{board:b}:b;
    if(k==='try'){for(const ad of PROBE)if(!gone(ad.name+':'+o.board))tasks.push({ad,o,probe:true})}
    else if(k==='aggregators'){const ad=AGGREGATORS[String(o.board).toLowerCase()];if(ad&&due(ad))tasks.push({ad,o:{board:ad.name.toLowerCase()},agg:true})}
    else if(ADAPTERS[k])tasks.push({ad:ADAPTERS[k],o})}
  const jobs=[],sources=[];let i=0;
  await Promise.all(Array.from({length:conc},async()=>{while(i<tasks.length){const {ad,o,probe}=tasks[i++],key=ad.name+':'+o.board,at=new Date().toISOString();
    try{const r=await ad.fetch(o.board,o);
      if(probe&&!r.length){GONE[key]=Date.now();sources.push({key,name:ad.name,board:o.board,ok:false,missing:true,probe:true,count:0,at});continue}
      delete GONE[key];if(ad.minHours)LAST[ad.name]=Date.now();jobs.push(...r.filter(j=>j.title&&j.url));sources.push({key,name:ad.name,board:o.board,ok:true,count:r.length,at})}
    catch(e){const msg=String(e.message||e),nf=/HTTP 404/.test(msg);if(nf)GONE[key]=Date.now();
      sources.push({key,name:ad.name,board:o.board,ok:false,missing:nf||!!probe,probe:!!probe,count:0,error:msg,at})}}}));
  try{require('fs').mkdirSync(require('path').dirname(GF),{recursive:true});require('fs').writeFileSync(GF,JSON.stringify(GONE));require('fs').writeFileSync(LF,JSON.stringify(LAST))}catch{}
  return {jobs,sources:sources.sort((a,b)=>a.key.localeCompare(b.key))}}
module.exports={fetchAll,ADAPTERS,AGGREGATORS,PROBE,mk,plain};
return module.exports})();
// ===== Resume file reading (PDF, DOCX, images, OCR) - unchanged from the original app =====
M.resume=(()=>{
const fs=require('fs'),os=require('os'),path=require('path'),{execFile,exec}=require('child_process'),ex=require('util').promisify(execFile);
const MAXP=+process.env.OCR_MAX_PAGES||12,LANG=process.env.OCR_LANG||'eng';
let depP;
function deps(){return depP||(depP=(async()=>{
  const dir=path.join(__dirname,'pathfinder-modules'),{createRequire}=require('module');fs.mkdirSync(dir,{recursive:true});
  const pj=path.join(dir,'package.json');
  if(!fs.existsSync(pj))fs.writeFileSync(pj,JSON.stringify({name:'pf-modules',private:true,dependencies:{'pdf-parse':'1.1.1',mammoth:'*','tesseract.js':'*'}}));
  const rq=createRequire(path.join(dir,'x.js'));
  try{rq.resolve('pdf-parse');rq.resolve('mammoth');rq.resolve('tesseract.js')}catch{
    console.log('Installing resume-reading libraries (first use only, needs internet)...');
    await new Promise((ok,no)=>exec('npm install --no-audit --no-fund',{cwd:dir},(e,so,se)=>e?no(new Error('npm install failed: '+(se||e.message).slice(-300))):ok()))}
  return {pdfParse:rq('pdf-parse'),mammoth:rq('mammoth'),createWorker:rq('tesseract.js').createWorker}})().catch(e=>{depP=null;throw e}))}
async function ocr(files,createWorker){const w=await createWorker(LANG);let t='',c=0;
  try{for(const f of files){const {data}=await w.recognize(f);t+=data.text+'\n';c+=data.confidence}}finally{await w.terminate()}
  return {text:t,confidence:Math.round(c/(files.length||1))}}
async function parseResume(file){
  const n=(file.originalname||'').toLowerCase();
  if(/\.(txt|md)$/.test(n))return {text:file.buffer.toString('utf8'),method:'text'};
  const {pdfParse,mammoth,createWorker}=await deps();
  if(n.endsWith('.docx'))return {text:(await mammoth.extractRawText({buffer:file.buffer})).value,method:'docx'};
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'resume-'));
  try{
    if(/\.(png|jpe?g|webp|tiff?)$/.test(n)){const p=path.join(dir,'in'+path.extname(n));await fs.promises.writeFile(p,file.buffer);return {...await ocr([p],createWorker),method:'ocr-image'}}
    if(!n.endsWith('.pdf'))throw new Error('Unsupported file type. Use PDF, DOCX, TXT, PNG or JPG.');
    let text='',pages=0;try{const d=await pdfParse(file.buffer);text=d.text||'';pages=d.numpages}catch{}
    if(text.replace(/\s/g,'').length>=Math.max(150,pages*80))return {text,method:'pdf-text',pages};
    const pdf=path.join(dir,'in.pdf');await fs.promises.writeFile(pdf,file.buffer);
    try{await ex('pdftoppm',['-r','200','-png','-l',String(MAXP),pdf,path.join(dir,'p')])}
    catch(e){throw new Error(e.code==='ENOENT'?'This looks like a scanned PDF. OCR needs poppler installed (Windows: choco install poppler or download poppler and add its bin folder to PATH; Mac: brew install poppler; Linux: apt install poppler-utils).':'Could not render PDF pages: '+e.message)}
    const imgs=(await fs.promises.readdir(dir)).filter(f=>/^p-.*\.png$/.test(f)).sort().map(f=>path.join(dir,f));
    return {...await ocr(imgs,createWorker),method:'pdf-ocr',pages:imgs.length};
  }finally{fs.promises.rm(dir,{recursive:true,force:true}).catch(()=>{})}}
return {parseResume,deps}})();
// ===== Geography: turns messy location strings ("Remote - USA", "Tokyo, Japan", "SF, NYC | Remote (Canada)") into countries, cities, remote scope =====
M.geo=(()=>{
const strip=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
// CODE|Name|aliases|cities|English-speaking (1 = English is the usual business language)
const T=`US|United States|usa,u.s.a.,u.s.,us,america,united states of america|new york city,nyc,new york,san francisco,sf,bay area,san jose,seattle,austin,boston,chicago,los angeles,denver,atlanta,miami,washington dc,washington d.c.,washington,dc,portland,san diego,dallas,houston,pittsburgh,philadelphia,harrisburg,raleigh,salt lake city,boulder,mountain view,palo alto,sunnyvale,menlo park,redwood city,san mateo,foster city,costa mesa,hawthorne,irvine,bastrop,starbase,redmond,bellevue,cape canaveral,santa clara,brooklyn,minneapolis,detroit,nashville,phoenix,charlotte,orlando,tampa,baltimore,pittsburg,lehi,reston,mclean,arlington,huntsville,cambridge ma|1
CA|Canada|canada|toronto,vancouver,montreal,ottawa,calgary,waterloo,edmonton,quebec,halifax,winnipeg,ontario,british columbia,alberta|1
MX|Mexico|mexico,méxico|mexico city,cdmx,guadalajara,monterrey,ciudad de mexico|0
BR|Brazil|brazil,brasil|sao paulo,rio de janeiro,brasilia,curitiba,belo horizonte|0
AR|Argentina|argentina|buenos aires,cordoba ar|0
CL|Chile|chile|santiago,santiago de chile|0
CO|Colombia|colombia|bogota,medellin,cali|0
PE|Peru|peru|lima|0
UY|Uruguay|uruguay|montevideo|0
CR|Costa Rica|costa rica|san jose costa rica|0
PA|Panama|panama|panama city|0
EC|Ecuador|ecuador|quito|0
GB|United Kingdom|uk,u.k.,united kingdom,great britain,britain,england,scotland,wales,northern ireland|london,manchester,edinburgh,bristol,belfast,glasgow,birmingham uk,leeds,cambridge uk,oxford|1
IE|Ireland|ireland,republic of ireland|dublin,cork,galway,limerick|1
FR|France|france|paris,lyon,marseille,toulouse,nice,lille,bordeaux|0
DE|Germany|germany,deutschland|berlin,munich,munchen,hamburg,frankfurt,cologne,stuttgart,dusseldorf,leipzig|0
ES|Spain|spain,espana|madrid,barcelona,valencia,seville,sevilla,malaga,bilbao,zaragoza,palma,alicante,granada,san sebastian,las palmas,tenerife|0
PT|Portugal|portugal|lisbon,lisboa,porto,braga|0
IT|Italy|italy,italia|milan,milano,rome,roma,turin,torino,bologna,florence,naples|0
NL|Netherlands|netherlands,the netherlands,holland|amsterdam,rotterdam,eindhoven,utrecht,the hague,delft|0
BE|Belgium|belgium|brussels,antwerp,ghent|0
LU|Luxembourg|luxembourg|luxembourg city|0
CH|Switzerland|switzerland|zurich,geneva,lausanne,basel,zug,bern|0
AT|Austria|austria|vienna,graz,salzburg|0
SE|Sweden|sweden|stockholm,gothenburg,malmo|0
NO|Norway|norway|oslo,bergen|0
DK|Denmark|denmark|copenhagen,aarhus|0
FI|Finland|finland|helsinki,espoo,tampere|0
IS|Iceland|iceland|reykjavik|0
PL|Poland|poland|warsaw,krakow,wroclaw,gdansk,poznan|0
CZ|Czechia|czech republic,czechia|prague,brno|0
SK|Slovakia|slovakia|bratislava|0
HU|Hungary|hungary|budapest|0
RO|Romania|romania|bucharest,cluj,cluj-napoca|0
BG|Bulgaria|bulgaria|sofia|0
GR|Greece|greece|athens,thessaloniki|0
HR|Croatia|croatia|zagreb|0
SI|Slovenia|slovenia|ljubljana|0
LT|Lithuania|lithuania|vilnius,kaunas|0
LV|Latvia|latvia|riga|0
EE|Estonia|estonia|tallinn,tartu|0
CY|Cyprus|cyprus|nicosia,limassol|0
MT|Malta|malta|valletta|1
UA|Ukraine|ukraine|kyiv,kiev,lviv|0
RS|Serbia|serbia|belgrade|0
TR|Turkey|turkey,turkiye,türkiye|istanbul,ankara|0
IL|Israel|israel|tel aviv,jerusalem,haifa,herzliya,tel aviv-yafo|0
AE|United Arab Emirates|uae,united arab emirates|dubai,abu dhabi|1
SA|Saudi Arabia|saudi arabia,ksa|riyadh,jeddah|0
QA|Qatar|qatar|doha|0
EG|Egypt|egypt|cairo|0
ZA|South Africa|south africa|cape town,johannesburg,pretoria|1
NG|Nigeria|nigeria|lagos,abuja|1
KE|Kenya|kenya|nairobi|1
MA|Morocco|morocco|casablanca,rabat|0
IN|India|india|bengaluru,bangalore,mumbai,delhi,new delhi,gurugram,gurgaon,hyderabad,pune,chennai,noida,kolkata|1
PK|Pakistan|pakistan|karachi,lahore,islamabad|0
BD|Bangladesh|bangladesh|dhaka|0
LK|Sri Lanka|sri lanka|colombo|0
SG|Singapore|singapore|singapore city|1
MY|Malaysia|malaysia|kuala lumpur|0
TH|Thailand|thailand|bangkok|0
VN|Vietnam|vietnam,viet nam|ho chi minh,ho chi minh city,hanoi|0
ID|Indonesia|indonesia|jakarta|0
PH|Philippines|philippines|manila,cebu|1
HK|Hong Kong|hong kong|kowloon|0
TW|Taiwan|taiwan|taipei|0
CN|China|china,prc|beijing,shanghai,shenzhen,hangzhou,guangzhou|0
JP|Japan|japan,nippon|tokyo,osaka,yokohama,nagoya,kyoto,fukuoka,sapporo,kobe,kawasaki|0
KR|South Korea|south korea,korea,republic of korea|seoul,busan,pangyo|0
AU|Australia|australia|sydney,melbourne,brisbane,perth,canberra,adelaide|1
NZ|New Zealand|new zealand|auckland,wellington,christchurch|1`;
const US_STATES={alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york state':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY','district of columbia':'DC'};
const ST_ABBR=new Set(Object.values(US_STATES).concat(['NY'])),CA_PROV=new Set(['ON','BC','AB','QC','NS','MB','NB']);
const AMBIG_ABBR=new Set(['OR','IN','ME','OK','HI','AL','ID','CO','LA','DE','PA','MA','MD','NE']);   // only trusted right after a comma
// region -> member countries
const EU='AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ');
const EUROPE=[...EU,'GB','CH','NO','IS','UA','RS','TR'];
const REGION={eu:EU,europe:EUROPE,emea:[...EUROPE,'AE','SA','QA','IL','EG','ZA','NG','KE','MA'],
  apac:['JP','KR','CN','HK','TW','SG','MY','TH','VN','ID','PH','IN','PK','BD','LK','AU','NZ'],asia:['JP','KR','CN','HK','TW','SG','MY','TH','VN','ID','PH','IN','PK','BD','LK'],
  latam:['MX','BR','AR','CL','CO','PE','UY','CR','PA','EC'],amer:['US','CA','MX','BR','AR','CL','CO','PE','UY','CR','PA','EC'],americas:['US','CA','MX','BR','AR','CL','CO','PE','UY','CR','PA','EC'],
  na:['US','CA'],'north america':['US','CA'],dach:['DE','AT','CH'],nordics:['SE','NO','DK','FI','IS'],anz:['AU','NZ'],'middle east':['AE','SA','QA','IL','EG'],'asia pacific':['JP','KR','CN','HK','TW','SG','MY','TH','VN','ID','PH','IN','AU','NZ'],'uk&i':['GB','IE']};
const WORLD=/\b(worldwide|world[- ]wide|global(?:ly)?|anywhere|international)\b/;
const COUNTRY={},INFO={};            // COUNTRY[code]={name,en,cities:[]}; INFO[alias]={t,code,name}
const put=(alias,o)=>{alias=strip(alias).toLowerCase().trim();if(alias&&!INFO[alias])INFO[alias]=o};
for(const line of T.split('\n')){const [code,name,al,ci,en]=line.split('|');COUNTRY[code]={code,name,en:en==='1',cities:[]};
  put(name,{t:'country',code,name});al.split(',').forEach(a=>put(a,{t:'country',code,name}));
  ci.split(',').forEach(c=>{if(!c)return;const nm=c.length<=4?c.toUpperCase():c.replace(/\b\w/g,x=>x.toUpperCase());COUNTRY[code].cities.push(nm);put(c,{t:'city',code,name:nm})})}
for(const [n,a] of Object.entries(US_STATES))put(n,{t:'state',code:'US',name:n.replace(/\b\w/g,x=>x.toUpperCase()),abbr:a});
['quebec','ontario','british columbia','alberta'].forEach(p=>put(p,{t:'state',code:'CA',name:p.replace(/\b\w/g,x=>x.toUpperCase())}));
INFO['san jose']={t:'city',code:'US',name:'San Jose'};INFO['new york']={t:'city',code:'US',name:'New York'};
const keys=Object.keys(INFO).sort((a,b)=>b.length-a.length);
const RE=new RegExp('(?<![a-z0-9])('+keys.map(k=>k.replace(/[.+*?^${}()|[\]\\\/]/g,'\\$&')).join('|')+')(?![a-z0-9])','g');
const REGRE=new RegExp('(?<![a-z0-9])('+Object.keys(REGION).sort((a,b)=>b.length-a.length).map(k=>k.replace(/[.+*?^${}()|[\]\\\/&]/g,'\\$&')).join('|')+')(?![a-z0-9])','g');
const REMOTE=/\b(remote|work from home|wfh|telecommut\w*|distributed|virtual|anywhere)\b/,HYBRID=/\bhybrid\b/,ONSITE=/\b(on-?site|in-?office|office|in person|hq)\b/;
// one location segment -> facts
function seg(text){const orig=String(text),s=strip(orig).toLowerCase(),codes=new Set(),cities=[],states=[];
  for(const m of s.matchAll(RE)){const i=INFO[m[1]];codes.add(i.code);if(i.t==='city')cities.push(i.name);if(i.t==='state')states.push(i.name)}
  // two-letter US state / Canadian province codes ("Boston, MA", "Toronto, ON")
  for(const m of orig.matchAll(/(?:,\s*|\s-\s|\bUS-|\()([A-Z]{2})(?![A-Za-z])/g)){const a=m[1];
    if(CA_PROV.has(a)&&!/\bUS\b/.test(orig)&&!ST_ABBR.has(a)){codes.add('CA')}
    else if(ST_ABBR.has(a)&&(!AMBIG_ABBR.has(a)||/,\s*[A-Z]{2}\b/.test(m[0])||codes.has('US'))){if(a==='CA'&&codes.size&&!codes.has('US')&&/canada/.test(s))continue;if(a==='DE'&&codes.has('DE'))continue;codes.add('US');states.push(a)}}
  const regions=[...s.matchAll(REGRE)].map(m=>m[1]);
  return {text:orig.trim(),codes:[...codes],cities,states,regions,world:WORLD.test(s),remote:REMOTE.test(s)||/remote-?friendly/.test(s),hybrid:HYBRID.test(s),onsite:ONSITE.test(s)&&!REMOTE.test(s)&&!HYBRID.test(s)}}
function parse(loc){const segs=String(loc||'').replace(/\([^)]*\)/g,m=>m.replace(/\s*(?:\||;|\s\/\s|\bor\b)\s*/g,', ')).split(/\s*(?:\||;|\s\/\s)\s*|\s+(?:or|Or)\s+/).map(x=>x.trim()).filter(Boolean).map(seg);return segs}
const expand=(codes,regions)=>{const o=new Set(codes||[]);for(const r of regions||[])(REGION[r]||[]).forEach(c=>o.add(c));return o};
const find=q=>{q=strip(q).toLowerCase().trim();const i=INFO[q];return i||null};
const countryName=c=>COUNTRY[c]?.name||c;
return {parse,seg,expand,find,INFO,COUNTRY,REGION,countryName,strip,ST_ABBR,US_STATES}})();
// ===== Enrichment: derives structured facts from each posting (work mode, remote scope, visa, relocation, languages, skills, level...) =====
// Everything here is computed from the posting's own text/fields. Nothing is invented: unknown stays unknown ('' / null).
M.enrich=(()=>{
const G=M.geo,VERSION=3;
const CATS=['Software Engineering','Data & AI','Security','IT & Support','Customer Support','Product','Design','Marketing','Sales','Operations','Finance','Legal','People','Hardware & Manufacturing','Other'];
// ---- skills dictionary (canonical: aliases). Matching is token based, so "Java" never matches "JavaScript" ----
const SKILL_SRC=`JavaScript:javascript,js,ecmascript|TypeScript:typescript|Python:python|Java:java|Golang:golang|Rust:rust|C++:c++,c/c++|C#:c#|Ruby:ruby|Ruby on Rails:rails,ruby on rails|PHP:php|Swift:swift|Kotlin:kotlin|Scala:scala|SQL:sql|NoSQL:nosql|PostgreSQL:postgresql,postgres|MySQL:mysql|MongoDB:mongodb|Redis:redis|Elasticsearch:elasticsearch,elk|Kafka:kafka|Spark:spark,pyspark,apache spark|Snowflake:snowflake|Databricks:databricks|dbt:dbt|Airflow:airflow|BigQuery:bigquery|React:react,react.js,reactjs|Angular:angular|Vue:vue,vue.js|Next.js:next.js,nextjs|Node.js:node.js,nodejs,node|Django:django|Flask:flask|FastAPI:fastapi|Spring:spring boot,spring|.NET:.net,dotnet|GraphQL:graphql|REST APIs:rest,restful,rest api,rest apis|HTML/CSS:html,css,html5,css3|AWS:aws,amazon web services|GCP:gcp,google cloud|Azure:azure|Kubernetes:kubernetes,k8s|Docker:docker|Terraform:terraform|Ansible:ansible|Jenkins:jenkins|CI/CD:ci/cd,cicd,continuous integration|Linux:linux|Git:git,github,gitlab|Bash/Shell:bash,shell scripting|PowerShell:powershell|Microservices:microservices|System Design:system design,distributed systems|Machine Learning:machine learning,ml|Deep Learning:deep learning|LLMs:llm,llms,large language models|Generative AI:generative ai,genai,gen ai,chatgpt,copilot,claude code|Prompt Engineering:prompt engineering,prompting|NLP:nlp,natural language processing|PyTorch:pytorch|TensorFlow:tensorflow|Pandas:pandas|NumPy:numpy|scikit-learn:scikit-learn,sklearn|Statistics:statistics,statistical|Data Analysis:data analysis,data analytics,analytics|Data Visualization:data visualization,dashboards|Tableau:tableau|Power BI:power bi,powerbi|Looker:looker|Excel:excel|SIEM:siem|Splunk:splunk|Microsoft Sentinel:sentinel,microsoft sentinel,azure sentinel|KQL:kql|Wireshark:wireshark|Snort:snort|Nmap:nmap|Metasploit:metasploit|Burp Suite:burp suite,burp|Incident Response:incident response,incident handling|Threat Hunting:threat hunting|Threat Intelligence:threat intelligence,cti|Malware Analysis:malware analysis,reverse engineering|Penetration Testing:penetration testing,pentest,pentesting,pen testing,red team|Vulnerability Management:vulnerability management,vulnerability assessment,vulnerability scanning|EDR:edr,endpoint detection|SOC:soc,security operations|Digital Forensics:forensics,dfir|IAM:iam,identity and access management|Zero Trust:zero trust|Cloud Security:cloud security|Application Security:appsec,application security|GRC:grc,governance risk and compliance|NIST:nist|ISO 27001:iso 27001,iso/iec 27001,iso27001|SOC 2:soc 2,soc2|CMMC:cmmc|PCI DSS:pci,pci dss|Risk Assessment:risk assessment,risk management|Firewalls:firewall,firewalls,palo alto|Networking:networking,tcp/ip,dns,bgp,routing|Cybersecurity:cybersecurity,cyber security,information security,infosec|ServiceNow:servicenow|Jira:jira|Active Directory:active directory,entra,azure ad|Windows:windows|macOS:macos,mac os|Help Desk:help desk,helpdesk,service desk|Troubleshooting:troubleshooting|ITIL:itil|Technical Support:technical support|Product Management:product management,product manager|Roadmapping:roadmap,roadmapping|Agile:agile|Scrum:scrum|Project Management:project management,program management|Stakeholder Management:stakeholder management,stakeholders|A/B Testing:a/b testing,experimentation|Figma:figma|UX Research:user research,ux research|Prototyping:prototyping,wireframing|Design Systems:design systems|SEO:seo|Content Marketing:content marketing,content strategy|Email Marketing:email marketing|Social Media:social media|Paid Media:paid media,ppc,google ads,paid search|Marketing Analytics:marketing analytics|Google Analytics:google analytics|Salesforce:salesforce|HubSpot:hubspot|CRM:crm|Account Management:account management|Sales:sales,selling|Customer Success:customer success|Negotiation:negotiation|Financial Modeling:financial modeling,financial modelling|Accounting:accounting,gaap|FP&A:fp&a|Forecasting:forecasting|Budgeting:budgeting|Recruiting:recruiting,sourcing,talent acquisition|Supply Chain:supply chain|Legal Research:legal research|Contract Negotiation:contract negotiation|Public Speaking:public speaking|Technical Writing:technical writing,documentation|Mentoring:mentoring,mentorship|Leadership:leadership,people management,managing teams|Embedded Systems:embedded|CAD:cad,solidworks|PLC:plc|API Design:api design,apis|Cloudflare:cloudflare|Observability:observability,monitoring|SRE:sre,site reliability|Testing:unit testing,test automation,qa automation,selenium`;
const ALIAS=new Map(),CANON=new Set();
for(const e of SKILL_SRC.split('|')){const [c,al]=e.split(':');CANON.add(c);ALIAS.set(c.toLowerCase(),c);al.split(',').forEach(a=>ALIAS.set(a,c))}
// related skills give partial (transferable) credit
const FAMILIES=[['SIEM','Splunk','Microsoft Sentinel','KQL','Elasticsearch','SOC','Threat Hunting','Incident Response','EDR','Digital Forensics','Threat Intelligence'],
 ['JavaScript','TypeScript','Node.js','React','Angular','Vue','Next.js','HTML/CSS'],['AWS','GCP','Azure','Cloud Security'],['Kubernetes','Docker','Terraform','Ansible','CI/CD','Jenkins','SRE','Observability','Linux'],
 ['Python','Pandas','NumPy','scikit-learn','Machine Learning','Data Analysis','Statistics'],['SQL','PostgreSQL','MySQL','BigQuery','Snowflake','NoSQL','MongoDB','dbt','Databricks'],
 ['Wireshark','Nmap','Snort','Networking','Firewalls','Metasploit','Penetration Testing','Burp Suite'],['ServiceNow','Jira','Help Desk','ITIL','Technical Support','Troubleshooting','Active Directory','Windows','macOS'],
 ['NIST','ISO 27001','SOC 2','CMMC','GRC','PCI DSS','Risk Assessment','Zero Trust'],['LLMs','Prompt Engineering','Generative AI','NLP','Machine Learning','Deep Learning','PyTorch','TensorFlow'],
 ['Java','Kotlin','Scala','C#','.NET','Spring'],['C++','Rust','Golang','Embedded Systems'],['Tableau','Power BI','Looker','Excel','Data Visualization'],['Agile','Scrum','Project Management','Roadmapping','Stakeholder Management','Product Management'],
 ['Application Security','Vulnerability Management','Penetration Testing','Cloud Security','IAM','Cybersecurity'],['Salesforce','HubSpot','CRM','Account Management','Customer Success','Sales'],['SEO','Content Marketing','Email Marketing','Social Media','Paid Media','Google Analytics','Marketing Analytics']];
const FAM=new Map();FAMILIES.forEach((f,i)=>f.forEach(s=>{if(!FAM.has(s))FAM.set(s,[]);FAM.get(s).push(i)}));
const related=(a,b)=>a!==b&&(FAM.get(a)||[]).some(i=>(FAM.get(b)||[]).includes(i));
const FIRST=new Set();for(const k of ALIAS.keys())if(k.includes(' '))FIRST.add(k.split(' ')[0]);
const TOK=/[a-z0-9.+#&\/][a-z0-9.+#&\/-]*/g,TRIM=/[.\/&-]+$/;
function skillsIn(text){const out=new Set();const t=String(text).toLowerCase().match(TOK);if(!t)return [];
  for(let i=0;i<t.length;i++){let w=t[i];if(TRIM.test(w))w=w.replace(TRIM,'')||'-';let a=ALIAS.get(w);if(a)out.add(a);
    if(FIRST.has(w)&&i+1<t.length){const w2=t[i+1].replace(TRIM,'');a=ALIAS.get(w+' '+w2);if(a)out.add(a);
      if(i+2<t.length){a=ALIAS.get(w+' '+w2+' '+t[i+2].replace(TRIM,''));if(a)out.add(a)}}
    if(w.includes('/')){for(const p of w.split('/')){a=ALIAS.get(p);if(a)out.add(a)}}}
  return [...out]}
// ---- section splitting of a posting ----
const H={resp:/^\W*(what you['’]ll do|what you will do|responsibilities|key responsibilities|the role|your role|in this role|about the role|the job|day[- ]to[- ]day|what you['’]ll be doing|your impact|role overview|job description|what you['’]ll own|you will)\b/i,
 req:/^\W*(what you['’]ll need|requirements|qualifications|minimum qualifications|basic qualifications|required qualifications|who you are|what we['’]re looking for|about you|you have|must haves?|what you bring|your background|skills (&|and) experience|required skills|ideal candidate|you['’]ll bring|we['’]re looking for|you might be a good fit|what makes you a fit|key qualifications)\b/i,
 pref:/^\W*(preferred qualifications|preferred skills|preferred experience|nice[- ]to[- ]haves?|bonus points|bonus|extra credit|it['’]s a plus|a plus|great to have|would be a plus|what would make you stand out|you might also have|plus points|additional qualifications|ideally|preferred)\b/i,
 other:/^\W*(about (us|the company|[a-z0-9 ]{2,30})|who we are|our mission|why join|benefits|perks|compensation|what we offer|salary|pay transparency|equal opportunity|our values|life at|how we work|our culture|location)\b/i};
const PREFCUE=/\b(preferred|nice to have|nice-to-have|bonus|a plus|is a plus|are a plus|ideally|would be (great|nice|a plus)|advantage|desirable|an asset|beneficial)\b/i;
function sections(desc){const S={resp:[],req:[],pref:[],about:[]};let cur='about';
  for(let line of String(desc||'').split('\n')){line=line.replace(/^[\s•\-*·▪●○]+/,'').trim();if(!line)continue;
    const bullet=/^[•\-*·]/.test(line);
    if(line.length<90&&!/[.;]$/.test(line)||/:$/.test(line)&&line.length<90){let h=null;for(const k of ['pref','req','resp','other'])if(H[k].test(line)){h=k;break}
      if(h){cur=h==='other'?'about':h;continue}}
    S[PREFCUE.test(line)&&cur!=='resp'?'pref':cur].push(line)}
  if(!S.req.length&&S.resp.length)S.req=[];return S}
// ---- patterns ----
const SENT=t=>String(t||'').split(/(?<=[.!?])\s+|\n+/);
const VISA_NEG=[/(unable|not able|cannot|can['’]t|won['’]t|will not|do(es)? not|don['’]t|not)\s+(\w+\s+){0,3}?(provide|offer|support|sponsor)\w*\s+(\w+\s+){0,3}?(visa|sponsorship|work (permit|authori[sz]ation)|immigration)/i,
 /(visa|sponsorship|immigration)[^.]{0,40}\b(is not|isn['’]t|not|unavailable)\b[^.]{0,25}(available|provided|offered|supported)/i,/\bno (visa|sponsorship)/i,/(unable|not able|cannot|will not|not) (to )?sponsor\b/i,/without (the need for )?(visa )?sponsorship|without requiring sponsorship|not (offer|provide) (visa )?sponsorship/i,/sponsorship (is )?not (offered|available|provided)/i];
const VISA_POS=[/(visa|work permit|immigration|work authori[sz]ation)\s+(sponsorship|support|assistance|help)\s+(is |are |will be |may be |can be )?(available|provided|offered|supported|possible|included)/i,
 /\b(we|company|will|can|may|able to)\s+(offer\s+|provide\s+)?(sponsor|support|assist)s?\s+(\w+\s+){0,2}?(visas?|work permits?|work authori[sz]ation)/i,/(offer|provide|including|includes|with|eligible for)\s+(\w+\s+){0,3}?(visa|immigration)\s+(sponsorship|support|assistance)/i,
 /relocation[^.]{0,40}\b(visa|immigration)\b|\b(visa|immigration)\b[^.]{0,40}relocation/i,/sponsor(ship)?\s+(is\s+|will be\s+)?(available|provided)\b/i,/(visa|work permit)s? (will be |can be )?(arranged|handled|sponsored)/i,/we (do )?sponsor (work )?visas/i];
const REL_POS=[/relocation\s+(assistance|support|package|benefits?|allowance|bonus|stipend|expenses?|budget|help|services|coverage|reimbursement|program|is available|is offered|is provided|packages)/i,/(offer|provide|including|eligible for|receive|with)\s+(\w+\s+){0,3}?relocation\b/i,/(help|assist|support)s?\s+(\w+\s+){0,4}?(with\s+)?(your\s+)?relocat/i,/sponsor you for relocation/i,/relocation (to|for) (those|candidates|the right)/i,/relocat\w*[^.]{0,40}(is available|will be (provided|covered)|can be provided)/i];
const REL_NEG=[/\b(no|not|without)\s+(\w+\s+){0,3}?relocation/i,/relocation[^.]{0,30}\b(not|isn['’]t|unavailable)\b/i,/not (offering|providing|eligible for|able to (support|offer))[^.]{0,20}relocation/i,/not eligible for relocation|will not be provided|no visa\/relocation/i];
const COUNTRY_SPECIFIC=/(to the attention of|candidates (of|in|from|based in)|applicants (in|from|based in)|if you are (based|located) in)\b/i;
const WORLD_DESC=/\b(work from anywhere|anywhere in the world|(open|available) to candidates (globally|worldwide|anywhere)|hir(e|ing) (globally|worldwide|anywhere)|globally distributed|regardless of (your )?(location|where you live)|from any(where| location)|any location worldwide|work remotely from (any|anywhere))\b/i;
const RESTRICT_DESC=/\b(must|need to|required to|should|have to)\s+(be\s+)?(located|based|reside|residing|live|living|resident)\s+(in|within|inside)\s+(the\s+)?([^.;\n]{2,70})/i;
const AUTH_DESC=/(authori[sz]ed|eligible|legally entitled|right) to work in (the )?(united states|u\.?s\.?a?\.?|canada|united kingdom|uk|spain|japan|germany|ireland|australia)\b/i;
const INTL_WELCOME=/(international (candidates|applicants)|applicants? from (all|any|around)|candidates? from (all|any|around)|we (welcome|encourage) applicants? from|open to (candidates|applicants) (worldwide|globally|from anywhere)|global talent|regardless of (nationality|citizenship))/i;
const LANGS={es:'spanish|español|castellano',ja:'japanese|nihongo',fr:'french|français',de:'german|deutsch',pt:'portuguese|brazilian portuguese',it:'italian',zh:'mandarin|chinese|cantonese',ko:'korean',nl:'dutch',ar:'arabic',hi:'hindi',ru:'russian',pl:'polish',sv:'swedish',tr:'turkish',he:'hebrew'};
const LRE=Object.entries(LANGS).map(([k,v])=>[k,new RegExp('\\b('+v+')\\b','i')]);
const LCUE=/(fluen|proficien|native|bilingual|multilingual|trilingual|speak|spoken|written|language|command of|business[- ]level|conversational|mandatory|required|must|ability to (read|write|speak)|communicat|verbal)/i;
const LDEPTH=[[/native|fluen|business[- ]level|high professional|professional (working )?(proficiency|fluency)|mother tongue|full professional|advanced|excellent|superior/i,'f'],[/conversational|intermediate|working knowledge|good command|strong/i,'c'],[/basic|elementary|beginner/i,'b']];
const CERTS={'Security+':/security\+|comptia security/i,'CISSP':/\bcissp\b/i,'CISM':/\bcism\b/i,'CEH':/\bceh\b|certified ethical hacker/i,'OSCP':/\boscp\b/i,'GIAC':/\bgiac\b|\bgsec\b|\bgcih\b|\bgcia\b/i,'CCNA':/\bccna\b/i,'Network+':/network\+/i,'A+':/\ba\+\b/i,'AWS Certified':/aws certified|aws certification/i,'Azure Cert':/\b(az|sc|ms)-\d{3}\b|azure certif/i,'PMP':/\bpmp\b/i,'CPA':/\bcpa\b/i,'ITIL':/itil (v4 )?(foundation|certif)/i,'CISA':/\bcisa\b/i,'Scrum Master':/scrum master|\bcsm\b/i};
const CLEAR=/\b(ts\/sci|top secret|secret clearance|security clearance|active clearance|dod clearance|public trust|clearance (is )?required)\b/i;
const STOPW=new Set(('this that with from your will have about their they them were been being into over under also more most such other than then when where which while what who whom whose these those there here would could should must can may might shall able within across including include includes experience experienced work working works role roles team teams strong skills skill ability abilities years year plus preferred required requirements responsibilities responsible company companies position positions job jobs candidate candidates people person looking join help helps need needs make making build building like just well best good great high highly very real time every each both many much best new our you your us we the and for are not all any can able etc using use used based related relevant knowledge understanding excellent proven demonstrated opportunity opportunities environment business customers customer product products service services solutions solution support part full day days week month benefits equal employer status').split(' '));
function keywords(text){const c=new Map();for(const w of String(text).toLowerCase().match(/[a-z][a-z-]{3,}/g)||[]){const k=w.length>5&&w.endsWith('s')&&!w.endsWith('ss')?w.slice(0,-1):w;if(STOPW.has(k)||STOPW.has(w))continue;c.set(k,(c.get(k)||0)+1)}
  return [...c.entries()].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length).slice(0,24).map(x=>x[0])}
// ---- classification ----
const CAT_RULES=[['Hardware & Manufacturing',/\b(mechanical|electrical|manufactur\w*|propulsion|avionics|hardware|machinist|welder|assembly|aerospace|rf engineer|mechatronic|production (operator|technician|associate|supervisor)|quality (engineer|technician)|test engineer|materials|chemical|process engineer|fabricat\w*|operator|technician|structures|thermal|gnc|flight)\b/i],
 ['Customer Support',/\b(customer (success|support|experience|care|operations)|support (specialist|agent|representative|associate|engineer|analyst)|technical support|technical account manager|client (success|services)|implementation (specialist|manager|consultant)|onboarding|solutions? support|support engineer|care)\b/i],
 ['Sales',/\b(sales|account (executive|manager|director)|business development|bdr|sdr|partnerships?|solutions? (engineer|architect|consultant)|revenue|go[- ]to[- ]market|gtm|channel|alliances|presales|pre-sales|customer engineer|enterprise (account|sales))\b/i],
 ['Security',/\b(security|cyber\w*|infosec|soc analyst|threat|incident response|pentest|penetration|vulnerab\w*|appsec|devsecops|grc|detection|forensic\w*|malware|red team|blue team|identity|iam)\b/i],
 ['Data & AI',/\b(data (scientist|analyst|engineer|science|analytics|platform|infrastructure)|machine learning|ml\b|ai\b|research (scientist|engineer)|analytics|applied scientist|deep learning|nlp|llm|bi (developer|analyst)|business intelligence|statistician|quant\w*|data)\b/i],
 ['IT & Support',/\b(it (support|specialist|analyst|technician|manager|operations|administrator|engineer)|help ?desk|service desk|systems? admin\w*|sysadmin|desktop|network (engineer|admin\w*)|endpoint|corporate it|workplace technology|it\b)/i],
 ['Marketing',/\b(marketing|growth|seo|content|brand|communications?|public relations|social media|copywriter|community|events?|demand gen|lifecycle|campaign|editor|writer|pr\b)\b/i],
 ['Design',/\b(designer|ux|ui\b|product design|visual|creative|graphic|illustrat\w*|art director|motion)\b/i],
 ['Product',/\b(product (manager|owner|lead|director|operations|analyst|management)|program manager|technical program|tpm|head of product|product)\b/i],
 ['Software Engineering',/\b(software|engineer\w*|developer|programmer|swe|backend|back-end|frontend|front-end|full[- ]?stack|devops|sre|site reliability|platform|infrastructure|mobile|ios|android|firmware|embedded|architect|qa|sdet|test automation|web)\b/i],
 ['People',/\b(recruit\w*|talent|people (partner|operations|business|team|programs)|hr\b|human resources|benefits|compensation|learning (&|and) development|l&d|sourcer)\b/i],
 ['Finance',/\b(financ\w*|accountant|accounting|fp&a|controller|treasury|tax|payroll|audit\w*|billing|credit|underwrit\w*|actuar\w*)\b/i],
 ['Legal',/\b(counsel|legal|attorney|paralegal|privacy|regulatory|government affairs|contracts?|policy)\b/i],
 ['Operations',/\b(operations?|ops\b|supply chain|logistics|procurement|coordinator|business (analyst|partner)|strategy|chief of staff|facilit\w*|workplace|real estate|planner|administrat\w*|executive assistant|compliance|risk|trust (&|and) safety|fraud|investigat\w*)\b/i]];
function categorize(title){const t=title.replace(/\s*[-–—|,(].*$/,'').trim()||title,all=title;const hits=[];
  if(/product marketing/i.test(all))hits.push('Marketing');
  if(/\b(sales|solutions?|customer|field|forward deployed) (engineer|architect)\b/i.test(all))hits.push('Sales','Software Engineering');
  if(/\b(security|cyber\w*|infosec|threat)\b/i.test(all)&&/\bengineer|developer|architect\b/i.test(all))hits.push('Security','Software Engineering');
  if(/\b(data|machine learning|ml|ai)\b/i.test(all)&&/\bengineer|developer\b/i.test(all)&&!hits.length)hits.push('Data & AI','Software Engineering');
  for(const [c,re] of CAT_RULES)if((re.test(t)||re.test(all))&&!hits.includes(c))hits.push(c);
  return hits.length?hits.slice(0,2):['Other']}
const SENIOR_RE=/\b(senior|sr)\b\.?/i,LEAD_RE=/\b(staff|principal|distinguished|head of|director|vp|vice president|chief|lead|fellow|engineering manager|manager of|group (product )?manager|general manager)\b/i,ENTRY_RE=/\b(entry[- ]level|graduate|new grad|early career|early talent|apprentice|trainee|campus|university (grad|hire)|recent grad)\b/i,JUNIOR_RE=/\b(junior|jr|associate)\b\.?/i,INTERN_RE=/\b(intern|internship|co-?op|working student|werkstudent|stagiaire|praktikum)\b/i;
function levelOf(title,yrs,type){if(INTERN_RE.test(title)||type==='Internship')return 'intern';
  if(ENTRY_RE.test(title))return 'entry';if(LEAD_RE.test(title))return 'lead';if(SENIOR_RE.test(title))return 'senior';
  if(JUNIOR_RE.test(title)&&!/associate (director|principal|vice)/i.test(title))return 'junior';
  const r=/\b(i|1)$/i.test(title.trim())?'junior':/\b(ii|2)$/i.test(title.trim())?'mid':/\b(iii|3)$/i.test(title.trim())?'senior':/\b(iv|v|4|5)$/i.test(title.trim())?'lead':null;if(r)return r;
  if(yrs==null)return 'mid';return yrs>=8?'senior':yrs>=3?'mid':yrs>=1?'junior':'entry'}
const LV_YEARS={intern:0,entry:0,junior:1,mid:3,senior:6,lead:9};
const YRS=/(\d{1,2})\s*(?:\+|\s?(?:-|–|to)\s?\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/gi;
function yearsOf(lines){let best=null;for(const l of lines){if(/years? (old|ago)|founded|since \d{4}|for over \d+ years|in business|history/i.test(l))continue;
  if(!/(experience|expertise|background|working|work\b|professional|in the field|hands-on|track record|as an?\b|industry)/i.test(l))continue;
  for(const m of l.matchAll(YRS)){const n=+m[1];if(n>=1&&n<=15&&(best==null||n>best))best=n}}return best}
function degreeOf(lines){let d=0,eq=false;for(const l of lines){const s=l.toLowerCase();
  if(/ph\.?d|doctorate|doctoral/.test(s))d=Math.max(d,4);else if(/master|\bm\.?s\.?c?\b|\bmba\b|graduate degree/.test(s))d=Math.max(d,3);
  else if(/bachelor|\bb\.?s\.?c?\b|\bb\.?a\.?\b|undergraduate degree|university degree|college degree|4[- ]year degree|degree in|equivalent degree/.test(s))d=Math.max(d,2);else if(/associate'?s degree|diploma/.test(s))d=Math.max(d,1);
  if(/(or )?(equivalent|comparable|related)\s+(practical |work |professional |hands-on |industry )?(experience|education|training)|or equivalent|or relevant experience/.test(s))eq=true}return {d,eq}}
const ANYLANG=new RegExp('\\b('+Object.values(LANGS).join('|')+')\\b','i');
function langsOf(text){if(!ANYLANG.test(text))return [];const out=[];const seen=new Set();
  for(const s of SENT(text.slice(0,9000))){if(s.length>500||!ANYLANG.test(s)||!(LCUE.test(s)||PREFCUE.test(s)))continue;const found=LRE.filter(([k,re])=>re.test(s)).map(([k])=>k);if(!found.length)continue;
    if(/(market|users|customers|clients|team in|speaking (south america|markets|countries|users|customers))/i.test(s)&&!/(fluen|proficien|native|must|required|mandatory)/i.test(s))continue;
    const pref=PREFCUE.test(s),alt=found.length>1&&/\b(or|either|one of|any of)\b/i.test(s);let depth=null;for(const [re,d] of LDEPTH)if(re.test(s)){depth=d;break}
    for(const k of found){const key=k+(pref?'p':'r');if(seen.has(key))continue;seen.add(key);out.push({l:k,r:pref?0:1,d:depth||(pref?'c':'f'),alt:alt?1:0})}}
  return out}
function visaOf(text){if(!/visa|sponsor|work permit|immigration|work authori/i.test(text))return '';let pos=0,neg=0;for(const s of SENT(text)){if(s.length>600||!/visa|sponsor|work permit|immigration|work authori/i.test(s))continue;if(COUNTRY_SPECIFIC.test(s)||/export|exec\w* sponsor|event|sponsored (media|content)/i.test(s))continue;
  if(VISA_NEG.some(r=>r.test(s)))neg++;else if(VISA_POS.some(r=>r.test(s)))pos++}return pos&&!neg?'y':neg&&!pos?'n':''}
function relocOf(text){if(!/relocat/i.test(text))return '';let pos=0,neg=0;for(const s of SENT(text)){if(s.length>600||!/relocat/i.test(s))continue;if(COUNTRY_SPECIFIC.test(s))continue;
  if(REL_NEG.some(r=>r.test(s)))neg++;else if(REL_POS.some(r=>r.test(s)))pos++}return pos&&!neg?'y':neg&&!pos?'n':''}
function evidence(text){const o={};text=String(text||'').slice(0,9000);
  for(const s of SENT(text)){if(s.length>600||s.length<12)continue;
    if(!o.visa&&/visa|sponsor|work permit|immigration|work authori/i.test(s)&&!COUNTRY_SPECIFIC.test(s)&&!/export|exec\w* sponsor|event/i.test(s)&&(VISA_POS.some(r=>r.test(s))||VISA_NEG.some(r=>r.test(s))))o.visa=s.trim().slice(0,260);
    if(!o.reloc&&/relocat/i.test(s)&&!COUNTRY_SPECIFIC.test(s)&&(REL_POS.some(r=>r.test(s))||REL_NEG.some(r=>r.test(s))))o.reloc=s.trim().slice(0,260);
    if(!o.intl&&INTL_WELCOME.test(s))o.intl=s.trim().slice(0,260);
    if(!o.remote&&(WORLD_DESC.test(s)||RESTRICT_DESC.test(s)||AUTH_DESC.test(s)))o.remote=s.trim().slice(0,260)}
  return o}
const IND_BY_BOARD=(()=>{const m={};const add=(ind,list)=>list.split(',').forEach(b=>m[b]=ind);
 add('Cybersecurity','sentinelone,snyk,wizinc,wiz,abnormalsecurity,tanium,huntress,expel,axonius,netskope,drata,vanta,1password,cribl,sumologic,rapid7,tenable,okta,crowdstrike,zscaler,cyberark,proofpoint,recordedfuture,bitsight,securityscorecard,arcticwolf,cohesity,rubrik,illumio,lacework,orcasecurity,cyera,armis,semperis,socure,sardine,chainguard,bugcrowd,hackerone,synack,veracode,sonatype,sailpoint,beyondtrust,delinea,pingidentity,darktrace,trellix,claroty,dragos,nozominetworks,coalitioninc,sophos,mimecast,knowbe4,secureworks,vectra,exabeam,blumira,immersivelabs,contrastsecurity,teleport,cloudflare');
 add('Fintech','coinbase,robinhood,affirm,brex,carta,gusto,plaid,chime,sofi,block,mercury,circle,kraken,gemini,chainalysis,ramp,stripe,nerdwallet,toast,deel,rippling');
 add('AI','openai,anthropic,cohere,perplexity,scaleai,harvey,elevenlabs,huggingface,weightsandbiases,anyscale,together,replit,glean,mistral,cursor,databricks');
 add('Healthcare & Biotech','doximity,veeva,hims,benchling');add('Education','coursera,udemy,duolingo');
 add('Aerospace & Robotics','spacex,anduril,andurilindustries,aurorainnovation,geckorobotics,astrobotic,carnegierobotics,palantir');
 add('Travel & Marketplaces','airbnb,doordash,instacart,lyft,etsy,peloton,flexport');return m})();
let FX={USD:1};
const toUSDk=(sal,cur)=>{if(!sal)return null;const r=FX[cur||'USD'];if(!r)return cur&&cur!=='USD'?null:sal;const v=sal/r;return v>0&&v<1500?Math.round(v):null};
function modeOf(j,segs){let rem=0,hyb=0,ons=0;for(const s of segs){if(s.remote)rem=1;if(s.hybrid)hyb=1;if(s.onsite)ons=1}
  const d=(j.desc||'').slice(0,6000),explicit=j.mode;   // explicit = the board's own workplaceType (Ashby/Lever), the most reliable signal
  if(explicit==='remote')rem=1;else if(explicit==='hybrid')hyb=1;else if(explicit==='onsite')ons=1;
  else if(j.remote&&j.source==='Lever')rem=1;   // older saved Lever data: its remote flag came from workplaceType
  if(!rem&&!hyb&&!ons){
    if(/\b(fully remote|100% remote|remote[- ]first|this is a remote (role|position|opportunity)|remote position|remote-eligible|work remotely|remote[- ]friendly)\b/i.test(d)&&!segs.some(s=>s.cities.length))rem=1;
    else if(/\bhybrid\b/i.test(d)&&/(\d\s*days|in[- ]office|in[- ]person|hybrid (work|role|model|schedule|position))/i.test(d))hyb=1;else ons=1}
  return (rem?1:0)|(hyb?2:0)|(ons?4:0)}
function remoteScope(j,segs,modes){if(!(modes&1))return {rs:'',rc:[],rg:[]};
  const rsegs=segs.filter(s=>s.remote);let codes=new Set(),regs=new Set(),world=false;
  for(const s of rsegs){s.codes.forEach(c=>codes.add(c));s.regions.forEach(r=>regs.add(r));if(s.world)world=true}
  if(!rsegs.length){segs.forEach(s=>s.codes.forEach(c=>codes.add(c)))}   // flagged remote by the board but location text says only a country
  if(world)return {rs:'w',rc:[],rg:[]};
  if(codes.size)return {rs:'c',rc:[...codes],rg:[...regs]};if(regs.size)return {rs:'r',rc:[],rg:[...regs]};
  const d=(j.desc||'').slice(0,8000);
  if(WORLD_DESC.test(d))return {rs:'w',rc:[],rg:[]};
  const m=RESTRICT_DESC.exec(d);if(m){const sg=G.seg(m[6]);if(sg.codes.length||sg.regions.length)return {rs:sg.codes.length?'c':'r',rc:sg.codes,rg:sg.regions}}
  const a=AUTH_DESC.exec(d);if(a){const sg=G.seg(a[3]);if(sg.codes.length)return {rs:'c',rc:sg.codes,rg:[]}}
  const tail=String(j.title||'').split(/\s[-–—|]\s|,\s|\(/).slice(1).join(' ');if(tail){const sg=G.seg(tail);if(sg.codes.length)return {rs:'c',rc:sg.codes,rg:[]}}
  return {rs:'u',rc:[],rg:[]}}
function enrich(j){const segs=G.parse(j.loc),desc=j.desc||'',text=desc.slice(0,9000),title=j.title||'';
  const modes=modeOf(j,segs),rem=remoteScope(j,segs,modes),cc=new Set();
  for(const s of segs)if(!s.remote||!(modes&1)||true)s.codes.forEach(c=>cc.add(c));
  const sec=sections(desc),hasReq=sec.req.length>0;
  const reqLines=hasReq?sec.req:[...sec.resp,...sec.about.filter(l=>l.length<400)].slice(0,80);
  let req=new Set(skillsIn(title)),prf=new Set();
  for(const l of reqLines)skillsIn(l).forEach(s=>req.add(s));for(const l of sec.pref)skillsIn(l).forEach(s=>{if(!req.has(s))prf.add(s)});
  if(hasReq)for(const l of sec.resp.concat(sec.about.filter(l=>l.length<250)))for(const s of skillsIn(l))if(!req.has(s)&&!prf.has(s))prf.add(s);   // mentioned only in duties: weaker evidence
  const yrs=yearsOf(reqLines.concat(hasReq?[]:sec.pref.length?[]:[])),dg=degreeOf(hasReq?sec.req:reqLines),dp=degreeOf(sec.pref);
  const ctype=j.type&&j.type!=='Unspecified'?j.type:INTERN_RE.test(title)?'Internship':/\b(contract(or)?|temporary|fixed[- ]term|freelance)\b/i.test(title)?'Contract':/\bpart[- ]time\b/i.test(title)?'Part-time':'Unspecified';
  const lv=levelOf(title,yrs,ctype),langs=langsOf(text),visa=visaOf(text),reloc=relocOf(text);
  const certs=Object.entries(CERTS).filter(([k,re])=>re.test(text)).map(([k,re])=>({c:k,r:sec.pref.some(l=>re.test(l))&&!sec.req.some(l=>re.test(l))?0:1}));
  const cats=categorize(title),ENG=new Set(Object.values(G.COUNTRY).filter(c=>c.en).map(c=>c.code));
  const reqOther=langs.some(l=>l.r&&!l.alt||l.r&&l.alt),engExplicit=/\benglish (is|will be) (the |our )?(primary|working|official|business|company|main) language|(working|business|company|official) language (is|will be) english|english[- ]speaking (environment|team|office|workplace)|(fluen\w+|proficien\w+|excellent|strong|professional)[^.]{0,30}\benglish\b|\benglish\b[^.]{0,20}(fluen\w+|proficien\w+)/i.test(text);
  let en;const ccl=[...cc];if(reqOther)en='n';else if(ccl.length&&ccl.every(c=>ENG.has(c))||rem.rs==='w'&&engExplicit)en='p';else if(engExplicit)en='p';else en='o';
  const slug=(j.sourceKey||'').split(':')[1]||'',ind=IND_BY_BOARD[slug];
  const intlWelcome=INTL_WELCOME.test(text)||rem.rs==='w'||visa==='y'||reloc==='y';
  return {v:VERSION,md:modes,cc:ccl,ci:[...new Set(segs.flatMap(s=>s.cities))].slice(0,6),rs:rem.rs,rc:rem.rc,rg:rem.rg,cat:cats,lv,yr:yrs,dg:dg.d,dgEq:dg.eq?1:0,dgPref:dp.d,
    sk:[...req].slice(0,25),skp:[...prf].slice(0,20),langs,visa,reloc,en,iw:intlWelcome?1:0,certs,clr:CLEAR.test(text)?1:0,usc:/\bu\.?s\.? citizen/i.test(text)?1:0,
    kw:keywords(title+' '+title+' '+title+' '+sec.resp.join(' ').slice(0,2500)+' '+reqLines.join(' ').slice(0,2500)),ty:ctype,usd:toUSDk(j.salary,j.cur),ind:ind?[ind,'Technology']:['Technology'],hasReq:hasReq?1:0,stu:/(currently|actively)\s+(enrolled|pursuing)|enrolled in (a|an)\b|rising (junior|senior|sophomore)|must be a (current )?student|returning to (school|university)|expected graduation/i.test(text)?1:0}}
const domainHits=t=>{const o={};for(const [c,re] of CAT_RULES){const m=String(t).match(new RegExp(re.source,'gi'));if(m&&m.length)o[c]=m.length}return o};
return {enrich,toUSDk,evidence,keywords,domainHits,FAM,sections,skillsIn,related,CATS,CANON,LV_YEARS,VERSION,setFx:r=>{FX={USD:1,...r}},CERTS,categorize,langsOf,LRE,LANGS,ENG:()=>0,levelOf,degreeOf,yearsOf,visaOf,relocOf}})();
// ===== Resume analysis: turns resume text into a structured profile (roles with dates, weighted experience, domains, education, languages) =====
M.profile=(()=>{
const E=M.enrich,NOW=()=>new Date();
const MON={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
const DATE='(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+|\\d{1,2}\\/)?(?:19|20)\\d{2}';
const RANGE=new RegExp('('+DATE+')\\s*(?:-|–|—|to|until)\\s*('+DATE+'|present|current|now|today|ongoing)','i');
const parseD=(s,end)=>{s=String(s).toLowerCase();if(/present|current|now|today|ongoing/.test(s)){const n=NOW();return n.getFullYear()*12+n.getMonth()+1}
  const y=+(s.match(/(?:19|20)\d{2}/)||[0])[0];let m=0;const mm=s.match(/[a-z]{3,}/);if(mm&&MON[mm[0]])m=MON[mm[0]];else{const n=s.match(/^(\d{1,2})\//);if(n)m=+n[1]}
  if(!m)m=end?12:1;return y*12+m}
const HEAD={exp:/^(professional |relevant |work |employment )?(experience|employment( history)?|work history|career history)\b/i,proj:/^(projects?|selected projects|personal projects|technical projects|research)\b/i,edu:/^(education|academic|education (&|and) (activities|training|certifications))\b/i,
  skills:/^(technical )?skills\b|^core competencies|^technologies/i,cert:/^(certifications?|licenses?|certificates)\b/i,sum:/^(professional |career )?(summary|profile|objective|about)\b/i,lang:/^languages?\b/i,act:/^(activities|leadership|volunteer|awards|honors|interests|publications)\b/i};
function split(text){const raw=String(text).replace(/\r/g,'').replace(/[ \t]+/g,' ').split('\n').map(l=>l.trim());
  const lines=[];for(let i=0;i<raw.length;i++){let l=raw[i];if(/^[•●▪◦·*-]$/.test(l)){let j=i+1;while(j<raw.length&&!raw[j])j++;if(j<raw.length){l='• '+raw[j];i=j}}if(l)lines.push(l)}
  const S={top:[],exp:[],proj:[],edu:[],skills:[],cert:[],sum:[],lang:[],act:[]};let cur='top';
  for(const l of lines){const bare=l.replace(/[:\s]+$/,'');if(bare.length<60&&!/^[•\-*]/.test(l)){let h=null;for(const k in HEAD)if(HEAD[k].test(bare)&&!RANGE.test(bare)){h=k;break}if(h){cur=h;continue}}S[cur].push(l)}
  return {S,lines}}
const PART=/part[- ]?time|\bpt\b|20 hrs|hours? per week/i,INTERN=/\bintern(ship)?\b|co-?op|apprentice/i,FOUNDER=/(co-?)?founder|\bowner\b|self[- ]employed|freelanc/i;
const SKDOM={'Security':['SIEM','Splunk','Microsoft Sentinel','KQL','Wireshark','Snort','Nmap','Metasploit','Incident Response','Threat Hunting','EDR','Digital Forensics','Penetration Testing','Vulnerability Management','SOC','Cybersecurity','NIST','ISO 27001','Firewalls','IAM'],
 'IT & Support':['ServiceNow','Help Desk','Active Directory','Windows','macOS','ITIL','Troubleshooting','Technical Support'],'Software Engineering':['JavaScript','TypeScript','Node.js','React','Java','C++','C#','PHP','Golang','Rust','Ruby','Swift','Kotlin','HTML/CSS','Git','Docker','Kubernetes','CI/CD','REST APIs'],
 'Data & AI':['SQL','Pandas','NumPy','Machine Learning','LLMs','Tableau','Power BI','Data Analysis','Statistics','Generative AI','Prompt Engineering'],'Design':['Figma','UX Research','Prototyping','Design Systems'],'Sales':['Salesforce','CRM','Account Management','Sales'],'Marketing':['SEO','Content Marketing','Email Marketing','Social Media','Paid Media','Google Analytics']};
const EDU_FIELD=[['Security',/cyber|security|forensic/i],['Software Engineering',/computer science|software|computer engineering|informatics/i],['IT & Support',/information (science|systems|technology)|\bit\b/i],['Data & AI',/data|analytic|statistic|mathemat|machine learning|artificial/i],['Operations',/operations|logistics|supply|industrial|business admin|management/i],['Finance',/financ|accounting|econom/i],['Marketing',/marketing|communications?|journalism/i],['Design',/design|art\b/i],['Hardware & Manufacturing',/mechanical|electrical|aerospace|engineering/i],['Legal',/\blaw\b|legal/i],['People',/psychology|human resources/i]];
function domainsOfRole(title,body,skills,isFounder){const d={};const add=(k,w)=>{if(k&&k!=='Other')d[k]=Math.max(d[k]||0,w)};
  const t=E.categorize(title);add(t[0],1);add(t[1],.6);
  const hits=E.domainHits(body);Object.entries(hits).sort((a,b)=>b[1]-a[1]).slice(0,2).forEach(([k,n])=>{if(n>=3)add(k,.7);else if(n>=2)add(k,.5)});
  if(/\b(built|developed|launched|coded|programmed|designed)\b[^.]{0,40}\b(website|web ?app|app|platform|application|site|tool|dashboard)\b/i.test(body))add('Software Engineering',.6);
  for(const [dom,list] of Object.entries(SKDOM)){const n=skills.filter(s=>list.includes(s)).length;if(n)add(dom,Math.min(.85,.3+.15*n))}
  if(isFounder){add('Product',.5);add('Operations',.5);add('Marketing',.4);if(d['Software Engineering'])add('Software Engineering',Math.max(d['Software Engineering'],.7))}
  return d}
function parseRoles(lines){const roles=[];let cur=null;
  const flush=()=>{if(cur){cur.body=cur.bul.join(' ');roles.push(cur)}cur=null};
  for(let i=0;i<lines.length;i++){const l=lines[i],m=RANGE.exec(l);
    if(m&&!/^[•\-*]/.test(l)){flush();let head=l.replace(m[0],'').replace(/[|·•,\-–—\s]+$/,'').trim();
      if(!head||head.length<3){const prev=lines[i-1];if(prev&&!RANGE.test(prev)&&!/^[•\-*]/.test(prev)&&prev.length<100&&!roles.some(r=>r.head===prev))head=prev}
      cur={head,start:parseD(m[1],false),end:parseD(m[2],true),bul:[],raw:l}}
    else if(cur)cur.bul.push(l.replace(/^[•\-*]\s*/,''));}
  flush();
  return roles.filter(r=>r.end>=r.start&&r.start>1900*12).map(r=>{
    const parts=r.head.split(/\s*[|·]\s*|\s+[-–—]\s+|\s+(?:at|@)\s+|,\s+/).map(x=>x.trim()).filter(Boolean);
    let title=parts.find(p=>E.categorize(p)[0]!=='Other'||/\b(engineer|analyst|manager|developer|intern|specialist|founder|director|lead|consultant|assistant|coordinator|associate|technician|administrator)\b/i.test(p))||parts[0]||r.head;
    const company=parts.find(p=>p!==title)||'';const flags=r.head+' '+r.raw;
    const partTime=PART.test(flags),intern=INTERN.test(title),founder=FOUNDER.test(title+' '+company);
    const skills=E.skillsIn(r.head+' '+r.body);
    const f=partTime?.5:intern?.6:1;
    return {title:title.replace(/\(.*?\)/g,'').trim(),company:company.replace(/\s*\((remote|part-time|self-employed|hybrid|on-?site)\)/ig,'').trim(),start:r.start,end:r.end,months:r.end-r.start+1,f,partTime,intern,founder,
      doms:domainsOfRole(title,r.body,skills,founder),skills,summary:r.bul.slice(0,2).join(' ').slice(0,260)}})}
function parseProjects(lines){const ps=[];let cur=null;
  for(const l of lines){const bullet=/^[•\-*]/.test(l);
    if(!bullet&&l.length<160&&(RANGE.test(l)||/\s\|\s|github\.com|https?:/i.test(l)||!cur)){cur={name:l.split(/\s*[|:]\s*/)[0].replace(RANGE,'').trim(),text:l,skills:[]};ps.push(cur)}else if(cur){cur.text+=' '+l}}
  return ps.filter(p=>p.name).map(p=>{p.skills=E.skillsIn(p.text);p.doms=domainsOfRole(p.name,p.text,p.skills,false);delete p.text;return p})}
function parseEdu(lines,all){const eds=[];let level=0;const full=lines.join(' | ');
  const RX=[[4,/ph\.?d|doctorate/i],[3,/master|\bm\.?s\.?c?\b|\bm\.?b\.?a\b|\bm\.?eng/i],[2,/bachelor|\bb\.?s\.?c?\b|\bb\.?a\.?\b|\bb\.?eng/i],[1,/associate|a\.a\.s|a\.s\.\b/i]];
  for(const l of lines){for(const [lv,re] of RX){if(re.test(l)&&/(university|college|institute|school|b\.?s|b\.?a|degree|bachelor|master|m\.?s|ph\.?d|associate)/i.test(l)){const field=(l.split(/\s*[|,]\s*/).slice(1).join(', ')||l).replace(/\b(19|20)\d{2}.*$/,'').slice(0,120);eds.push({level:lv,text:l.slice(0,160),field});level=Math.max(level,lv);break}}}
  const fieldText=lines.filter(l=>/(b\.?s|b\.?a|m\.?s|bachelor|master|minor|major|degree|concentration)/i.test(l)).join(' ');
  const doms={};for(const [d,re] of EDU_FIELD)if(re.test(fieldText))doms[d]=1;
  const yrs=[...full.matchAll(/(?:19|20)\d{2}/g)].map(m=>+m[0]);const grad=yrs.length?Math.max(...yrs):null;
  return {eds,level,doms,grad}}
const LNAME={english:'en',spanish:'es',japanese:'ja',french:'fr',german:'de',portuguese:'pt',italian:'it',mandarin:'zh',chinese:'zh',cantonese:'zh',korean:'ko',dutch:'nl',arabic:'ar',hindi:'hi',russian:'ru',polish:'pl',swedish:'sv',turkish:'tr',hebrew:'he'};
const LVL=[[/native|mother|bilingual|c2|n1\b/i,'n'],[/fluent|c1|advanced|full professional|proficient|n2\b/i,'f'],[/professional|business|b2|working proficiency|upper[- ]intermediate/i,'p'],[/conversational|intermediate|b1|n3\b|limited working|working knowledge|some/i,'c'],[/basic|beginner|elementary|a1|a2|n4\b|n5\b|learning|novice|intro/i,'b']];
function parseLangs(text){const out={};const re=new RegExp('\\b('+Object.keys(LNAME).join('|')+')\\b\\s*(?:\\(([^)]{2,40})\\)|[:–—-]\\s*([a-z0-9 /,+]{2,30}?)(?=[,;|\\n.]|$))?','gi');
  for(const m of String(text).matchAll(re)){const code=LNAME[m[1].toLowerCase()],desc=(m[2]||m[3]||'');if(!desc)continue;const hit=LVL.find(([r])=>r.test(desc));if(hit){const rank={n:5,f:4,p:3.5,c:2,b:1};if(!out[code]||rank[hit[1]]>rank[out[code]])out[code]=hit[1]}}
  const j=String(text).match(/jlpt\s*(n[1-5])/i);if(j){const lv={n1:'f',n2:'p',n3:'c',n4:'b',n5:'b'}[j[1].toLowerCase()];out.ja=out.ja||lv}
  if(/\bnative english|english\s*\(native\)/i.test(text))out.en='n';if(!out.en&&/\benglish\b/i.test(text))out.en='f';
  return Object.entries(out).map(([l,lvl])=>({l,lvl}))}
function analyze(text){text=String(text||'');const {S,lines}=split(text);
  const roles=parseRoles(S.exp.length?S.exp:lines.filter(l=>!/^[•\-*]/.test(l)||true));
  const projects=parseProjects(S.proj),edu=parseEdu(S.edu.length?S.edu:lines.filter(l=>/university|college|bachelor|b\.s|master/i.test(l)),lines);
  // weighted experience: for each calendar month take the best-weighted role active then (so overlapping jobs are not double counted)
  const bym=new Map();for(const r of roles)for(let m=r.start;m<=r.end;m++){bym.set(m,Math.max(bym.get(m)||0,r.f))}
  const eqYears=[...bym.values()].reduce((a,b)=>a+b,0)/12,span=roles.length?(Math.max(...roles.map(r=>r.end))-Math.min(...roles.map(r=>r.start))+1)/12:0;
  const explicit=[...text.matchAll(/(\d{1,2})\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:\w+\s+){0,3}?experience/gi)].map(m=>+m[1]).filter(n=>n<=40);
  const years=Math.round(Math.max(eqYears,explicit.length?Math.max(...explicit):0)*10)/10;
  const sorted=[...roles].sort((a,b)=>b.end-a.end||b.start-a.start),cur=sorted[0];
  const skills=E.skillsIn(text);const certs=[];for(const [c,re] of Object.entries(E.CERTS)){const m=re.exec(text);if(m){const around=text.slice(Math.max(0,m.index-5),m.index+m[0].length+40);certs.push({c,inProgress:/in progress|pursuing|expected|planned|studying/i.test(around)})}}
  const certLines=S.cert.concat(lines.filter(l=>/certificat|certified|\bCAE\b/i.test(l)&&l.length<200)).slice(0,6);
  const domYears={};for(const r of roles)for(const [d,w] of Object.entries(r.doms)){}
  for(const d of E.CATS){let tot=0;for(const [m] of bym){let best=0;for(const r of roles)if(m>=r.start&&m<=r.end&&r.doms[d])best=Math.max(best,r.f*r.doms[d]);tot+=best}if(tot)domYears[d]=Math.round(tot/12*10)/10}
  const projDom={};for(const p of projects)for(const [d,w] of Object.entries(p.doms))projDom[d]=Math.min(1,(projDom[d]||0)+.25*w);
  const nowY=NOW().getFullYear(),grad=edu.grad,recentGrad=!!grad&&grad>=nowY-1&&grad<=nowY+1;
  const sen=years<.5?'entry':years<3?'junior':years<6?'mid':years<10?'senior':'lead';
  const topDom=Object.entries(domYears).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);const ind=[];const T=text.toLowerCase();
  [['Cybersecurity',/cyber|security|soc\b|siem/],['Healthcare',/health|clinical|hospital|patient/],['Fintech',/fintech|payments|banking|trading/],['E-commerce',/e-?commerce|shopify|retail/],['Education',/university|education|school|teach/],['Software',/software|saas|web app|developer/],['AI',/machine learning|artificial intelligence|\bllm\b|prompt engineering|generative/]].forEach(([k,re])=>{if(re.test(T))ind.push(k)});
  const first=lines[0]||'';const titles=[...new Set(sorted.map(r=>r.title))].slice(0,5);
  const cur2=sorted.find(r=>!r.founder&&!r.intern)||sorted.find(r=>!r.founder)||cur;const base=(cur2?.title||'').replace(/^(senior|sr\.?|junior|jr\.?|lead|principal|staff)\s+/i,'').replace(/\bintern(ship)?\b/i,'').trim();
  const tips=[];const nums=(text.match(/\d+\s*%|\$\s?\d|\b\d{2,}\+?\s*(users|customers|clients|people|projects|incidents|tickets)/gi)||[]).length;
  if(nums<3)tips.push('Add measurable results (percentages, revenue, volume, time saved) to your bullet points.');
  if(!/@/.test(text))tips.push('Add an email address and contact details.');if(skills.length<6)tips.push('Add a clear skills section listing your tools and technologies.');
  if(/responsible for/i.test(text))tips.push('Replace "responsible for" with strong action verbs (led, built, reduced, launched).');
  if(!roles.length)tips.push('No dated roles were detected. Use a format like "Title | Company   Jan 2022 – Present" so experience can be measured accurately.');
  return {v:2,name:first.length<50&&!/\d|@/.test(first)?first:'',currentTitle:cur?.title||'',yearsExperience:years,spanYears:Math.round(span*10)/10,seniority:sen,
    skills,industries:ind,education:edu.eds.map(e=>e.text),eduLevel:edu.level,eduDomains:Object.keys(edu.doms),gradYear:grad,recentGrad,
    certifications:certLines.slice(0,4),certs,languages:parseLangs(text),
    history:sorted.map(r=>({title:r.title,company:r.company,period:fmt(r.start)+' – '+(r.end>=NOW().getFullYear()*12+NOW().getMonth()+1?'Present':fmt(r.end)),months:r.months,partTime:r.partTime,intern:r.intern,founder:r.founder,summary:r.summary,domains:Object.entries(r.doms).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0])})),
    roles:roles.map(r=>({s:r.start,e:r.end,f:r.f,d:r.doms,t:r.title})),projects:projects.map(p=>({name:p.name,skills:p.skills,d:p.doms})),projDom,domYears,topDomains:topDom,
    progression:roles.length?`${roles.length} role${roles.length>1?'s':''} found, about ${years} years of full-time-equivalent experience. Most recent: ${cur.title}${cur.company?' at '+cur.company:''}.`:'No dated roles detected.',
    suggestedTitles:[...new Set([...titles.filter(t=>!/intern|founder|owner/i.test(t)),...(topDom.slice(0,2).flatMap(d=>TITLES[d]||[]))])].slice(0,8),
    careerPaths:base&&!/founder|owner/i.test(base)&&sen!=='lead'?[`Senior ${base}`,`${base} Team Lead / Manager`,`Specialist track in ${topDom[0]||base}`]:[],improvements:tips}}
const fmt=m=>{const y=Math.floor((m-1)/12),mo=(m-1)%12;return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mo]+' '+y};
const TITLES={'Security':['Security Analyst','SOC Analyst','Incident Response Analyst','Security Engineer','Threat Detection Analyst','GRC Analyst'],'IT & Support':['IT Support Specialist','Systems Administrator','IT Analyst','Technical Support Engineer'],'Software Engineering':['Software Engineer','Full Stack Developer','Backend Developer','Solutions Engineer'],'Data & AI':['Data Analyst','Analytics Engineer','AI Engineer'],'Operations':['Operations Analyst','Business Operations Associate'],'Product':['Associate Product Manager','Product Operations Analyst'],'Marketing':['Growth Marketer','Marketing Analyst'],'Customer Support':['Technical Support Engineer','Customer Success Associate'],'Sales':['Sales Development Representative','Solutions Consultant']};
return {analyze,TITLES,LNAME,split}})();
// ===== Job fit: a deterministic, explainable 0-100 score. Experience is the main factor and can cap the total. =====
M.fit=(()=>{
const E=M.enrich;
const W={exp:40,skills:25,role:15,edu:10,lang:5,other:5};
const LABELS=[[80,'Excellent Match'],[65,'Good Match'],[45,'Potential Match'],[0,'Low Match']];
const labelOf=s=>LABELS.find(([t])=>s>=t)[1];
const ADJ={};[['Security','IT & Support',.6],['Security','Software Engineering',.4],['Security','Data & AI',.35],['Security','Operations',.3],['Software Engineering','Data & AI',.6],['Software Engineering','IT & Support',.35],['Software Engineering','Product',.3],['Software Engineering','Hardware & Manufacturing',.25],
 ['IT & Support','Customer Support',.5],['IT & Support','Operations',.35],['Product','Design',.4],['Product','Operations',.4],['Product','Data & AI',.35],['Product','Marketing',.35],['Marketing','Sales',.4],['Sales','Customer Support',.55],['Operations','Finance',.3],['Operations','People',.3],['Operations','Customer Support',.4],['Data & AI','Finance',.25],['Data & AI','Operations',.3],['Legal','Operations',.3],['Design','Marketing',.3],['Sales','Product',.2]]
 .forEach(([a,b,w])=>{ADJ[a+'|'+b]=ADJ[b+'|'+a]=w});
const dm=(a,b)=>a===b?1:(ADJ[a+'|'+b]||0);
const LR={n:5,f:4,p:3.5,c:2,b:1,'':0};
const credit=(need,have)=>{const h=LR[have]||0;if(need==='f')return h>=4?1:h>=3.5?.88:h>=2?.4:h>=1?.12:0;if(need==='c')return h>=3.5?1:h>=2?.9:h>=1?.5:0;return h>=2?1:h>=1?.8:.3}   // need: f=fluent/native/business, c=conversational, b=basic
const SYN={developer:'engineer',programmer:'engineer',swe:'software engineer',analytics:'analyst',specialist:'analyst',associate:'analyst'};
const toks=t=>String(t).toLowerCase().match(/[a-z]{3,}/g)?.filter(w=>!['senior','junior','lead','staff','principal','the','and','for','with'].includes(w)).map(w=>SYN[w]||(w.endsWith('s')&&w.length>4?w.slice(0,-1):w))||[];
const cache=new Map();
function prep(P,prefs){const key=JSON.stringify([P.v,P.yearsExperience,P.skills,P.roles,P.eduLevel,P.languages,P.certs,P.projDom,P.eduDomains,P.history?.length,P.name,prefs?.roles]);let c=cache.get(key);if(c)return c;
  const text=P._text||'',stems=new Set((text.toLowerCase().match(/[a-z][a-z-]{3,}/g)||[]).map(w=>w.length>5&&w.endsWith('s')&&!w.endsWith('ss')?w.slice(0,-1):w));
  const sk=new Set(P.skills||[]),fam=new Set();for(const s of sk)(E.FAM.get(s)||[]).forEach(i=>fam.add(i));
  const titleToks=new Set([...(P.history||[]).map(h=>h.title),...(P.suggestedTitles||[]),...String(prefs?.roles||'').split(/[,;|]/)].flatMap(toks));
  const langs=Object.fromEntries((P.languages||[]).map(l=>[l.l,l.lvl]));langs.en=langs.en||'f';
  c={P,sk,fam,stems,titleToks,langs,rel:new Map(),certs:new Map((P.certs||[]).map(x=>[x.c,x]))};cache.set(key,c);if(cache.size>8)cache.delete(cache.keys().next().value);return c}
function relYears(C,jd){const k=Object.entries(jd).map(x=>x.join(':')).join('|');if(C.rel.has(k))return C.rel.get(k);
  const roles=C.P.roles||[];let tot=0;if(roles.length){const lo=Math.min(...roles.map(r=>r.s)),hi=Math.max(...roles.map(r=>r.e));
    for(let m=lo;m<=hi;m++){let best=0;for(const r of roles){if(m<r.s||m>r.e)continue;let w=0;for(const [d,jw] of Object.entries(jd))for(const [rd,rw] of Object.entries(r.d||{}))w=Math.max(w,jw*rw*dm(rd,d));best=Math.max(best,r.f*w)}tot+=best}}
  const v=tot/12;C.rel.set(k,v);return v}
const skillCredit=(C,s)=>C.sk.has(s)?1:(E.FAM.get(s)||[]).some(i=>C.fam.has(i))?.5:0;
function fit(j,C,opt={}){const P=C.P,x=j.x,detail=!!opt.detail;if(!x)return null;
  const jd={[x.cat[0]]:1};if(x.cat[1])jd[x.cat[1]]=.7;
  // --- experience (40) ---
  const floor=x.lv==='senior'?4:x.lv==='lead'?7:0,reqY=Math.max(floor,x.yr!=null?x.yr:E.LV_YEARS[x.lv]??3),known=x.yr!=null&&x.yr>=floor;
  let rel=relYears(C,jd);const projC=Math.max(0,...Object.entries(jd).map(([d,w])=>(P.projDom?.[d]||0)*w))*.5;
  const eduC=P.eduLevel&&Object.keys(jd).some(d=>(P.eduDomains||[]).some(e=>dm(e,d)>=.6))?(P.recentGrad?.4:.2):0;
  const relTot=rel+projC+eduC,yrs=P.yearsExperience||0;let v;
  if(reqY<=.5)v=relTot>=1?1:relTot>=.4?.85:relTot>=.15?.7:yrs>=.5?.55:.45;
  else{const ratio=relTot/reqY;v=ratio>=1?1:.12+.88*Math.pow(Math.max(ratio,0),.9);v+=(1-v)*.2*Math.min(1,yrs/reqY)}
  const capRatio=(relTot+.35*Math.max(0,yrs-relTot))/Math.max(reqY,.01);let cap=100,capWhy='';
  if(reqY>=3){if(capRatio<.35){cap=45;capWhy='Job asks for ~'+reqY+'+ years of experience and you have well under half of that in this area.'}else if(capRatio<.6){cap=60;capWhy='Job asks for ~'+reqY+'+ years and you have roughly half of that in this area.'}else if(capRatio<.85){cap=78;capWhy='You are somewhat short of the ~'+reqY+'+ years of experience the job asks for.'}}
  else if(reqY>=1.5&&capRatio<.35){cap=68;capWhy='Job asks for ~'+reqY+'+ years of experience.'}
  const domBest=Math.max(0,...(P.roles||[]).flatMap(r=>Object.entries(jd).flatMap(([d,w])=>Object.entries(r.d||{}).map(([rd,rw])=>w*rw*dm(rd,d)))),...(P.eduLevel?Object.keys(jd).map(d=>(P.eduDomains||[]).reduce((a,e)=>Math.max(a,dm(e,d)*.7),0)):[0]));
  if(domBest<.25&&cap>52){cap=52;capWhy='Your background has little overlap with this field (transferable skills only).'}
  // --- skills (25) ---
  const R=x.sk||[],Pf=x.skp||[];const rc=R.map(s=>[s,skillCredit(C,s)]),pc=Pf.map(s=>[s,skillCredit(C,s)]);
  const covR=R.length?rc.reduce((a,b)=>a+b[1],0)/R.length:0,covP=Pf.length?pc.reduce((a,b)=>a+b[1],0)/Pf.length:0;let sv;
  if(R.length){const w=R.length/(R.length+1.5);sv=w*(Pf.length?.8*covR+.2*covP:covR)+(1-w)*.6}else if(Pf.length)sv=.55+.35*covP;else sv=.3+.45*Math.min(1,(x.kw||[]).length?(x.kw.filter(w=>C.stems.has(w)).length/x.kw.length)/.4:.3);
  // --- education (10) ---
  const need=x.dg||0,have=P.eduLevel||0;let ev;
  if(!need)ev=x.dgPref?(have>=x.dgPref?1:.85):(have?1:.8);else if(have>=need)ev=1;else{const g=need-have;ev=g===1?(x.dgEq?.75:.45):(x.dgEq?.4:.15)}
  // --- role alignment (15) ---
  const jt=toks(j.title),tsim=jt.length?jt.filter(w=>C.titleToks.has(w)).length/jt.length:0;
  const kw=x.kw||[],ov=kw.length?kw.filter(w=>C.stems.has(w)).length/kw.length:0,rv=.5*Math.min(1,domBest)+.2*Math.min(1,tsim*1.3)+.3*Math.min(1,ov/.45);
  if(x.stu&&P.gradYear&&P.gradYear<=new Date().getFullYear()&&cap>60){cap=60;capWhy='The posting asks for current students, and your resume shows you have already graduated.'}
  // --- languages (5) ---
  const need2=(x.langs||[]).filter(l=>l.r);let lv=1,langBlock=1,langNote='';
  if(need2.length){const groups=[];for(const l of need2){if(l.alt){let g=groups.find(g=>g.alt);if(!g)groups.push(g={alt:1,c:0,names:[]});g.c=Math.max(g.c,credit(l.d,C.langs[l.l]));g.names.push(l.l)}else groups.push({c:credit(l.d,C.langs[l.l]),names:[l.l]})}
    const real=groups.filter(g=>!(g.names.length===1&&g.names[0]==='en'));if(real.length){lv=real.reduce((a,g)=>a+g.c,0)/real.length;langBlock=Math.min(...real.map(g=>g.c));langNote=real.map(g=>g.names.map(n=>M.profile.LNAME&&Object.keys(M.profile.LNAME).find(k=>M.profile.LNAME[k]===n)||n).join('/')).join(', ')}}
  if(langBlock<.3&&cap>58){cap=58;capWhy='A required language is well above your current level ('+langNote+').'}else if(langBlock<.6&&cap>74){cap=74;capWhy='A required language is above your current level ('+langNote+').'}
  // --- other (5) ---
  let ov2=.6;for(const c of x.certs||[]){const h=C.certs.get(c.c);ov2+=h&&!h.inProgress?.3:h?.15:c.r?-.2:-.05}
  if((x.lv==='entry'||x.lv==='intern'||x.lv==='junior')&&P.recentGrad)ov2+=.25;if(x.clr)ov2-=.3;if(x.lv==='intern'&&P.gradYear&&P.gradYear<=new Date().getFullYear())ov2-=.3;ov2=Math.max(.1,Math.min(1,ov2));
  const pts={exp:v*W.exp,skills:sv*W.skills,role:rv*W.role,edu:ev*W.edu,lang:lv*W.lang,other:ov2*W.other};
  let total=Object.values(pts).reduce((a,b)=>a+b,0),score=Math.round(Math.min(total,cap));
  const out={score,label:labelOf(score),capped:total>cap+.5,
    m:rc.filter(r=>r[1]===1).length,t:rc.filter(r=>r[1]===.5).length,n:R.length,miss:rc.filter(r=>r[1]===0).map(r=>r[0]).slice(0,4)};
  if(!detail)return out;
  const missing=rc.filter(r=>r[1]===0).map(r=>r[0]),have2=rc.filter(r=>r[1]===1).map(r=>r[0]),trans=rc.filter(r=>r[1]===.5).map(r=>[r[0],Pf.length||1&&[...C.sk].find(s=>related(s,r[0]))]);
  const prefMissing=pc.filter(r=>r[1]===0).map(r=>r[0]);
  const noteExp=reqY<=.5?`Entry-level role. You have about ${relTot.toFixed(1)} years of relevant experience, projects and coursework for this field.`:`The job asks for about ${reqY}+ years${known?'':' (estimated from the level)'}; you have about ${relTot.toFixed(1)} years of relevant experience, projects and coursework (${yrs} years total, weighted for part-time and internships).`;
  const parts=[{k:'exp',label:'Relevant experience',w:W.exp,pts:+pts.exp.toFixed(1),note:noteExp},
   {k:'skills',label:'Skills match',w:W.skills,pts:+pts.skills.toFixed(1),note:R.length?`${have2.length} of ${R.length} required skills matched${trans.length?', '+trans.length+' partly via related skills':''}${Pf.length?`; ${pc.filter(r=>r[1]===1).length} of ${Pf.length} preferred/nice-to-have`:''}.`:'The posting lists few specific tools, so this component is neutral.'},
   {k:'role',label:'Role & responsibilities',w:W.role,pts:+pts.role.toFixed(1),note:`Domain overlap ${Math.round(Math.min(1,domBest)*100)}%, title similarity ${Math.round(Math.min(1,tsim)*100)}%, keyword overlap with your resume ${Math.round(ov*100)}%.`},
   {k:'edu',label:'Education & qualifications',w:W.edu,pts:+pts.edu.toFixed(1),note:need?(have>=need?'Your degree level meets the stated requirement.':`Job asks for a ${['','associate','bachelor','master','doctorate'][need]} degree${x.dgEq?' (or equivalent experience)':''}; yours is ${['none listed','associate','bachelor','master','doctorate'][have]}.`):'No specific degree requirement detected.'},
   {k:'lang',label:'Language requirements',w:W.lang,pts:+pts.lang.toFixed(1),note:need2.length&&langNote?`Requires ${langNote}.`:'No language requirement besides English detected.'},
   {k:'other',label:'Certifications & other',w:W.other,pts:+pts.other.toFixed(1),note:(x.certs||[]).length?'Mentions '+x.certs.map(c=>c.c+(c.r?'':' (preferred)')).join(', ')+'.':'No certifications required.'}];
  const strengths=[];if(have2.length)strengths.push('Matches required skills: '+have2.slice(0,6).join(', '));if(trans.length)strengths.push('Transferable: '+trans.slice(0,3).map(t=>t[0]+(t[1]?' (via '+t[1]+')':'')).join(', '));
  if(relTot>=reqY&&reqY>0)strengths.push('You meet the experience level asked for');if(domBest>=.7)strengths.push('Your work history is in the same field ('+x.cat[0]+')');if(P.recentGrad&&['entry','intern','junior'].includes(x.lv))strengths.push('Recent graduate applying to an early-career role');
  const gaps=[];if(missing.length)gaps.push('Required skills not found on your resume: '+missing.slice(0,6).join(', '));if(capWhy)gaps.push(capWhy);if(need&&have<need)gaps.push('Degree requirement above your listed education');
  if(langBlock<.9&&need2.length)gaps.push('Language level below what the posting requires ('+langNote+')');for(const c of x.certs||[]){const h=C.certs.get(c.c);if(c.r&&(!h||h.inProgress))gaps.push(`Certification: ${c.c}${h?' (in progress on your resume)':''}`)}
  const advice=[];missing.slice(0,3).forEach(s=>advice.push(`Gain or document ${s} (listed as required) with a small project or coursework, then add it to your resume.`));
  if(capWhy&&reqY>=3)advice.push('Look at similar roles with a lower experience bar first (junior or associate titles), or highlight the closest projects and internships.');
  if(langBlock<.9&&need2.length)advice.push(`Improving ${langNote} to business level would remove the main blocker for this role.`);
  prefMissing.slice(0,2).forEach(s=>advice.push(`Nice to have: ${s}.`));
  return {...out,parts,strengths,gaps,advice,required:{years:reqY,known,skills:R,degree:need},missingRequired:missing,missingPreferred:prefMissing,matched:have2,transferable:trans.map(t=>t[0]),capWhy,uncapped:Math.round(total)}}
const related=E.related;
// Eligibility: can this person actually take the job from where they are (or want to live)? Never assumes remote means worldwide.
function eligibility(j,home){const x=j.x;if(!x)return {s:'check',n:[]};const opts=[],set=x.md&1?M.geo.expand(x.rc,x.rg):null,inCountry=x.cc.includes(home),hn=M.geo.countryName(home);
  const where=x.cc.slice(0,2).map(M.geo.countryName).join(' / ');
  if(x.md&1){
    if(x.rs==='w')opts.push(['ok','Remote worldwide: you can work from '+hn]);
    else if(x.rs==='u')opts.push(['check','Remote, but the posting does not say where you may work from']);
    else if(set.has(home))opts.push(['ok','Remote, open to people in '+hn]);
    else{const list=[...set].slice(0,6).map(M.geo.countryName).join(', ')||'the listed regions';
      opts.push(x.visa==='y'||x.reloc==='y'?['check','Remote only for '+list+': you would need to relocate there ('+(x.visa==='y'?'visa sponsorship':'relocation assistance')+' mentioned)']:['blocked','Remote only for people in '+list+' (not open from '+hn+')'])}}
  if(x.md&6||!(x.md&1)){
    if(!x.cc.length)opts.push(['check','Location not specified']);else if(inCountry)opts.push(['ok','Located in '+hn]);
    else if(x.visa==='y')opts.push(['ok',where+': on-site, visa sponsorship mentioned'+(x.reloc==='y'?', relocation assistance offered':'')]);
    else if(x.visa==='n')opts.push(['blocked',where+': on-site, the posting says no visa sponsorship']);
    else opts.push(['check',where+': on-site, you would need to relocate and hold work authorization (sponsorship not mentioned)'+(x.reloc==='y'?'; relocation assistance offered':'')])}
  const rank={ok:0,check:1,blocked:2};opts.sort((a,b)=>rank[a[0]]-rank[b[0]]);return {s:opts[0][0],n:opts.map(o=>o[1])}}
return {fit,prep,labelOf,eligibility,W,LABELS}})();
// ===== Search: understands "Marketing jobs in Spain", "Remote software engineering jobs", "English-speaking jobs in Japan"; filters, ranking, sorting, facets =====
M.search=(()=>{
const G=M.geo,E=M.enrich,F=M.fit;
const STOP=new Set(['and','the','for','with','jobs','job','role','roles','position','positions','opening','openings','in','of','a','an','at','to','near','around','within','across','from','hiring','career','careers','work','working','i','me','my','looking','find','need','want','available','company','companies','that','offer','offers','offering','who','are']);
// groups of interchangeable words; the first form is what we stem to
const EQ=[['engineer','engineering','developer','programmer','swe','development'],['security','cybersecurity','cyber','infosec'],['analyst','analytics','analysis'],['marketing','marketer'],['design','designer'],['recruiter','recruiting','talent','sourcer'],['accountant','accounting'],['manager','management'],['scientist','science'],['frontend','front-end','front'],['backend','back-end','back'],['fullstack','full-stack'],['devops','sre','platform'],['support','helpdesk','help-desk'],['sales','selling'],['finance','financial'],['legal','counsel','attorney']];
const EQM=new Map();EQ.forEach(g=>g.forEach(w=>EQM.set(w,g)));
const PHRASES={swe:['software engineer','software developer'],ml:['machine learning'],ai:['machine learning','artificial intelligence','llm'],it:['help desk','it support','sysadmin','systems administrator'],qa:['quality assurance','sdet'],ux:['user experience','product design'],pm:['product manager','program manager'],soc:['security operations'],'new-grad':['new grad','graduate','early career']};
const LEVELW={intern:'intern',internship:'intern',entry:'entry','entry-level':'entry',graduate:'entry','new-grad':'entry',junior:'junior',jr:'junior',senior:'senior',sr:'senior',lead:'lead',staff:'lead',principal:'lead',director:'lead',mid:'mid','mid-level':'mid'};
const stem=w=>{w=w.toLowerCase();return w.length>3&&w.endsWith('ies')?w.slice(0,-3)+'y':w.length>3&&w.endsWith('s')&&!/(ss|us|is)$/.test(w)?w.slice(0,-1):w};
// ---- query understanding ----
function parseQuery(raw){raw=String(raw||'').trim();const imp={modes:[],levels:[],english:false,visa:false,reloc:false,intl:false,pieces:[]};let q=' '+raw.toLowerCase().replace(/[“”"]/g,'"')+' ';
  const take=(re,fn)=>{q=q.replace(re,(...m)=>{fn&&fn(m);return ' '})};
  take(/\benglish[- ]speaking\b|\benglish[- ]only\b|\bin english\b|\benglish language jobs?\b/g,()=>imp.english=true);
  take(/\bvisa[- ]sponsor(?:ship|ed|ing)?\b|\bsponsor(?:s|ship)? (?:a )?visas?\b|\bvisa\b|\bsponsorship\b/g,()=>imp.visa=true);
  take(/\brelocation(?: assistance| support| package)?\b|\brelocate\b/g,()=>imp.reloc=true);
  take(/\b(?:international applicants?|worldwide hiring|global hiring)\b/g,()=>imp.intl=true);
  take(/\b(?:remote|work from home|wfh|telecommute|telecommuting)\b(?:[- ]first|[- ]only)?/g,()=>imp.modes.push('remote'));
  take(/\bhybrid\b/g,()=>imp.modes.push('hybrid'));take(/\bon-?site\b|\bin[- ]office\b/g,()=>imp.modes.push('onsite'));
  // "... in <place>" : only accepted when the place resolves to something we know
  const m=/\b(?:in|near|around|within|across|from|based in)\s+([a-z][a-z .,'&-]{1,50})$/.exec(q.trimEnd()+' ');
  if(m){const sg=G.seg(m[1]);if(sg.codes.length||sg.states.length||sg.cities.length){imp.pieces.push(m[1].trim());q=q.slice(0,m.index)+' '}}
  // bare place names ("spain marketing", "tokyo engineer")
  q=q.replace(/(?<![a-z0-9])(united states|united kingdom|south korea|new zealand|hong kong|new york|san francisco|[a-z]{4,})(?![a-z0-9])/g,(w,x)=>{if(STOP.has(x)||LEVELW[x]||SYN0[x])return w;const i=G.find(x);if(i&&(i.t==='country'||i.t==='city')&&!(i.t==='city'&&x.length<5)){imp.pieces.push(x);return ' '}return w});
  const groups=[];for(const g of q.split(/\s*(?:,|\||;|\bor\b)\s*/)){const terms=[];
    g.replace(/"([^"]+)"|(\S+)/g,(mm,ph,w)=>{let t=(ph||w).toLowerCase().replace(/^[^a-z0-9+#.]+|[^a-z0-9+#]+$/g,'');if(!t||STOP.has(t))return mm;
      if(LEVELW[t]){const lv=LEVELW[t];if(!imp.levels.includes(lv))imp.levels.push(lv);if(lv==='entry'&&!imp.levels.includes('junior'))imp.levels.push('junior');return mm}
      if(!terms.some(x=>x.t===t))terms.push(mk(t,!!ph));return mm});
    if(terms.length)groups.push(terms)}
  return {groups,imp}}
const SYN0={};   // placeholder for words that must not be read as places
function mk(t,phrase){const st=stem(t),eq=EQM.get(t)||EQM.get(st)||[],alts=new Set(eq.map(stem));alts.delete(st);const ph=(PHRASES[t]||[]).slice();return {t,st,alts:[...alts],ph,phrase,short:t.length<=3&&!/[+#.]/.test(t)}}
// ---- index ----
function build(jobs){const rows=[];for(const j of jobs){const x=j.x;if(!x)continue;const tl=(j.title||'').toLowerCase();
  const skr=(x.sk||[]).map(s=>s.toLowerCase()),skp=(x.skp||[]).map(s=>s.toLowerCase());
  rows.push({j,x,t:tl,tt:new Set(tl.split(/[^a-z0-9+#.]+/).filter(Boolean).map(stem)),skL:'|'+skr.join('|')+'|',skP:'|'+skp.join('|')+'|',c:(j.company||'').toLowerCase(),cat:x.cat.join('|').toLowerCase(),ind:x.ind.join('|').toLowerCase(),
    d:(j.desc||'').slice(0,2600).toLowerCase(),ts:+new Date(j.posted||0)||0,locL:G.strip(j.loc||'').toLowerCase(),ccs:new Set(x.cc),rexp:x.md&1?G.expand(x.rc,x.rg):null})}
  return rows}
const hasW=(s,w)=>{let i=-1;while((i=s.indexOf(w,i+1))>=0){const p=s[i-1];if(i===0||!/[a-z0-9]/.test(p))return true}return false};
const cnt=(s,w,max)=>{let i=-1,n=0;while(n<max&&(i=s.indexOf(w,i+1))>=0){const p=s[i-1],e=s[i+w.length];if((i===0||!/[a-z0-9]/.test(p))&&(e===undefined||!/[a-z0-9]/.test(e)))n++}return n};
function termHit(r,t){let best=0,weak=false;const one=(w,mult,phr)=>{let s=0;
    if(r.tt.has(w))s=10;else if(w.length>=4&&hasW(r.t,w))s=8;else if(phr&&r.t.includes(w))s=9;
    else if(r.cat.includes(w))s=6;else if(r.skL.includes('|'+w+'|'))s=5;else if(r.skP.includes('|'+w+'|'))s=3;else if(r.c.includes(w))s=4;else if(r.ind.includes(w))s=3.5;
    else if(w.length>3&&(r.skL.includes(w)||r.skP.includes(w)))s=2;
    else{const n=cnt(r.d,w,3);if(n>=2)s=1.5;else if(n===1)s=.8,weak=true}
    return s*mult};
  best=one(t.st,1,false);if(t.t!==t.st)best=Math.max(best,one(t.t,1,false));
  if(best<4)for(const a of t.alts){best=Math.max(best,one(a,.85,false));if(best>=8)break}
  if(best<4)for(const p of t.ph)best=Math.max(best,one(p,.9,true));
  if(t.short&&best>0&&best<5)best=0;   // 2-3 letter terms ("go", "ml") must be real hits, not substrings
  return best}
function scoreGroup(r,g){let pts=0,strong=0,weak=0;for(const t of g){const s=termHit(r,t);pts+=s;if(s>=3.5)strong++;else if(s>0)weak++}
  const n=g.length,need=Math.max(1,Math.ceil(n*.5));if(strong<need||strong+weak<(n<=3?n:n-1))return 0;
  const phrase=g.map(t=>t.t).join(' ');if(n>1&&r.t.includes(phrase))pts+=12;return pts+(strong===n?3:0)}
// ---- location ----
function pieces(F,imp){const out=[];const add=txt=>{for(const part of String(txt||'').split(/\s*(?:\||;|\bor\b)\s*/i).flatMap(p=>p.split(',').map(s=>s.trim()).filter(Boolean))){
    const prev=out[out.length-1];if(/^[A-Za-z]{2}$/.test(part)&&prev&&!G.find(part)&&G.ST_ABBR.has(part.toUpperCase()))continue;   // "Boston, MA": MA belongs to Boston
    const sg=G.seg(part),low=G.strip(part).toLowerCase(),info=G.find(low);
    const p={text:low,countries:new Set(),remoteCodes:new Set(sg.codes),cities:sg.cities.map(c=>c.toLowerCase()),states:sg.states.map(s=>String(s).toLowerCase())};
    if(/^[A-Z]{2}$/.test(part)&&G.ST_ABBR.has(part)){p.remoteCodes.add('US');p.states.push(part.toLowerCase())}
    if(info&&info.t==='state')p.states.push(low);
    if(info&&info.t==='country')p.countries.add(info.code);
    if(info&&info.t==='country'&&prev&&(prev.cities.length||prev.states.length)&&prev.remoteCodes.has(info.code))continue;   // "Madrid, Spain": the city already says it
    if(!p.countries.size&&!p.cities.length&&!p.states.length&&sg.codes.length&&!info)sg.codes.forEach(c=>p.countries.add(c));
    out.push(p)}};
  add(F.where);(imp.pieces||[]).forEach(add);if(F.country){const i=G.find(F.country),code=i?i.code:String(F.country).toUpperCase();out.push({text:'',countries:new Set([code]),remoteCodes:new Set([code]),cities:[],states:[],country:true})}
  return out}
function locOK(r,ps,unc){if(!ps.length)return 1;let u=0;
  for(const p of ps){let ok=0,uu=0;
    for(const c of p.countries)if(r.ccs.has(c)){ok=1;break}
    if(!ok&&(p.cities.length||p.states.length)){ok=p.cities.some(c=>r.locL.includes(c))||p.states.some(s=>s.length>2?r.locL.includes(s):new RegExp('(^|[^a-z])'+s+'([^a-z]|$)').test(r.locL))?1:0}
    if(!ok&&!p.countries.size&&!p.cities.length&&!p.states.length&&p.text&&r.locL.includes(p.text))ok=1;
    if(!ok&&r.rexp){for(const c of new Set([...p.countries,...p.remoteCodes])){if(r.x.rs==='w'||r.rexp.has(c)){ok=1;break}if(r.x.rs==='u')uu=1}}
    if(ok)return 1;if(uu)u=1}
  return u?(unc?1:2):0}
// how local is this job to what was searched (physical location beats "remote, open to you")
function localBonus(r,ps){let b=0;for(const p of ps){if([...p.countries].some(c=>r.ccs.has(c)&&!(r.x.md&1&&!(r.x.md&6))))b=Math.max(b,4);if(p.cities.some(c=>r.locL.includes(c)))b=Math.max(b,6);if(p.states.some(s=>s.length>2&&r.locL.includes(s)))b=Math.max(b,5)}return b}
// ---- filters ----
const LV_ORDER=['intern','entry','junior','mid','senior','lead'];
function filterRow(r,f,ps,unc,skip){const x=r.x,j=r.j;
  if(f.modes.length&&!skip?.modes){let ok=false;for(const m of f.modes)if(m==='remote'&&x.md&1||m==='hybrid'&&x.md&2||m==='onsite'&&x.md&4)ok=true;if(!ok)return 0}
  if(f.levels.length&&!skip?.levels&&!f.levels.includes(x.lv))return 0;
  if(f.types.length&&!skip?.types){const ty=x.ty;const ok=f.types.some(t=>t==='Full-time'?(ty==='Full-time'||ty==='Unspecified')&&x.lv!=='intern':ty===t||t==='Internship'&&x.lv==='intern');if(!ok)return 0}
  if(f.cats.length&&!skip?.cats&&!f.cats.some(c=>x.cat.includes(c)))return 0;
  if(f.days&&!skip?.days&&r.ts<Date.now()-f.days*864e5)return 0;
  if((f.minSal||f.hideNoSal)&&!skip?.minSal){if(x.usd==null){if(f.hideNoSal||f.minSal&&f.strictSal)return 0}else if(f.minSal&&x.usd<f.minSal/1000)return 0}
  if(f.english&&!skip?.english&&x.en==='n')return 0;
  if(f.visa&&!skip?.visa&&x.visa!=='y')return 0;if(f.reloc&&!skip?.reloc&&x.reloc!=='y')return 0;
  if(f.intl&&!skip?.intl&&!(x.iw||x.visa==='y'||x.reloc==='y'||x.rs==='w'))return 0;
  if(f.worldwide&&!skip?.worldwide&&!(x.md&1&&x.rs==='w'))return 0;
  if(f.lang&&!skip?.lang){if(f.lang==='none'){if(x.langs.some(l=>l.r&&!(l.l==='en')))return 0}else if(!x.langs.some(l=>l.l===f.lang))return 0}
  return 1}
function resolveF(raw){const n=v=>Array.isArray(v)?v.filter(Boolean):String(v||'').split(',').map(s=>s.trim()).filter(Boolean);
  return {q:String(raw.q||'').slice(0,200),where:String(raw.where||'').slice(0,200),country:String(raw.country||''),city:String(raw.city||''),modes:n(raw.modes),levels:n(raw.levels),types:n(raw.types),cats:n(raw.cats),days:+raw.days||0,minSal:+raw.minSal||0,hideNoSal:!!raw.hideNoSal,
    english:!!raw.english,visa:!!raw.visa,reloc:!!raw.reloc,intl:!!raw.intl,worldwide:!!raw.worldwide,lang:String(raw.lang||''),eligible:!!raw.eligible,minFit:+raw.minFit||0,sort:String(raw.sort||''),unc:raw.unc===undefined||raw.unc===null||raw.unc===''?null:!!raw.unc,home:String(raw.home||'US').toUpperCase().slice(0,2),
    offset:Math.max(0,+raw.offset||0),limit:Math.min(100,Math.max(1,+raw.limit||25)),ids:n(raw.ids)}}
const LRU=new Map();
function create(getStore){let ROWS=null,SRC=null,VER=0,FAC=null;
  const rows=()=>{const st=getStore();if(ROWS&&SRC===st.jobs)return ROWS;ROWS=build(st.jobs);SRC=st.jobs;VER++;LRU.clear();FAC=null;return ROWS};
  const rowById=new Map();const byId=id=>{rows();if(!rowById.size||rowById.get('__v')!==VER){rowById.clear();for(const r of ROWS)rowById.set(r.j.id,r);rowById.set('__v',VER)}return rowById.get(id)};
  function run(raw,P,prefs,opt={}){const f=resolveF(raw),R=rows(),pq=parseQuery(f.q);
    // query words imply filters only when you did not set them yourself
    const imp=pq.imp;if(!f.modes.length&&imp.modes.length)f.modes=[...new Set(imp.modes)];if(!f.levels.length&&imp.levels.length)f.levels=imp.levels;
    if(imp.english)f.english=true;if(imp.visa)f.visa=true;if(imp.reloc)f.reloc=true;if(imp.intl)f.intl=true;
    if(f.city)imp.pieces=[...(imp.pieces||[]),f.city];
    const ps=pieces(f,imp),codes=new Set(ps.flatMap(p=>[...p.countries,...p.remoteCodes])),where=f.home;
    const unc=f.unc!==null?f.unc:(!ps.length||ps.every(p=>[...p.countries,...p.remoteCodes].every(c=>c===f.home)));
    const C=P?F.prep(P,prefs):null;
    const key=opt.noCache?null:JSON.stringify([f,pq.groups.map(g=>g.map(t=>t.t)),imp,P?C&&JSON.stringify([P.yearsExperience,P.skills,P.roles,P.eduLevel]):0,VER]);
    let entry=key&&LRU.get(key);
    if(!entry){const hits=[];let pending=0;
      for(const r of R){if(!filterRow(r,f,ps,unc))continue;
        const lo=locOK(r,ps,unc);if(lo===0)continue;if(lo===2){pending++;continue}
        let sc=0;if(pq.groups.length){for(const g of pq.groups)sc+=scoreGroup(r,g);if(!sc)continue}
        if(ps.length)sc+=localBonus(r,ps);
        if(f.eligible&&F.eligibility(r.j,where).s==='blocked')continue;
        hits.push({r,sc,fit:null})}
      const needFit=C&&(f.sort==='fit'||f.minFit||(!f.sort&&!pq.groups.length));
      if(needFit)for(const h of hits)h.fit=F.fit(h.r.j,C);
      let H=f.minFit?hits.filter(h=>h.fit.score>=f.minFit):hits;
      const age=ts=>ts?Math.max(0,(Date.now()-ts)/864e5):999,fresh=h=>{const a=age(h.r.ts);return a<7?3:a<30?2:a<90?1:0};
      const sort=f.sort||(pq.groups.length||ps.length?'relevance':C?'fit':'new');
      const cmp={relevance:(a,b)=>(b.sc+fresh(b)+(b.fit?b.fit.score/50:0))-(a.sc+fresh(a)+(a.fit?a.fit.score/50:0))||b.r.ts-a.r.ts,new:(a,b)=>b.r.ts-a.r.ts,salary:(a,b)=>(b.r.x.usd??-1)-(a.r.x.usd??-1)||b.r.ts-a.r.ts,fit:(a,b)=>(b.fit?.score??-1)-(a.fit?.score??-1)||b.r.ts-a.r.ts}[sort]||((a,b)=>b.r.ts-a.r.ts);
      if(sort==='relevance'&&C)for(const h of H)if(!h.fit)h.fit=null;
      H.sort(cmp);
      const counts={visa:0,reloc:0,english:0,intl:0,remote:0,hybrid:0,onsite:0};
      for(const h of H){const x=h.r.x;if(x.visa==='y')counts.visa++;if(x.reloc==='y')counts.reloc++;if(x.en!=='n')counts.english++;if(x.iw||x.visa==='y'||x.reloc==='y'||x.rs==='w')counts.intl++;if(x.md&1)counts.remote++;if(x.md&2)counts.hybrid++;if(x.md&4)counts.onsite++}
      entry={H,counts,pending,sort,where,unc};if(key){LRU.set(key,entry);if(LRU.size>14)LRU.delete(LRU.keys().next().value)}}
    const page=entry.H.slice(f.offset,f.offset+f.limit).map(h=>card(h.r,h.fit||(C?F.fit(h.r.j,C):null),entry.where,C));
    const out={jobs:page,total:entry.H.length,offset:f.offset,sort:entry.sort,counts:entry.counts,uncertain:entry.pending,uncertainOn:entry.unc,where:entry.where,parsed:{terms:pq.groups.map(g=>g.map(t=>t.t).join(' ')),...describeImp(imp,ps,f)}};
    if(!entry.H.length&&!opt.noRelax)out.relax=relax(raw,P,prefs);
    return out}
  function describeImp(imp,ps,f){const o={};if(ps.length)o.places=ps.filter(p=>!p.country).map(p=>p.text).filter(Boolean);if(imp.modes.length)o.modes=imp.modes;if(imp.levels.length)o.levels=imp.levels;if(imp.english)o.english=true;if(imp.visa)o.visa=true;if(imp.reloc)o.reloc=true;return o}
  function relax(raw,P,prefs){const f=resolveF(raw),act=[];const keys=[['q','Search words'],['where','Location'],['country','Country'],['city','City'],['modes','Work mode'],['levels','Experience level'],['types','Job type'],['cats','Category'],['days','Date posted'],['minSal','Minimum salary'],['english','English-speaking'],['visa','Visa sponsorship'],['reloc','Relocation'],['intl','International applicants'],['worldwide','Worldwide remote'],['lang','Language'],['minFit','Minimum fit'],['eligible','Eligible for me']];
    for(const [k,l] of keys){const v=f[k];if(Array.isArray(v)?v.length:v)act.push([k,l])}
    const res=[];for(const [k,l] of act){const g={...raw,[k]:Array.isArray(f[k])?[]:(typeof f[k]==='boolean'?false:''),limit:1,offset:0};if(k==='where'){g.city=''}const r=run(g,P,prefs,{noRelax:true,noCache:true});if(r.total>0)res.push({key:k,label:l,count:r.total})}
    return res.sort((a,b)=>b.count-a.count).slice(0,5)}
  function card(r,fit,where,C){const j=r.j,x=r.x;return {id:j.id,title:j.title,company:j.company,loc:j.loc,url:j.url,posted:j.posted,source:j.source,type:x.ty,lv:x.lv,cat:x.cat,usd:x.usd,sal:j.salary,cur:j.cur,
    badges:badges(j),fit:fit?{score:fit.score,label:fit.label,m:fit.m,t:fit.t,n:fit.n,miss:fit.miss,capped:fit.capped}:null,el:F.eligibility(j,where),sk:(x.sk||[]).slice(0,6),ind:x.ind[0]}}
  const COUNTRIES=()=>{rows();if(FAC)return FAC;const cc={},cat={},ci={};let ww=0,rem=0;for(const r of ROWS){for(const c of r.x.cc){cc[c]=(cc[c]||0)+1;for(const city of r.x.ci||[]){const k=c+'|'+city;ci[k]=(ci[k]||0)+1}}for(const c of r.x.cat)cat[c]=(cat[c]||0)+1;if(r.x.rs==='w')ww++;if(r.x.md&1)rem++}
    FAC={countries:Object.entries(cc).map(([code,n])=>({code,name:G.countryName(code),n})).sort((a,b)=>b.n-a.n),cats:E.CATS.map(name=>({name,n:cat[name]||0})),cities:ci,worldwide:ww,remote:rem,total:ROWS.length};return FAC};
  function facets(country){const f=COUNTRIES(),cities=country?Object.entries(f.cities).filter(([k])=>k.startsWith(country+'|')).map(([k,n])=>({name:k.split('|')[1],n})).sort((a,b)=>b.n-a.n).slice(0,80):[];return {countries:f.countries,cats:f.cats,cities,worldwide:f.worldwide,remote:f.remote,total:f.total}}
  function recommend(P,prefs,ctx={}){const R=rows(),C=F.prep(P,prefs),home=(ctx.home||'US').toUpperCase(),targets=(ctx.targets||[]).map(t=>(G.find(t)||{}).code).filter(Boolean);
    const lvPref=prefs?.level||'';const scored=[];for(const r of R){const fit=F.fit(r.j,C);scored.push({r,fit})}
    const norm=t=>t.toLowerCase().replace(/\s*[-–—|(,].*$/,'').replace(/\b(senior|sr|junior|jr|staff|principal|lead|intern|internship|i{1,3}|iv|\d+)\b/g,'').replace(/\s+/g,' ').trim();
    const pick=(arr,n,perCo=2)=>{const seen=new Set(),co={},out=[];for(const h of arr){const k=h.r.c+'|'+norm(h.r.t);if(seen.has(k))continue;if((co[h.r.c]||0)>=perCo)continue;seen.add(k);co[h.r.c]=(co[h.r.c]||0)+1;out.push(h);if(out.length>=n)break}return out};
    const mine=scored.filter(h=>{const e=F.eligibility(h.r.j,home);return e.s!=='blocked'&&(h.r.x.lv!=='intern'||lvPref==='intern')&&h.r.x.en!=='n'||e.s!=='blocked'&&h.fit.score>=70}).sort((a,b)=>b.fit.score-a.fit.score||b.r.ts-a.r.ts);
    const abroad=scored.filter(h=>{const x=h.r.x;if(x.cc.length&&x.cc.every(c=>c===home)&&!(x.md&1&&(x.rs==='w')))return false;
      if(targets.length&&!(x.cc.some(c=>targets.includes(c))||x.md&1&&(x.rs==='w'||h.r.rexp&&targets.some(t=>h.r.rexp.has(t)))))return false;
      const e=F.eligibility(h.r.j,home);const open=x.visa==='y'||x.reloc==='y'||x.rs==='w'||(x.md&1&&h.r.rexp&&h.r.rexp.has(home));return open&&e.s!=='blocked'&&x.lv!=='intern'}).sort((a,b)=>b.fit.score-a.fit.score);
    const abroadCards=pick(abroad,12,2).map(h=>card(h.r,h.fit,home,C));
    const top=mine.slice(0,400),tc={};for(const h of top){const k=norm(h.r.j.title);if(k.length<4)continue;(tc[k]=tc[k]||{n:0,s:0,t:h.r.j.title});tc[k].n++;tc[k].s+=h.fit.score}
    const titles=Object.entries(tc).filter(([k,v])=>v.n>=3).sort((a,b)=>b[1].n-a[1].n).slice(0,10).map(([k,v])=>({title:k.replace(/\b\w/g,c=>c.toUpperCase()),n:v.n,avg:Math.round(v.s/v.n)}));
    return {best:pick(mine,12,2).map(h=>card(h.r,h.fit,home,C)),abroad:abroadCards,titles,abroadPool:abroad.length}}
  let COM=null;const byCompany=()=>{rows();if(COM&&COM.v===VER)return COM.m;const m=new Map();for(const r of ROWS){if(!m.has(r.c))m.set(r.c,[]);m.get(r.c).push(r)}COM={v:VER,m};return m};
  function companyInfo(r){const L=byCompany().get(r.c)||[],cc={},cat={};for(const q of L){q.x.cc.forEach(c=>cc[c]=(cc[c]||0)+1);q.x.cat.slice(0,1).forEach(c=>cat[c]=(cat[c]||0)+1)}
    const top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,5);
    return {name:r.j.company,openJobs:L.length,industry:r.x.ind[0],countries:top(cc).map(([c,n])=>({code:c,name:G.countryName(c),n})),categories:top(cat).map(([name,n])=>({name,n})),
      intl:{visa:L.filter(q=>q.x.visa==='y').length,reloc:L.filter(q=>q.x.reloc==='y').length,worldwideRemote:L.filter(q=>q.x.rs==='w').length},board:r.j.sourceKey}}
  function similar(r,n=5){const L=(byCompany().get(r.c)||[]).filter(q=>q.j.id!==r.j.id&&q.x.cat[0]===r.x.cat[0]);
    const base=new Set(r.t.split(/\W+/).filter(w=>w.length>3));return L.map(q=>({q,s:q.t.split(/\W+/).filter(w=>base.has(w)).length+(q.x.lv===r.x.lv?1:0)})).sort((a,b)=>b.s-a.s).slice(0,n).map(o=>o.q)}
  return {run,facets,recommend,byId,rows,card,relax,companyInfo,similar}}
// ---- badges: one place that turns enriched facts into labels ----
function badges(j){const x=j.x,b=[],names=cs=>cs.slice(0,3).map(G.countryName).join(', ')+(cs.length>3?' +'+(cs.length-3):'');
  if(x.md&1){if(x.rs==='w')b.push({t:'Remote – Worldwide',c:'good',k:'remote'});else if(x.rs==='c')b.push({t:'Remote – Country Restricted ('+names(x.rc)+')',c:'warn',k:'remote'});else if(x.rs==='r')b.push({t:'Remote – '+x.rg.map(r=>r.toUpperCase()).join('/')+' only',c:'warn',k:'remote'});else b.push({t:'Remote – Location Unspecified',c:'mut',k:'remote'})}
  if(x.md&2)b.push({t:'Hybrid',c:'mut',k:'hybrid'});if(x.md&4&&!(x.md&1))b.push({t:'On-site',c:'mut',k:'onsite'});
  if(x.visa==='y')b.push({t:'Visa Sponsorship',c:'good',k:'visa'});else if(x.visa==='n')b.push({t:'No Visa Sponsorship',c:'bad',k:'novisa'});
  if(x.reloc==='y')b.push({t:'Relocation Assistance',c:'good',k:'reloc'});
  if(x.en==='p')b.push({t:'English Speaking',c:'good',k:'en',tip:'English is the working language or the job is in an English-speaking country'});else if(x.en==='o')b.push({t:'English OK',c:'mut',k:'en',tip:'Posted in English and no other language requirement was found'});
  for(const l of x.langs){const nm=Object.keys(M.profile.LNAME).find(k=>M.profile.LNAME[k]===l.l);const T=nm?nm[0].toUpperCase()+nm.slice(1):l.l;if(l.l==='en')continue;b.push({t:T+(l.r?' required':' preferred'),c:l.r?'warn':'mut',k:'lang'})}
  if(x.iw&&x.rs!=='w')b.push({t:'International Applicants Welcome',c:'good',k:'intl'});
  return b}
return {create,parseQuery,badges,resolveF,build}})();
// ===== AI (optional, local, free): Ollama. The fit SCORE never comes from the AI - it only explains, summarises and drafts. =====
M.ai=(()=>{
// Optional env vars: OLLAMA_URL (default http://127.0.0.1:11434)  OLLAMA_MODEL (default llama3.2)  OLLAMA_CTX (default 8192)  OLLAMA_TIMEOUT_SECONDS (default 300)
const OLLAMA=(process.env.OLLAMA_URL||'http://127.0.0.1:11434').replace(/\/+$/,''),WANT=process.env.OLLAMA_MODEL||'llama3.2',
  CTX=+process.env.OLLAMA_CTX||8192,AI_MS=(+process.env.OLLAMA_TIMEOUT_SECONDS||300)*1000;
async function pickModel(){let L;
  try{const r=await fetch(OLLAMA+'/api/tags',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw 0;L=((await r.json()).models||[]).map(m=>m.name)}
  catch{throw new Error(`Cannot reach Ollama at ${OLLAMA}. Install it from https://ollama.com and make sure it is running (open the Ollama app, or run: ollama serve).`)}
  const has=n=>n===WANT||n===WANT+':latest'||(!WANT.includes(':')&&n.startsWith(WANT+':'));
  // If your model isn't installed, fall back to any installed LOCAL model. Cloud models are never auto-picked (your resume would leave this computer).
  const m=L.find(has)||(process.env.OLLAMA_MODEL?null:L.find(n=>!/cloud|embed/i.test(n)));
  if(!m)throw new Error(`Model "${WANT}" is not installed. Open a terminal and run:  ollama pull ${WANT}`);return m}
const unfence=t=>t.replace(/^\s*```\w*\n?/,'').replace(/\n?```\s*$/,'').trim();
async function llm(system,user,model,num_predict){let r;
  try{r=await fetch(OLLAMA+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(AI_MS),
    body:JSON.stringify({model,stream:false,keep_alive:'15m',options:{temperature:0.3,num_ctx:CTX,num_predict},messages:[{role:'system',content:system},{role:'user',content:user}]})})}
  catch(e){throw new Error(e.name==='TimeoutError'?`The AI took longer than ${AI_MS/1000}s. Try a smaller model, or raise OLLAMA_TIMEOUT_SECONDS.`:`Lost connection to Ollama at ${OLLAMA}. Is it still running?`)}
  if(!r.ok){let m='';try{m=(await r.json()).error}catch{}throw new Error('Ollama: '+(m||'HTTP '+r.status))}
  const out=unfence(String((await r.json()).message?.content||''));
  if(!out)throw new Error('The AI returned an empty answer. Try again, or use a larger model.');return out}
const SYS={
tailor:`You are an expert resume editor. You tailor a candidate's existing resume to ONE specific job.
Hard rules:
- Use ONLY facts that appear in the candidate's resume. Never invent employers, job titles, dates, degrees, certifications, tools, skills, numbers or achievements.
- Keep every number, date, company name and contact detail exactly as written.
- You may reword bullet points, reorder sections, bullets and skills, and write a short professional summary, so the most relevant experience comes first and the job's keywords are used where they are truthful.
- Output plain text only: no markdown, no code fences, and no commentary before the resume.
Output format:
1) The complete tailored resume.
2) Then a line containing exactly: === CHANGES ===
3) Then 3 to 6 short lines starting with "\u2022 " describing what you changed, and one final line starting with "\u2022 Not in your resume:" listing job requirements the resume does NOT support, so the candidate does not claim them unless they are true.`,
cover:`You write concise, genuine cover letters. Use ONLY facts from the candidate's resume; never invent experience, numbers or skills.
Write 3 short paragraphs, under 280 words, in plain text with no markdown. Start with "Dear Hiring Team," and end with "Sincerely," followed by the candidate's name from the resume. Name the company and the role, and connect the 2 or 3 most relevant things from the resume to what the job needs. Do not use placeholders in square brackets.`,
explain:`You explain a job-fit result to a job seeker. The score and its breakdown were computed by a separate deterministic system: NEVER change, recompute or contradict them.
Using ONLY the breakdown, the job text and the resume provided, write at most 140 words of plain text (no markdown): 1) why the score is what it is, mentioning experience first, 2) the 1-2 biggest gaps, 3) two concrete next steps. If an eligibility note says the person may need visa sponsorship or a language, say so plainly. Do not invent facts.`,
summary:`You summarise job postings. Use ONLY the posting text. Output plain text, max 120 words, as 5 short lines starting with "\u2022 ": what the role does, the must-have requirements, nice-to-haves, location/work arrangement (including remote restrictions, visa/relocation or language needs if stated), and pay if stated. Do not invent anything.`};
const numSet=s=>new Set((String(s).match(/\d[\d,.]*\d|\d(?=\s*(?:\+|%|years?|yrs?))/gi)||[]).map(x=>x.replace(/,/g,'')));
async function generate(kind,job,resume,model){
  const user=`JOB TITLE: ${job.title}\nCOMPANY: ${job.company}\nLOCATION: ${job.loc}\n\nJOB DESCRIPTION:\n${String(job.desc||'(none provided)').slice(0,5000)}\n\nCANDIDATE RESUME:\n${resume}`;
  let out=await llm(SYS[kind],user,model,kind==='cover'?900:2500),notes='';
  if(kind==='tailor'){const parts=out.split(/^\s*=+\s*CHANGES\s*=+\s*$/im);out=unfence(parts[0]);notes=unfence(parts[1]||'')}
  // cheap fabrication check: numbers in the AI output that never appear in the user's own resume
  const known=numSet(resume),bad=[...numSet(out)].filter(n=>!known.has(n)),warn=[];
  if(bad.length)warn.push('\u26a0 Check these numbers \u2013 they are not in your original resume: '+bad.slice(0,12).join(', ')+'.');
  warn.push('\u2022 AI drafts can contain mistakes. Compare with your original resume and fix anything untrue before you send it.');
  return {text:out,changes:[notes,...warn].filter(Boolean).join('\n')}}
// Grounded explanations: the model receives the computed breakdown, the real posting and the resume
async function explainFit(job,fit,el,resume,model){const b=fit.parts.map(p=>`${p.label}: ${p.pts}/${p.w} - ${p.note}`).join('\n');
  const user=`JOB: ${job.title} at ${job.company} (${job.loc})\nSCORE: ${fit.score}/100 (${fit.label})${fit.capWhy?'\nSCORE LIMITED BECAUSE: '+fit.capWhy:''}\nBREAKDOWN:\n${b}\nMISSING REQUIRED SKILLS: ${fit.missingRequired.join(', ')||'none'}\nELIGIBILITY: ${el.n.join('; ')}\n\nJOB DESCRIPTION:\n${String(job.desc||'').slice(0,3500)}\n\nRESUME:\n${resume.slice(0,6000)}`;
  return llm(SYS.explain,user,model,500)}
async function summarize(job,model){return llm(SYS.summary,`JOB: ${job.title} at ${job.company}\nLOCATION: ${job.loc}\n\n${String(job.desc||'').slice(0,5000)}`,model,450)}
const status=()=>pickModel().then(m=>({ok:true,model:m})).catch(e=>({ok:false,error:e.message}));
const report=()=>pickModel().then(m=>console.log(`Local AI (Ollama) ready: ${m}`)).catch(e=>console.log(`Local AI (Ollama) not ready: ${e.message}\n  Pathfinder still works; the AI buttons switch on once Ollama is running.`));
return {pickModel,generate,explainFit,summarize,status,report,llm}})();
// ===== Web page (browser code). Written as a normal function so it can be edited and checked; the server inlines its body into the page. =====
M.client=(()=>{
function CLIENT(){
// ---------- helpers ----------
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const ago=iso=>{if(!iso)return '';const d=(Date.now()-new Date(iso))/864e5;if(isNaN(d))return '';return d<1?'today':d<2?'yesterday':d<30?Math.floor(d)+' days ago':d<365?Math.floor(d/30)+' mo ago':'over a year ago'};
const money=j=>{if(!j.usd&&!j.sal)return '';const usd=j.usd?'≈ $'+j.usd+'k/yr':'';return j.cur&&j.cur!=='USD'&&j.sal?(usd?usd+' ':'')+'('+j.cur+' '+j.sal+'k)':(usd||'$'+j.sal+'k/yr')};
const LVN={intern:'Internship',entry:'Entry level',junior:'Junior',mid:'Mid-level',senior:'Senior',lead:'Lead / Manager'};
const fitColor=s=>s>=80?'var(--ok)':s>=65?'var(--ac)':s>=45?'var(--warn)':'var(--mut)';
const chip=(a,cls='')=>(a||[]).map(x=>`<span class="chip ${cls}">${esc(x)}</span>`).join('');
// ---------- state ----------
let S=null,tab='jobs',sel=null,DET=null,detErr='',OL={ok:false,model:''},ST={count:0},FAC=null,CITIES=[],PK='',PID='',seq=0,tmr,pollT,JOBS=[],RES=null,loading=false,err='',REC=null,recBusy=false,busy='',CARDS={},SAVEDC=null,obs=null,fOpen=false;
const F0=()=>({q:'',where:'',country:'',city:'',modes:[],levels:[],types:[],cats:[],days:'',minSal:'',hideNoSal:false,worldwide:false,english:false,visa:false,reloc:false,intl:false,lang:'',eligible:false,minFit:0,sort:'',unc:null});
let F={...F0(),...LS.get('pf_filters',{})};
const act=()=>S&&S.resumes.find(r=>r.id===S.active);
let saveT;const save=()=>{clearTimeout(saveT);saveT=setTimeout(()=>fetch('/api/me',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(S)}).catch(()=>{}),400)};
async function api(url,body,method){const r=await fetch(url,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});let d={};try{d=await r.json()}catch(e){}
  if(!r.ok){const e=new Error(d.error||'Server error '+r.status);e.status=r.status;throw e}return d}
const home=()=>(S&&S.prefs.home)||'US';
// The resume is registered once with the server (which analyses it); later requests only send a short id.
async function ensureProfile(){const r=act();if(!r){PID='';PK='';return}const key=r.id+'|'+(S.prefs.roles||'')+'|'+r.text.length;if(key===PK&&PID)return;
  try{const d=await api('/api/profile',{text:r.text,prefs:S.prefs});PID=d.pid;PK=key;const old=JSON.stringify(r.analysis||{});r.analysis=d.analysis;if(JSON.stringify(d.analysis)!==old)save()}catch(e){PID=''}}
async function papi(url,body){await ensureProfile();try{return await api(url,{...body,pid:PID,home:home()})}catch(e){if(e.message==='profile-expired'){PK='';await ensureProfile();return api(url,{...body,pid:PID,home:home()})}throw e}}
// ---------- account ----------
async function login(email,name,pw,mode){email=email.trim().toLowerCase();if(!email||!pw)return alert('Enter email and password.');
  let d;try{d=await api('/api/'+mode,{email,name,pw})}catch(e){return alert(e.status?e.message:'Cannot reach the Pathfinder server. Is it still running?')}
  S=d.user;normS();tab=S.resumes.length?'jobs':'profile';startApp()}
function normS(){S.applied=S.applied||[];S.recent=S.recent||[];S.savedSnap=S.savedSnap||{};S.saved=S.saved||[];S.prefs={home:'US',targets:'',...S.prefs}}
async function logout(){try{await api('/api/logout',{})}catch(e){}S=null;JOBS=[];RES=null;PID='';PK='';render()}
async function boot(){try{S=(await api('/api/me')).user;if(S)normS()}catch(e){}render();if(S)startApp()}
function startApp(){render();checkAI();loadStatus();loadFacets();go(0)}
async function checkAI(){try{OL=await api('/api/ai/status')}catch(e){OL={ok:false}}hdr()}
async function loadStatus(){try{ST=await api('/api/status')}catch(e){}hdr()}
async function loadFacets(country){try{const d=await api('/api/facets'+(country?'?country='+encodeURIComponent(country):''));if(country)CITIES=d.cities;else{FAC=d;CITIES=[]}paintFilters()}catch(e){}}
// ---------- filters ----------
const DEFAULTS=F0();
const isSet=k=>{const v=F[k],d=DEFAULTS[k];return Array.isArray(v)?v.length>0:v!==d&&v!==''&&v!==0&&v!==false&&!(k==='unc'&&v===null)};
const FLABEL={q:v=>'“'+v+'”',where:v=>'Where: '+v,country:v=>'Country: '+((FAC?.countries||[]).find(c=>c.code===v)?.name||v),city:v=>'City: '+v,modes:v=>v.map(m=>({remote:'Remote',hybrid:'Hybrid',onsite:'On-site'}[m])).join(' / '),levels:v=>v.map(l=>LVN[l]).join(' / '),types:v=>v.join(' / '),cats:v=>v.join(' / '),days:v=>'Last '+v+' days',minSal:v=>'Min $'+Number(v).toLocaleString(),hideNoSal:()=>'Salary listed',worldwide:()=>'Remote – Worldwide only',english:()=>'English-speaking',visa:()=>'Visa sponsorship',reloc:()=>'Relocation assistance',intl:()=>'International applicants welcome',lang:v=>v==='none'?'No other language required':'Language: '+v.toUpperCase(),eligible:()=>'Open to my location',minFit:v=>'Fit ≥ '+v+'%',sort:()=>null,unc:()=>null};
const activeKeys=()=>Object.keys(DEFAULTS).filter(k=>isSet(k)&&FLABEL[k]&&FLABEL[k](F[k])!==null);
function setF(k,v){F[k]=v;if(k==='country'){F.city='';CITIES=[];if(v)loadFacets(v)}afterF()}
function togArr(k,v){const a=F[k],i=a.indexOf(v);i<0?a.push(v):a.splice(i,1);afterF()}
function clearF(k){F[k]=Array.isArray(DEFAULTS[k])?[]:DEFAULTS[k];if(k==='country'){CITIES=[]}afterF(true)}
function clearAll(){const keep={sort:F.sort};F={...F0(),...keep};CITIES=[];afterF(true)}
function afterF(redraw){LS.set('pf_filters',F);paintFilters();paintChips();if(redraw)paintBar();go(250)}
function quick(k){if(k==='remote'){F.modes=F.modes.length===1&&F.modes[0]==='remote'?[]:['remote']}
  else if(k==='ES'||k==='JP'){F.country=F.country===k?'':k;F.city='';F.where='';CITIES=[];if(F.country)loadFacets(F.country)}
  else if(k==='worldwide'){F.worldwide=!F.worldwide;if(F.worldwide)F.modes=['remote']}
  else F[k]=!F[k];paintBar();afterF()}
function useProfile(){const p=S.prefs||{},a=act()?.analysis;if(!p.roles&&!p.locations&&!p.level&&!a)return alert('Fill in your Preferences (or upload a resume) on the Profile tab first.');
  const lv={junior:['entry','junior'],mid:['mid'],senior:['senior'],lead:['lead'],intern:['intern']}[p.level]||[];const sal=+p.salary||0;
  F={...F0(),q:p.roles||'',where:String(p.locations||'').split(/[|;]/).join(',').trim(),levels:lv,types:p.type&&p.type!=='Part-time'?[p.type]:[],modes:p.remote==='remote only'?['remote']:[],minSal:sal?(sal<1000?sal*1000:sal):'',sort:act()?'fit':''};
  CITIES=[];paintBar();afterF()}
// ---------- search ----------
function go(delay){clearTimeout(tmr);tmr=setTimeout(()=>runSearch(false),delay??0)}
async function runSearch(append){const my=++seq;if(!append){loading=true;err='';if(tab==='jobs'&&!sel)paintResults()}else{loading=true;paintMore()}
  try{const d=await papi('/api/search',{...F,minSal:F.minSal?+F.minSal:0,days:F.days?+F.days:0,offset:append?JOBS.length:0,limit:25});if(my!==seq)return;
    RES=d;JOBS=append?JOBS.concat(d.jobs):d.jobs;JOBS.forEach(j=>CARDS[j.id]=j);ST={...ST,count:d.count,updated:d.updated,refreshing:d.refreshing};err=''}
  catch(e){if(my!==seq)return;err=e.message}
  loading=false;if(tab==='jobs'&&!sel){paintResults();hdr()}
  clearTimeout(pollT);if(!err&&RES&&!RES.total&&!ST.count&&(ST.refreshing||!ST.updated))pollT=setTimeout(()=>{loadStatus().then(()=>runSearch(false))},4000)}
function relaxF(k){clearF(k)}
// ---------- job cards ----------
function badgesH(b){return `<div class="bd">${(b||[]).map(x=>`<span class="b ${x.c}" ${x.tip?`title="${esc(x.tip)}"`:''}>${esc(x.t)}</span>`).join('')}</div>`}
function cardH(j){const f=j.fit,saved=S.saved.includes(j.id),applied=S.applied.some(a=>a.jobId===j.id),e=j.el||{n:[]};
  const showEl=e.n[0]&&(e.s!=='ok'||!/^Located in/.test(e.n[0]));
  const meta=[j.type&&j.type!=='Unspecified'?j.type:'',LVN[j.lv],money(j),ago(j.posted)].filter(Boolean).join(' · ');
  const miss=new Set(f?.miss||[]);
  return `<article class="card job" onclick="openJob('${j.id}')"><div class="fit" style="--c:${f?fitColor(f.score):'var(--mut)'}">${f?`<div class="ring">${f.score}%</div><small>${esc(f.label)}</small>`:`<div class="ring" style="font-size:11px;border-style:dashed" title="Add a resume in Profile to see how well you fit">fit?</div>`}</div>
  <div class="m"><h3>${esc(j.title)}${applied?' <span class="b good">Applied</span>':''}</h3><div class="co">${esc(j.company)} <span class="mut">· ${esc(j.loc)}</span></div>${badgesH(j.badges)}
  ${showEl?`<div class="el ${e.s}">${e.s==='ok'?'✓':e.s==='blocked'?'✕':'!'} ${esc(e.n[0])}</div>`:''}
  <div class="mut" style="margin-top:4px">${esc(meta)}${f&&f.n?` · ${f.m}/${f.n} required skills${f.t?` (+${f.t} related)`:''}`:''}${f&&f.capped?' · <b>score limited by experience or language requirements</b>':''}</div>
  <div>${(j.sk||[]).map(s=>`<span class="chip ${f?(miss.has(s)?'miss':'have'):''}">${esc(s)}</span>`).join('')}</div></div>
  <button class="save ${saved?'on':''}" title="${saved?'Remove from saved':'Save job'}" onclick="event.stopPropagation();toggleSave('${j.id}')">${saved?'♥':'♡'}</button></article>`}
const skel=n=>Array.from({length:n},()=>'<div class="sk"></div>').join('');
function paintResults(){const el=$('#results');if(!el)return;
  if(err){el.innerHTML=`<div class="note err">Could not load jobs: ${esc(err)}. Is the Pathfinder window still running? <button class="btn s sm" onclick="runSearch(false)">Retry</button></div>`;return}
  if(loading&&!JOBS.length){el.innerHTML=skel(5);return}
  if(!RES){el.innerHTML=skel(3);return}
  let h='';
  if(!RES.total&&!ST.count){h+=`<div class="note info">${ST.refreshing||!ST.updated?'Downloading jobs for the first time. This can take a minute or two, and this page fills in by itself.':'No jobs have been downloaded yet.'} <button class="btn s sm" onclick="api('/api/refresh',{}).then(()=>setTimeout(()=>runSearch(false),800))">Retry download</button></div>`}
  const pr=RES.parsed||{},bits=[];if(pr.terms?.length&&pr.terms.join('')&&F.q)bits.push('keywords: <b>'+esc(pr.terms.join(' · '))+'</b>');if(pr.places?.length)bits.push('place: <b>'+esc(pr.places.join(', '))+'</b>');if(pr.modes?.length&&!F.modes.length)bits.push('<b>'+esc(pr.modes.join('/'))+'</b>');if(pr.levels?.length&&!F.levels.length)bits.push('level: <b>'+esc(pr.levels.join('/'))+'</b>');if(pr.english)bits.push('<b>English-speaking</b>');if(pr.visa)bits.push('<b>visa sponsorship</b>');if(pr.reloc)bits.push('<b>relocation</b>');
  h+=`<div class="row" style="justify-content:space-between;margin-bottom:8px"><div><b>${RES.total.toLocaleString()}</b> jobs${loading?' <span class="mut">updating…</span>':''}${bits.length&&F.q?`<div class="mut">Understood as ${bits.join(' · ')}</div>`:''}</div>
   <div class="row"><label style="margin:0">Sort</label><select style="width:auto" onchange="setF('sort',this.value)">${[['','Best match'],['new','Newest'],['salary','Salary (high to low)'],['fit','Job fit %']].map(([v,t])=>`<option value="${v}" ${F.sort===v||(!F.sort&&!v)?'selected':''} ${v==='fit'&&!act()?'disabled':''}>${t}${v==='fit'&&!act()?' (add resume)':''}</option>`).join('')}</select></div></div>`;
  if(RES.uncertain>0&&F.unc!==true)h+=`<div class="note info">${RES.uncertain} more remote job${RES.uncertain>1?'s':''} do not say where you may work from, so they are hidden for this location. <button class="btn s sm" onclick="setF('unc',true)">Include them</button></div>`;
  else if(F.unc===true&&(F.country||F.where))h+=`<div class="note info">Including remote jobs that do not state an eligible location. <button class="btn s sm" onclick="setF('unc',false)">Hide them</button></div>`;
  if(!JOBS.length&&!loading){h+=`<div class="card"><h3>No jobs match these filters</h3><p class="mut">Try removing a filter:</p><div class="chs">${(RES.relax||[]).map(r=>`<button class="pill" onclick="relaxF('${r.key}')">Remove “${esc(r.label)}” → ${r.count.toLocaleString()} jobs</button>`).join('')||'<span class="mut">Clear all filters to start over.</span>'}</div><p><button class="btn s" onclick="clearAll()">Clear all filters</button></p></div>`}
  h+=JOBS.map(cardH).join('')+`<div id="more"></div>`;el.innerHTML=h;paintMore();observe()}
function paintMore(){const m=$('#more');if(!m)return;m.innerHTML=loading&&JOBS.length?skel(2):RES&&JOBS.length<RES.total?`<p style="text-align:center"><button class="btn s" onclick="runSearch(true)">Show more (${JOBS.length} of ${RES.total.toLocaleString()})</button></p>`:JOBS.length?`<p class="mut" style="text-align:center">End of results</p>`:''}
function observe(){if(obs)obs.disconnect();const m=$('#more');if(!m||!('IntersectionObserver' in window))return;obs=new IntersectionObserver(es=>{if(es[0].isIntersecting&&!loading&&RES&&JOBS.length<RES.total&&!err)runSearch(true)},{rootMargin:'600px'});obs.observe(m)}
function paintChips(){const el=$('#chips');if(!el)return;const ks=activeKeys();el.innerHTML=ks.length?`<div class="active">${ks.map(k=>`<span class="af">${esc(FLABEL[k](F[k]))}<button title="Remove" onclick="clearF('${k}')">×</button></span>`).join('')}<button class="pill" onclick="clearAll()">Clear all</button></div>`:'';const b=$('#fcount');if(b)b.textContent=ks.length?'('+ks.length+')':''}
function toggleSave(id){const i=S.saved.indexOf(id);if(i<0){S.saved.unshift(id);const c=CARDS[id]||(DET&&DET.job.id===id&&DET.job);if(c)S.savedSnap[id]={id,title:c.title,company:c.company,loc:c.loc,url:c.url}}else S.saved.splice(i,1);save();SAVEDC=null;
  if(tab==='jobs'&&sel)render();else if(tab==='jobs')paintResults();else render()}
function markApplied(id){const i=S.applied.findIndex(a=>a.jobId===id);if(i>=0){if(!confirm('Remove this job from your applied list?'))return;S.applied.splice(i,1)}
  else{const j=(DET&&DET.job.id===id&&DET.job)||CARDS[id]||S.savedSnap[id];if(!j)return;S.applied.unshift({jobId:id,title:j.title,company:j.company,loc:j.loc,url:j.url,date:new Date().toISOString(),status:'Applied',notes:''})}save();render()}
// ---------- search bar + filter panel ----------
const FLAGS={ES:'🇪🇸',JP:'🇯🇵'};
function paintBar(){const el=$('#bar');if(!el)return;const rem=F.modes.length===1&&F.modes[0]==='remote';
  el.innerHTML=`<div class="card"><div class="sbar"><div><label>What</label><input id="qq" placeholder="e.g. marketing, remote software engineering, python developer" value="${esc(F.q)}" oninput="F.q=this.value;LS.set('pf_filters',F);go(350)" onkeydown="if(event.key==='Enter'){paintChips();go(0)}"></div>
  <div><label>Where</label><input id="qw" list="places" placeholder="City, state or country (e.g. Spain, Tokyo)" value="${esc(F.where)}" oninput="F.where=this.value;LS.set('pf_filters',F);go(350)" onkeydown="if(event.key==='Enter'){paintChips();go(0)}"><datalist id="places">${(FAC?.countries||[]).map(c=>`<option value="${esc(c.name)}">`).join('')}</datalist></div>
  <div class="row"><button class="btn" onclick="paintChips();go(0)">Search</button><button class="btn s fbtn" onclick="toggleFilters(true)">Filters <span id="fcount"></span></button></div></div>
  <div class="qrow"><div class="rem ${rem?'on':''}" role="switch" aria-checked="${rem}" tabindex="0" onclick="quick('remote')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();quick('remote')}"><span class="sw"></span>Remote only</div>
   <button class="pill ${F.worldwide?'on':''}" onclick="quick('worldwide')" title="Remote jobs that say you can work from anywhere">🌍 Remote – Worldwide</button>
   <button class="pill ${F.country==='ES'?'on':''}" onclick="quick('ES')">${FLAGS.ES} Spain</button><button class="pill ${F.country==='JP'?'on':''}" onclick="quick('JP')">${FLAGS.JP} Japan</button>
   <button class="pill ${F.visa?'on':''}" onclick="quick('visa')">Visa sponsorship</button><button class="pill ${F.english?'on':''}" onclick="quick('english')">English-speaking</button>
   <span style="flex:1"></span><button class="btn s sm" onclick="useProfile()" title="Fill the search from your Profile preferences">Use my profile</button></div></div>`;paintChips()}
function toggleFilters(v){fOpen=v;$('#fpanel')?.classList.toggle('open',v)}
function chipRow(k,opts){return `<div class="chs">${opts.map(([v,t])=>`<button class="pill ${F[k].includes(v)?'on':''}" aria-pressed="${F[k].includes(v)}" onclick="togArr('${k}','${v}')">${t}</button>`).join('')}</div>`}
const chk=(k,t,sub)=>`<label class="chk"><input type="checkbox" ${F[k]?'checked':''} onchange="setF('${k}',this.checked)"><span>${t}${sub?`<br><span class="mut">${sub}</span>`:''}</span></label>`;
function paintFilters(){const el=$('#fpanel');if(!el)return;const c=RES?.counts||{},cs=FAC?.countries||[],tg=String(S?.prefs.targets||'').toLowerCase();
  const top=cs.filter(x=>tg.includes(x.name.toLowerCase())||x.code==='ES'||x.code==='JP');const rest=cs.filter(x=>!top.includes(x));
  el.innerHTML=`<div class="fh"><h3 style="margin:0">Filters</h3><span><button class="btn s sm" onclick="clearAll()">Clear all</button> <button class="btn sm fbtn" onclick="toggleFilters(false)">Done</button></span></div>
  <div class="fg"><b>Work mode</b>${chipRow('modes',[['remote','Remote'],['hybrid','Hybrid'],['onsite','On-site']])}${chk('worldwide','Remote – Worldwide only','Postings that say you can work from anywhere')}</div>
  <div class="fg"><b>Location</b><label>Country</label><select onchange="setF('country',this.value)"><option value="">Any country</option>${[...top,...rest].map(x=>`<option value="${x.code}" ${F.country===x.code?'selected':''}>${esc(x.name)} (${x.n})</option>`).join('')}</select>
   <label>City</label><input list="cities" placeholder="${F.country?'e.g. '+esc(CITIES[0]?.name||'Madrid'):'Pick a country first, or type'}" value="${esc(F.city)}" oninput="F.city=this.value;LS.set('pf_filters',F);go(350)" onblur="paintChips()"><datalist id="cities">${CITIES.map(x=>`<option value="${esc(x.name)}">`).join('')}</datalist>
   <p class="mut" style="margin:6px 0 0">Remote jobs open to the place you search are always included. Remote jobs that don't say where you can work from are shown only if you opt in.</p></div>
  <div class="fg"><b>Working abroad</b>${chk('visa','Visa sponsorship',c.visa!=null?c.visa+' in these results':'')}${chk('reloc','Relocation assistance',c.reloc!=null?c.reloc+' in these results':'')}${chk('english','English-speaking positions','No other language required')}${chk('intl','International applicants welcome')}${chk('eligible','Open to my location','Hide jobs that exclude people living in '+esc((FAC?.countries||[]).find(x=>x.code===home())?.name||home()))}
   <label>Language requirement</label><select onchange="setF('lang',this.value)">${[['','Any'],['none','No other language required'],['es','Spanish'],['ja','Japanese'],['fr','French'],['de','German'],['pt','Portuguese'],['zh','Chinese'],['it','Italian']].map(([v,t])=>`<option value="${v}" ${F.lang===v?'selected':''}>${t}</option>`).join('')}</select></div>
  <div class="fg"><b>Experience level</b>${chipRow('levels',[['intern','Internship'],['entry','Entry level'],['junior','Junior'],['mid','Mid-level'],['senior','Senior'],['lead','Lead / Manager']])}</div>
  <div class="fg"><b>Job type</b>${chipRow('types',[['Full-time','Full-time'],['Part-time','Part-time'],['Contract','Contract'],['Internship','Internship']])}</div>
  <div class="fg"><b>Category</b><select onchange="setF('cats',this.value?[this.value]:[])"><option value="">All categories</option>${(FAC?.cats||[]).filter(x=>x.n).map(x=>`<option ${F.cats[0]===x.name?'selected':''} value="${esc(x.name)}">${esc(x.name)} (${x.n})</option>`).join('')}</select></div>
  <div class="fg"><b>Salary</b><label>Minimum (USD per year)</label><input type="number" min="0" step="5000" placeholder="e.g. 60000" value="${esc(F.minSal)}" oninput="F.minSal=this.value;LS.set('pf_filters',F);go(500)" onblur="paintChips()">${chk('hideNoSal','Only jobs that list a salary')}<span class="mut">Jobs that list no salary are kept unless you tick this. Other currencies are converted to USD.</span></div>
  <div class="fg"><b>Date posted</b><select onchange="setF('days',this.value)">${[['','Any time'],['1','Last 24 hours'],['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days']].map(([v,t])=>`<option value="${v}" ${String(F.days)===v?'selected':''}>${t}</option>`).join('')}</select></div>
  <div class="fg"><b>Job fit</b><select onchange="setF('minFit',+this.value)" ${act()?'':'disabled'}>${[[0,'Any fit'],[45,'Potential match or better (45%+)'],[65,'Good match or better (65%+)'],[80,'Excellent matches only (80%+)']].map(([v,t])=>`<option value="${v}" ${F.minFit===v?'selected':''}>${t}</option>`).join('')}</select>${act()?'':'<span class="mut">Add a resume in Profile to use this.</span>'}</div>`;
  if(fOpen)el.classList.add('open')}
// ---------- job detail ----------
async function openJob(id){sel=id;DET=null;detErr='';tab='jobs';render();window.scrollTo(0,0);
  try{DET=await papi('/api/job',{id});const j=DET.job;S.recent=[{id,title:j.title,company:j.company,loc:j.loc,url:j.url,t:Date.now()},...S.recent.filter(r=>r.id!==id)].slice(0,30);save();SAVEDC=null}
  catch(e){detErr=e.message}
  if(sel===id)render()}
function closeJob(){sel=null;DET=null;render()}
const bullets=a=>a&&a.length?`<ul class="t">${a.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'';
function fitPanel(f){if(!f)return `<div class="card"><h3>Job fit</h3><p class="mut">Upload a resume in <a href="#" onclick="tab='profile';sel=null;render();return false">Profile</a> to see how well you fit this job, with an explanation.</p></div>`;
  return `<div class="card"><div class="row" style="gap:18px;align-items:flex-start"><div class="fit" style="--c:${fitColor(f.score)};width:110px"><div class="ring big">${f.score}%</div><small style="font-size:13px">${esc(f.label)}</small></div>
  <div style="flex:1;min-width:240px"><h3>Why this score</h3><div class="mut">Experience counts most (40%), then skills (25%), role alignment (15%), education (10%), languages (5%) and certifications/other (5%). Calculated from the posting's actual requirements and your resume, not guessed.</div>
  ${f.capWhy?`<div class="note" style="margin-top:8px"><b>Score limited:</b> ${esc(f.capWhy)} ${f.uncapped>f.score?`(Without this limit it would be ${f.uncapped}%.)`:''}</div>`:''}</div></div>
  ${f.parts.map(p=>`<div class="bar"><span>${esc(p.label)}</span><div class="track"><i style="width:${Math.round(p.pts/p.w*100)}%"></i></div><b>${p.pts}/${p.w}</b></div><div class="mut" style="margin:2px 0 0 0;font-size:12.5px">${esc(p.note)}</div>`).join('')}
  <div class="g2" style="margin-top:14px"><div><h4>Strengths</h4>${bullets(f.strengths)||'<span class="mut">None detected yet.</span>'}${f.matched.length?`<div>${chip(f.matched,'have')}</div>`:''}${f.transferable.length?`<div class="mut">Related skills you have: ${chip(f.transferable)}</div>`:''}</div>
  <div><h4>Gaps</h4>${bullets(f.gaps)||'<span class="mut">No major gaps found.</span>'}${f.missingRequired.length?`<div>${chip(f.missingRequired,'miss')}</div>`:''}</div></div>
  ${f.advice.length?`<h4>How to improve your chances</h4>${bullets(f.advice)}`:''}
  <p class="row"><button class="btn s sm" ${busy||!OL.ok?'disabled':''} title="${OL.ok?'Plain-English explanation from your local AI. The score itself is never changed by the AI.':'Start Ollama to enable AI explanations'}" onclick="aiInsight('explain')">${busy==='explain'?'Thinking…':'Explain in plain English (AI)'}</button></p>${DET.aiExplain?`<pre>${esc(DET.aiExplain)}</pre><div class="mut">AI-written from the breakdown above. It can make mistakes.</div>`:''}</div>`}
function intlPanel(d){const x=d.facts,e=d.el,ev=d.evidence,I=d.intl;const cls={ok:'good',check:'warn',blocked:'bad'}[e.s],txt={ok:'Looks open to you',check:'Check eligibility',blocked:'Not open from your location'}[e.s];
  return `<div class="card"><h3>Where you can work from</h3><p><span class="b ${cls}">${txt}</span> <span class="mut">based on living in ${esc((FAC?.countries||[]).find(c=>c.code===home())?.name||home())}</span></p>${bullets([...I.notes])}
  ${ev.visa?`<div class="q">Visa: “${esc(ev.visa)}”</div>`:''}${ev.reloc?`<div class="q">Relocation: “${esc(ev.reloc)}”</div>`:''}${ev.remote?`<div class="q">Remote: “${esc(ev.remote)}”</div>`:''}${ev.intl?`<div class="q">International: “${esc(ev.intl)}”</div>`:''}
  ${!ev.visa&&x.countries.length&&!x.countries.includes((FAC?.countries||[]).find(c=>c.code===home())?.name)?'<p class="mut">The posting says nothing about visa sponsorship. Ask the recruiter before assuming it is available.</p>':''}
  ${I.background?`<details><summary class="mut">General background (not from the posting)</summary><p class="mut">${esc(I.background)}</p></details>`:''}</div>`}
function sumPanel(d){const s=d.summary,f=d.facts;const none=!s.do.length&&!s.need.length&&!s.nice.length;
  return `<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Quick summary</h3><button class="btn s sm" ${busy||!OL.ok?'disabled':''} onclick="aiInsight('summary')">${busy==='summary'?'Summarising…':'Summarise with AI'}</button></div>
  ${d.aiSummary?`<pre>${esc(d.aiSummary)}</pre><div class="mut">AI summary of the posting. It can make mistakes.</div>`:''}
  ${s.do.length?`<h4>What you'll do</h4>${bullets(s.do)}`:''}${s.need.length?`<h4>What they require</h4>${bullets(s.need)}`:''}${s.nice.length?`<h4>Nice to have</h4>${bullets(s.nice)}`:''}${none?bullets(s.fallback):''}
  <div class="mut" style="margin-top:8px">${f.years!=null?'Experience asked: <b>'+f.years+'+ years</b> · ':''}${f.degree?'Degree: <b>'+['','associate','bachelor','master','doctorate'][f.degree]+(f.degreeEq?' or equivalent experience':'')+'</b> · ':''}${f.clearance?'Security clearance mentioned · ':''}${f.studentOnly?'Mentions current students · ':''}</div>
  ${f.skillsReq.length?`<div style="margin-top:6px"><span class="mut">Required skills:</span> ${chip(f.skillsReq)}</div>`:''}${f.skillsPref.length?`<div><span class="mut">Preferred / mentioned:</span> ${chip(f.skillsPref)}</div>`:''}</div>`}
function detailV(){if(detErr)return `<button class="btn s" onclick="closeJob()">← Back to results</button><div class="note err" style="margin-top:12px">${esc(detErr)}</div>`;
  if(!DET)return `<button class="btn s" onclick="closeJob()">← Back to results</button><div style="margin-top:12px">${skel(4)}</div>`;
  const d=DET,j=d.job,saved=S.saved.includes(j.id),applied=S.applied.some(a=>a.jobId===j.id),co=d.company;
  return `<button class="btn s" onclick="closeJob()">← Back to results</button>
  <div class="card" style="margin-top:12px"><h2 style="margin-bottom:2px">${esc(j.title)}</h2><div>${esc(j.company)} <span class="mut">· ${esc(j.loc)}</span></div>${badgesH(d.badges)}
   <div class="mut">${[j.type!=='Unspecified'?j.type:'',LVN[j.lv],j.cat[0],money(j),j.posted?'posted '+ago(j.posted):'','via '+j.source].filter(Boolean).map(esc).join(' · ')}</div>
   <p class="row" style="margin-top:12px"><a class="btn" target="_blank" rel="noopener" href="${esc(j.url)}">Apply on company site ↗</a><button class="btn s" onclick="toggleSave('${j.id}')">${saved?'♥ Saved':'♡ Save job'}</button><button class="btn s" onclick="markApplied('${j.id}')">${applied?'Applied ✓':'Mark as applied'}</button>
   <button class="btn s" ${busy||!act()?'disabled':''} onclick="tailor()">${busy==='tailor'?'Tailoring…':'Tailor my resume'+(OL.ok?' (AI)':'')}</button><button class="btn s" ${busy||!act()||!OL.ok?'disabled':''} title="${OL.ok?'Write a cover letter with your local AI':'Start Ollama to enable this'}" onclick="aiRun('cover')">${busy==='cover'?'Writing…':'Cover letter (AI)'}</button></p></div>
  <div class="dl"><div>${fitPanel(d.fit)}${intlPanel(d)}${sumPanel(d)}
   <div class="card"><h3>Full job description</h3><div class="desc ${DET.full?'':'clamp'}">${esc(j.desc)}</div><p><button class="btn s sm" onclick="DET.full=!DET.full;render()">${DET.full?'Show less':'Show full description'}</button></p></div></div>
  <aside><div class="card"><h3>${esc(co.name)}</h3><div class="mut">${esc(co.industry||'')} · ${co.openJobs} open role${co.openJobs>1?'s':''} here</div>${co.countries.length?`<p class="mut" style="margin:8px 0 2px">Hiring in</p><div>${co.countries.map(c=>`<span class="chip">${esc(c.name)} (${c.n})</span>`).join('')}</div>`:''}
    <p class="mut" style="margin:8px 0 2px">International hiring signals</p><div>${co.intl.visa?`<span class="b good">${co.intl.visa} with visa sponsorship</span> `:''}${co.intl.reloc?`<span class="b good">${co.intl.reloc} with relocation</span> `:''}${co.intl.worldwideRemote?`<span class="b good">${co.intl.worldwideRemote} remote worldwide</span>`:''}${!co.intl.visa&&!co.intl.reloc&&!co.intl.worldwideRemote?'<span class="mut">None mentioned in current postings</span>':''}</div>
    <p><button class="btn s sm" onclick="F=F0();F.q='${esc(co.name).replace(/'/g,"\\'")}';CITIES=[];sel=null;DET=null;tab='jobs';render();go(0)">See all roles at ${esc(co.name)}</button></p></div>
   ${d.similar.length?`<div class="card"><h3>Similar jobs</h3>${d.similar.map(s=>`<div style="margin:8px 0;cursor:pointer" onclick="openJob('${s.id}')"><b>${esc(s.title)}</b><div class="mut">${esc(s.loc)}${s.fit?' · '+s.fit.score+'% fit':''}</div></div>`).join('')}</div>`:''}</aside></div>`}
// ---------- AI actions (the server talks to Ollama; the browser never does) ----------
async function aiInsight(kind){if(!DET)return;busy=kind;render();try{const d=await papi('/api/ai/insight',{kind,id:DET.job.id});if(kind==='explain')DET.aiExplain=d.text;else DET.aiSummary=d.text}catch(e){alert('AI request failed:\n'+e.message)}busy='';render()}
async function aiRun(kind){const r=act(),j=DET&&DET.job;if(!r||!j)return alert('Upload a resume first.');busy=kind;render();
  try{const d=await api('/api/ai/generate',{kind,jobId:j.id,resume:r.text});S.tailored.unshift({id:Date.now(),jobId:j.id,job:(kind==='cover'?'Cover letter: ':'')+j.title+' @ '+j.company,text:d.text,changes:d.changes||'',ai:d.model});save();busy='';tab='tailored';sel=null;render()}
  catch(e){busy='';render();if(kind==='tailor'){if(confirm('AI tailoring failed:\n'+e.message+'\n\nUse the basic (non-AI) tailoring instead?'))tailorBasic()}else alert('AI request failed:\n'+e.message)}}
async function tailor(){if(!OL.ok)await checkAI();return OL.ok?aiRun('tailor'):tailorBasic()}
function tailorBasic(){const r=act(),a=r?.analysis,d=DET,j=d&&d.job;if(!a||!j)return alert('Upload and analyse a resume first.');const need=d.fit?[...d.fit.matched]:[],mine=a.skills||[],first=mine.filter(s=>need.includes(s)),order=[...first,...mine.filter(s=>!first.includes(s))];
  const yrs=a.yearsExperience?a.yearsExperience+' years of experience':'Experience';
  const summary=`${a.currentTitle||'Professional'} with ${yrs}${first.length?', skilled in '+first.join(', '):''}. Applying for ${j.title} at ${j.company}.`;
  const text=[a.name||'','','PROFESSIONAL SUMMARY',summary,'',order.length?'KEY SKILLS':'',order.join(' · '),'','----- ORIGINAL RESUME -----','',r.text].join('\n');
  const miss=d.fit?d.fit.missingRequired:[];const changes=['• Added a targeted summary using only details found in your resume.',first.length?'• Listed job-relevant skills first: '+first.join(', ')+'.':'• No overlap found between your listed skills and this job’s required skills.',miss.length?'• Job requirements not found in your resume (add them only if they are true for you): '+miss.join(', ')+'.':'• Your resume covers all detected required skills.'].join('\n');
  S.tailored.unshift({id:Date.now(),jobId:j.id,job:j.title+' @ '+j.company,text,changes});save();tab='tailored';sel=null;render()}
// ---------- other tabs ----------
async function forYou(force){if(!act())return;if(REC&&!force)return;recBusy=true;render();
  try{REC=await papi('/api/recommend',{targets:String(S.prefs.targets||'').split(',').map(x=>x.trim()).filter(Boolean)})}catch(e){REC={error:e.message}}recBusy=false;render()}
function recV(){if(!act())return `<h2>For you</h2><div class="card"><p>Upload a resume in <a href="#" onclick="tab='profile';render();return false">Profile</a> and Pathfinder will recommend jobs based on your real experience, skills and goals.</p></div>`;
  if(!REC&&!recBusy)forYou();if(recBusy||!REC)return `<h2>For you</h2>${skel(5)}`;if(REC.error)return `<h2>For you</h2><div class="note err">${esc(REC.error)} <button class="btn s sm" onclick="forYou(true)">Retry</button></div>`;
  const tg=String(S.prefs.targets||'');
  return `<div class="row" style="justify-content:space-between"><h2 style="margin:0">For you</h2><button class="btn s sm" onclick="forYou(true)">Refresh</button></div><p class="mut">Ranked by your job-fit score. Jobs that exclude people living in ${esc(home())} are left out.</p>
  <div class="card"><h3>Working abroad</h3><div class="row"><label style="margin:0">Target countries</label><input style="max-width:320px" list="places" value="${esc(tg)}" placeholder="e.g. Spain, Japan" onchange="S.prefs.targets=this.value;save();REC=null;render()"><button class="pill" onclick="S.prefs.targets='Spain, Japan';save();REC=null;render()">Spain + Japan</button></div></div>
  <h3 style="margin-top:18px">Best matches for you</h3>${REC.best.map(cardH).join('')||'<p class="mut">No matches yet.</p>'}
  <h3 style="margin-top:18px">Realistic opportunities abroad${tg?' ('+esc(tg)+')':''}</h3><p class="mut">Jobs outside ${esc(home())} that mention visa sponsorship or relocation help, or remote jobs open worldwide or to people in ${esc(home())}. (${REC.abroadPool} found)</p>${REC.abroad.map(cardH).join('')||'<p class="mut">None found right now for these countries. Try adding more target countries, or search with the Visa sponsorship filter.</p>'}
  <h3 style="margin-top:18px">Job titles you could target</h3><p class="mut">Titles that appear most among your best-fitting jobs (with the average fit).</p><div>${REC.titles.map(t=>`<button class="pill" onclick="F=F0();F.q='${esc(t.title).replace(/'/g,"\\'")}';F.sort='fit';CITIES=[];tab='jobs';sel=null;render();go(0)">${esc(t.title)} · ${t.avg}% · ${t.n} jobs</button>`).join(' ')||'<span class="mut">Not enough data yet.</span>'}</div>
  ${(act().analysis?.suggestedTitles||[]).length?`<h4>From your resume</h4><div>${chip(act().analysis.suggestedTitles)}</div>`:''}`}
async function loadSaved(){const ids=[...new Set([...S.saved,...S.recent.map(r=>r.id)])];if(!ids.length){SAVEDC={jobs:[],missing:[]};return render()}
  try{SAVEDC=await papi('/api/cards',{ids});SAVEDC.jobs.forEach(j=>CARDS[j.id]=j)}catch(e){SAVEDC={jobs:[],missing:ids,error:e.message}}render()}
function savedV(){if(!SAVEDC){loadSaved();return `<h2>Saved jobs</h2>${skel(3)}`}const by=Object.fromEntries(SAVEDC.jobs.map(j=>[j.id,j])),gone=id=>{const s=S.savedSnap[id]||S.recent.find(r=>r.id===id);return `<article class="card job" style="opacity:.75"><div class="m"><h3>${esc(s?.title||id)}</h3><div class="mut">${esc(s?.company||'')} · ${esc(s?.loc||'')} · <b>no longer listed</b> (filled or removed)</div></div><button class="save on" onclick="toggleSave('${id}')">♥</button></article>`};
  const rec=S.recent.filter(r=>!S.saved.includes(r.id)).slice(0,12);
  return `<h2>Saved jobs (${S.saved.length})</h2>${S.saved.map(id=>by[id]?cardH(by[id]):gone(id)).join('')||'<p class="mut">Nothing saved yet. Tap ♡ on any job.</p>'}
  <h2 style="margin-top:24px">Recently viewed</h2>${rec.map(r=>by[r.id]?cardH(by[r.id]):gone(r.id)).join('')||'<p class="mut">Jobs you open will appear here.</p>'}`}
function appliedV(){const ST_=['Applied','Interviewing','Offer','Rejected','Withdrawn'];
  return `<h2>Applications (${S.applied.length})</h2>${S.applied.map((a,i)=>`<div class="card"><div class="row"><div style="flex:1;min-width:200px"><h3>${esc(a.title)}</h3><div class="mut">${esc(a.company)} · ${esc(a.loc)} · applied ${new Date(a.date).toLocaleDateString()}</div></div>
  <select style="width:auto" onchange="S.applied[${i}].status=this.value;save()">${ST_.map(x=>`<option ${a.status===x?'selected':''}>${x}</option>`).join('')}</select>
  <a class="btn s" target="_blank" rel="noopener" href="${esc(a.url)}">Open posting</a><button class="btn s" onclick="S.applied.splice(${i},1);save();render()">Remove</button></div>
  <label>Notes</label><textarea rows="2" onchange="S.applied[${i}].notes=this.value;save()">${esc(a.notes)}</textarea></div>`).join('')||'<p class="mut">No applications yet. Open a job and choose “Mark as applied” after you apply.</p>'}`}
function tailoredV(){return `<h2>Tailored resumes</h2>${S.tailored.map(t=>`<div class="card"><div class="row"><b style="flex:1">${esc(t.job)}</b>${t.ai?`<span class="mut">AI draft · ${esc(t.ai)}</span>`:''}<button class="btn s" onclick="dl(${t.id})">Download</button><button class="btn s" onclick="S.tailored=S.tailored.filter(x=>x.id!==${t.id});save();render()">Delete</button></div><pre>${esc(t.text)}</pre>${t.changes?`<b>${t.ai?'Review notes':'Changes'}</b><pre>${esc(t.changes)}</pre>`:''}</div>`).join('')||'<p class="mut">Open a job and choose “Tailor my resume”.</p>'}`}
function dl(id){const t=S.tailored.find(x=>x.id===id),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t.text],{type:'text/plain'}));a.download='resume-'+t.job.replace(/\W+/g,'-')+'.txt';a.click()}
// ---------- profile ----------
async function analyze(r){busy='analyze';render();try{PK='';S.active=r.id;await ensureProfile();save()}catch(e){alert('Could not analyse resume: '+e.message)}busy='';REC=null;render();go(0)}
async function upload(inp){const f=inp.files[0];if(!f)return;let text='';try{const fd=new FormData();fd.append('file',f);const r=await fetch('/api/resume/parse',{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.error);text=d.text;if(d.lowConfidence)alert('OCR confidence is low ('+d.confidence+'%). Please review the analysis.')}catch(e){alert('Could not read file: '+e.message);return}
  if(!text||text.trim().length<80){alert('No readable text found.');return}const r={id:Date.now(),name:f.name,added:new Date().toLocaleDateString(),text};S.resumes.push(r);S.active=r.id;save();await analyze(r)}
function pasteR(){const t=$('#pt').value;if(t.trim().length<80)return alert('Paste more text.');const r={id:Date.now(),name:'Pasted resume',added:new Date().toLocaleDateString(),text:t};S.resumes.push(r);S.active=r.id;save();analyze(r)}
const LNM={en:'English',es:'Spanish',ja:'Japanese',fr:'French',de:'German',pt:'Portuguese',it:'Italian',zh:'Chinese',ko:'Korean'},LLV={n:'native',f:'fluent',p:'professional',c:'conversational',b:'basic'};
function analysisV(a){return `<div class="g2" style="margin-top:8px"><div><h3>${esc(a.currentTitle)} · ${esc(a.yearsExperience)} yrs (full-time equivalent) · ${esc(a.seniority)}</h3><div class="mut">${esc(a.progression)} Part-time work and internships are counted at a reduced weight; overlapping roles are not double counted.</div>
  <p><b>Skills</b><br>${chip(a.skills)}</p><p><b>Experience by field</b><br>${Object.entries(a.domYears||{}).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`<span class="chip">${esc(k)} · ${v}y</span>`).join('')||'<span class="mut">n/a</span>'}</p>
  <p><b>Languages</b><br>${(a.languages||[]).map(l=>`<span class="chip">${esc(LNM[l.l]||l.l)} · ${LLV[l.lvl]||l.lvl}</span>`).join('')||'<span class="mut">None listed. Add them (e.g. "Spanish (conversational)") so language requirements are scored.</span>'}</p>
  <p><b>Education &amp; certifications</b><br>${chip([...(a.education||[]),...(a.certifications||[])])}</p></div>
  <div><p><b>Suggested titles</b><br>${chip(a.suggestedTitles)}</p><p><b>Career paths</b><br>${chip(a.careerPaths)}</p><p><b>Resume tips</b></p><ul>${(a.improvements||[]).map(x=>`<li>${esc(x)}</li>`).join('')||'<li class="mut">No major issues found.</li>'}</ul></div></div>
  <b>Employment history</b>${(a.history||[]).map(h=>`<div class="tl"><b>${esc(h.title)}</b> · ${esc(h.company)} <span class="mut">${esc(h.period)}${h.partTime?' · part-time':''}${h.intern?' · internship':''}${h.founder?' · founder':''}</span><div class="mut">${esc(h.summary)}</div></div>`).join('')}`}
function profileV(){const p=S.prefs,Fd=(k,l,ph='')=>`<div><label>${l}</label><input value="${esc(p[k])}" placeholder="${esc(ph)}" onchange="S.prefs.${k}=this.value;PK='';REC=null;save()"></div>`;
  const sel_=(k,l,o)=>`<div><label>${l}</label><select onchange="S.prefs.${k}=this.value;REC=null;save()">${o.map(x=>`<option ${p[k]===x?'selected':''}>${x}</option>`)}</select></div>`;
  return `<div class="card"><h2>Preferences</h2><div class="g2">${Fd('roles','Desired roles','e.g. security analyst, IT support')}${Fd('industries','Industries')}${Fd('locations','Preferred locations','e.g. Harrisburg | Pennsylvania')}${Fd('salary','Desired salary (k USD)')}
  ${sel_('level','Experience level',['','intern','junior','mid','senior','lead'])}${sel_('type','Employment type',['','Full-time','Part-time','Contract'])}${sel_('remote','Remote work',['any','remote only','on-site ok'])}
  <div><label>Country you live in</label><select onchange="S.prefs.home=this.value;REC=null;save();go(0)">${(FAC?.countries||[{code:'US',name:'United States'}]).map(c=>`<option value="${c.code}" ${home()===c.code?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
  <div><label>Countries you want to work in</label><input list="places" value="${esc(p.targets)}" placeholder="e.g. Spain, Japan" onchange="S.prefs.targets=this.value;REC=null;save()"></div></div>
  <p class="mut">Your country is used to tell you whether a job is open to you (remote restrictions, visa sponsorship). Target countries shape the “Working abroad” recommendations.</p></div>
  <div class="card"><h2>Resumes</h2><p class="mut">Upload PDF or DOCX. Each upload is kept as a separate version. Dates like “Sep 2022 – May 2026” are read to measure your real experience.</p>
  <input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" onchange="upload(this)"><details style="margin-top:10px"><summary class="mut">Or paste resume text</summary><textarea id="pt" rows="6"></textarea><p><button class="btn s" onclick="pasteR()">Add pasted resume</button></p></details>
  ${busy==='analyze'?'<p class="mut">Analysing resume…</p>':''}
  ${S.resumes.map(r=>`<div class="card" style="margin:10px 0;${r.id===S.active?'border-color:var(--ac)':''}"><div class="row"><b>${esc(r.name)}</b><span class="mut">${r.added}</span><span style="flex:1"></span>
   <button class="btn s" onclick="S.active=${r.id};save();REC=null;PK='';render();go(0)">${r.id===S.active?'Active':'Use'}</button><button class="btn s" onclick="analyze(S.resumes.find(x=>x.id===${r.id}))">Re-analyse</button>
   <button class="btn s" onclick="S.resumes=S.resumes.filter(x=>x.id!==${r.id});if(S.active===${r.id})S.active=S.resumes[0]?.id||null;PK='';REC=null;save();render()">Delete</button></div>${r.analysis&&r.analysis.v===2?analysisV(r.analysis):(r.id===S.active?'':'<p class="mut">Select “Use” to analyse.</p>')}</div>`).join('')}</div>`}
// ---------- shell ----------
function authV(){return `<div class="card auth"><div class="logo" style="font-size:26px">Pathfinder</div><p class="mut">AI job board: real postings, honest eligibility checks and an explainable job-fit score. Your account, resumes and applications are saved on this computer.</p>
<label>Name (new accounts)</label><input id="an"><label>Email</label><input id="ae" type="email"><label>Password</label><input id="ap" type="password" onkeydown="if(event.key==='Enter')login($('#ae').value,$('#an').value,$('#ap').value,'login')">
<p><button class="btn" onclick="login($('#ae').value,$('#an').value,$('#ap').value,'login')">Log in</button> <button class="btn s" onclick="login($('#ae').value,$('#an').value,$('#ap').value,'signup')">Create account</button></p></div>`}
function hdr(){const e=$('#hstat');if(e)e.innerHTML=`${ST.count?ST.count.toLocaleString()+' jobs':''}${ST.refreshing?' · updating…':''} <span title="${OL.ok?'Local AI via Ollama':'Start Ollama to enable AI features'}">${OL.ok?'● AI: '+esc(OL.model):'○ AI off'}</span>`}
function render(){if(!S){$('#app').innerHTML=authV();return}
  const T=[['jobs','Jobs'],['rec','For you'],['saved','Saved'],['applied','Applied'],['tailored','Tailored'],['profile','Profile']];
  const main=tab==='jobs'?(sel?detailV():`<div id="bar"></div><div id="chips"></div><div class="lay"><aside id="fpanel" class="card"></aside><section id="results"></section></div>`):tab==='rec'?recV():tab==='saved'?savedV():tab==='applied'?appliedV():tab==='tailored'?tailoredV():profileV();
  $('#app').innerHTML=`<header><span class="logo">Pathfinder</span><nav>${T.map(([k,l])=>`<button class="${tab===k?'on':''}" onclick="tab='${k}';sel=null;DET=null;${k==='saved'?'SAVEDC=null;':''}render()">${l}</button>`).join('')}</nav><span class="mut" id="hstat"></span><span class="mut hname">${esc(S.name)}</span><button class="btn s sm" onclick="logout()">Log out</button></header><main>${main}</main>`;
  hdr();if(tab==='jobs'&&!sel){paintBar();paintFilters();paintResults()}}
boot();

}
const CSS=`:root{--bg:#f6f7fb;--card:#fff;--tx:#14172b;--mut:#636a85;--bd:#e3e6f0;--ac:#4f46e5;--ac2:#7c3aed;--ok:#059669;--okbg:#e7f6f0;--warn:#b45309;--warnbg:#fdf3e1;--bad:#dc2626;--badbg:#fdeaea;--mbg:#eef0f7;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);color-scheme:light}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0e1020;--card:#171a30;--tx:#eceefb;--mut:#9aa1c4;--bd:#2a2e4d;--ac:#818cf8;--ac2:#a78bfa;--ok:#34d399;--okbg:#10332a;--warn:#fbbf24;--warnbg:#3a2e12;--bad:#f87171;--badbg:#3b1b1f;--mbg:#22264a;color-scheme:dark}}
:root[data-theme=dark]{--bg:#0e1020;--card:#171a30;--tx:#eceefb;--mut:#9aa1c4;--bd:#2a2e4d;--ac:#818cf8;--ac2:#a78bfa;--ok:#34d399;--okbg:#10332a;--warn:#fbbf24;--warnbg:#3a2e12;--bad:#f87171;--badbg:#3b1b1f;--mbg:#22264a;color-scheme:dark}
html{scroll-padding-top:env(safe-area-inset-top,0px)}*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:10px 20px;background:var(--card);border-bottom:1px solid var(--bd);position:sticky;top:env(safe-area-inset-top,0px);z-index:20;flex-wrap:wrap}
.logo{font-weight:800;font-size:18px;background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;background-clip:text;color:transparent}
nav{display:flex;gap:4px;flex:1;flex-wrap:wrap}nav button{background:none;border:0;color:var(--mut);padding:7px 12px;border-radius:8px;cursor:pointer;font:inherit;font-weight:600}
nav button.on{background:var(--bg);color:var(--ac)}main{max-width:1200px;margin:0 auto;padding:16px 20px 60px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:18px;margin-bottom:14px}
h2{margin:0 0 12px;font-size:20px}h3{margin:0 0 4px;font-size:16px}h4{margin:14px 0 6px;font-size:14px}.mut{color:var(--mut);font-size:13px}
input,select,textarea{width:100%;padding:9px 11px;border:1px solid var(--bd);border-radius:9px;background:var(--bg);color:var(--tx);font:inherit}
input[type=checkbox]{width:auto}label{display:block;font-size:12px;font-weight:600;color:var(--mut);margin:10px 0 4px}
.g2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.btn{background:linear-gradient(90deg,var(--ac),var(--ac2));color:#fff;border:0;border-radius:9px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
.btn.s{background:var(--bg);color:var(--tx);border:1px solid var(--bd)}.btn:disabled{opacity:.5;cursor:default}.btn.sm{padding:5px 11px;font-size:13px}
.chip{display:inline-block;padding:2px 9px;border-radius:99px;background:var(--bg);border:1px solid var(--bd);font-size:12px;margin:2px 3px 2px 0}
.chip.miss{border-style:dashed;color:var(--mut)}.chip.have{border-color:var(--ok);color:var(--ok)}
pre{white-space:pre-wrap;background:var(--bg);padding:12px;border-radius:9px;border:1px solid var(--bd);max-height:380px;overflow:auto;font:13px/1.5 inherit}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.hide{display:none!important}.tl{border-left:2px solid var(--bd);padding-left:12px;margin:6px 0 6px 4px}.auth{max-width:380px;margin:60px auto}
/* search bar */
.sbar{display:grid;grid-template-columns:2fr 1.2fr auto;gap:10px;align-items:end}.sbar label{margin-top:0}
.qrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
.rem{display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:99px;border:2px solid var(--bd);background:var(--card);cursor:pointer;font-weight:700;user-select:none}
.rem .sw{width:38px;height:22px;border-radius:99px;background:var(--bd);position:relative;transition:.15s}.rem .sw:after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
.rem.on{border-color:var(--ac);color:var(--ac)}.rem.on .sw{background:var(--ac)}.rem.on .sw:after{left:19px}
.pill{padding:6px 12px;border-radius:99px;border:1px solid var(--bd);background:var(--card);cursor:pointer;font:inherit;font-size:13px;font-weight:600;color:var(--tx)}
.pill.on{background:var(--ac);border-color:var(--ac);color:#fff}
/* layout */
.lay{display:grid;grid-template-columns:270px 1fr;gap:18px;align-items:start}
#fpanel{position:sticky;top:70px;max-height:calc(100vh - 90px);overflow:auto}.fh{display:flex;justify-content:space-between;align-items:center}
.fg{border-top:1px solid var(--bd);padding:10px 0}.fg:first-of-type{border-top:0}.fg>b{font-size:13px}
.chk{display:flex;gap:8px;align-items:flex-start;font-weight:500;color:var(--tx);font-size:14px;margin:6px 0;cursor:pointer}.chk input{margin-top:3px}
.chs{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.active{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.af{display:inline-flex;gap:6px;align-items:center;padding:3px 6px 3px 11px;border-radius:99px;background:var(--mbg);font-size:12px;font-weight:600}
.af button{border:0;background:none;cursor:pointer;color:var(--mut);font-size:15px;line-height:1}
.fbtn{display:none}
/* job cards */
.job{display:flex;gap:14px;align-items:flex-start;cursor:pointer;position:relative;padding:14px 16px;margin-bottom:10px}.job:hover{border-color:var(--ac)}.job .m{flex:1;min-width:0}
.job h3{font-size:16px}.job .co{font-size:14px}
.fit{width:62px;flex:none;text-align:center}.ring{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:16px;border:5px solid var(--c);color:var(--c);margin:0 auto}
.fit small{display:block;font-size:10.5px;line-height:1.15;margin-top:3px;color:var(--c);font-weight:700}
.bd{display:flex;gap:5px;flex-wrap:wrap;margin:7px 0 2px}.b{padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600;background:var(--mbg);color:var(--mut)}
.b.good{background:var(--okbg);color:var(--ok)}.b.warn{background:var(--warnbg);color:var(--warn)}.b.bad{background:var(--badbg);color:var(--bad)}
.el{font-size:12.5px;margin-top:4px}.el.bad{color:var(--bad)}.el.check{color:var(--warn)}.el.ok{color:var(--ok)}
.save{border:0;background:none;font-size:20px;cursor:pointer;color:var(--mut);padding:2px 6px}.save.on{color:#e11d48}
.sk{height:96px;border-radius:14px;background:linear-gradient(90deg,var(--card),var(--mbg),var(--card));background-size:200% 100%;animation:sh 1.2s infinite;border:1px solid var(--bd);margin-bottom:10px}@keyframes sh{to{background-position:-200% 0}}
.note{padding:10px 14px;border-radius:10px;background:var(--warnbg);color:var(--warn);font-size:14px;margin-bottom:10px}.note.err{background:var(--badbg);color:var(--bad)}.note.info{background:var(--mbg);color:var(--tx)}
/* detail */
.dl{display:grid;grid-template-columns:1fr 300px;gap:18px;align-items:start}
.big{width:96px;height:96px;font-size:30px;border-width:8px}.bar{display:grid;grid-template-columns:150px 1fr 56px;gap:10px;align-items:center;font-size:13px;margin-top:8px}
.track{height:8px;background:var(--mbg);border-radius:99px;overflow:hidden}.track i{display:block;height:100%;background:linear-gradient(90deg,var(--ac),var(--ac2))}
.desc{white-space:pre-wrap;line-height:1.6}.desc.clamp{max-height:260px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)}
ul.t{margin:4px 0 8px;padding-left:20px}ul.t li{margin:3px 0}.q{border-left:3px solid var(--ac);padding:4px 10px;margin:6px 0;color:var(--mut);font-size:13px;font-style:italic}
@media(max-width:900px){.lay{grid-template-columns:1fr}.dl{grid-template-columns:1fr}.fbtn{display:inline-block}
 #fpanel{display:none;position:fixed;inset:0;z-index:30;max-height:none;border-radius:0;margin:0;padding-top:calc(18px + env(safe-area-inset-top,0px))}#fpanel.open{display:block}
 .sbar{grid-template-columns:1fr}.bar{grid-template-columns:110px 1fr 50px}header{padding:8px 12px}main{padding:12px}header nav{order:3;flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto}nav button{white-space:nowrap}.hname,#hstat{display:none}}
`;
const body=CLIENT.toString().replace(/^[^{]*\{/,'').replace(/\}\s*$/,'');
const page=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pathfinder – Job Board</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${CSS}</style></head><body><div id="app"></div><script>${body}</script></body></html>`;
return {page}})();
// ===== Server =====
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {fetchAll}=M.adapters,{parseResume,deps}=M.resume;
const PORT=+process.env.PORT||3000,DATA=path.join(__dirname,'pathfinder-data','jobs.json'),EVERY=(process.env.REFRESH_MINUTES===undefined?30:+process.env.REFRESH_MINUTES)*60000,OFFLINE=!!process.env.OFFLINE;
let store={jobs:[],sources:[],updated:null},running=false;
const slim=j=>{const o=j.desc&&j.desc.length>5000?{...j,desc:j.desc.slice(0,5000)}:j;if(o.level!==undefined||o.skills!==undefined||o.industry!==undefined){const{level,skills,industry,...rest}=o;return rest}return o};   // keeps jobs.json small
// ---- currency: salaries are compared in USD. Rates come from fx.json (refreshed daily when online); built-in rates are only a fallback ----
const FXF=path.join(__dirname,'pathfinder-data','fx.json');
let FX={date:'built-in',rates:{USD:1,EUR:.89,GBP:.74,CAD:1.39,AUD:1.43,NZD:1.77,CHF:.82,SEK:9.7,NOK:9.2,DKK:6.6,PLN:3.9,CZK:21.6,HUF:322,RON:4.7,INR:94.6,SGD:1.28,JPY:158,CNY:6.67,HKD:7.85,KRW:1339,BRL:5.47,MXN:18.6,ZAR:16.5,AED:3.67,ILS:3.16,TRY:50,SAR:3.75,PHP:63.5,IDR:18129,THB:33.6,MYR:4.06,ARS:900,CLP:950,COP:4000,ISK:121}};
try{const f=JSON.parse(fs.readFileSync(FXF,'utf8'));if(f&&f.rates&&f.rates.USD)FX=f}catch{}
M.enrich.setFx(FX.rates);
async function refreshFx(){if(OFFLINE)return;const age=Date.now()-new Date(FX.date).getTime();if(FX.date!=='built-in'&&age<864e5)return;
  for(const u of ['https://open.er-api.com/v6/latest/USD','https://api.frankfurter.app/latest?from=USD']){try{const r=await fetch(u,{signal:AbortSignal.timeout(8000)});if(!r.ok)continue;const d=await r.json(),rates=d.rates;
      if(rates&&rates.EUR&&rates.JPY){FX={date:new Date().toISOString().slice(0,10),rates:{USD:1,...rates}};M.enrich.setFx(FX.rates);for(const j of store.jobs)if(j.x)j.x.usd=M.enrich.toUSDk(j.salary,j.cur);
        fs.mkdirSync(path.dirname(FXF),{recursive:true});fs.writeFileSync(FXF,JSON.stringify(FX));console.log('Exchange rates updated.');return}}catch{}}}
function enrichAll(){const t=Date.now();let n=0;for(const j of store.jobs)if(!j.x||j.x.v!==M.enrich.VERSION){j.x=M.enrich.enrich(j);n++}
  if(n)console.log(`Analysed ${n} postings (work mode, remote scope, visa, relocation, languages, skills) in ${((Date.now()-t)/1000).toFixed(1)}s.`);return n}
function saveStore(){fs.mkdirSync(path.dirname(DATA),{recursive:true});fs.writeFileSync(DATA+'.tmp',JSON.stringify(store));fs.renameSync(DATA+'.tmp',DATA)}
(function loadStore(){try{fs.rmSync(DATA+'.tmp',{force:true})}catch{}
  if(!fs.existsSync(DATA))return console.log('No saved jobs yet - downloading them now (first run takes a minute or two).');
  try{const s=JSON.parse(fs.readFileSync(DATA,'utf8'));if(!Array.isArray(s.jobs))throw new Error('no jobs list inside');store=s;const now=Date.now();store.jobs=store.jobs.map(j=>({...slim(j),seen:j.seen||now}));console.log(`Loaded ${s.jobs.length} saved jobs.`);
    if(enrichAll())try{saveStore()}catch(e){console.log('Could not save analysed jobs:',e.message)}}
  catch(e){const bad=path.join(path.dirname(DATA),'jobs.damaged.json');
    try{fs.renameSync(DATA,bad);console.log(`The saved jobs file was damaged (${e.message}). Moved it to ${path.basename(bad)} (safe to delete) and downloading fresh jobs.`)}
    catch{console.log(`The saved jobs file was damaged (${e.message}). Downloading fresh jobs.`)}}})();
// Duplicates: same id, same title+company+location, or the same posting URL. Postings that vanished from a board that was reachable are dropped by the refresh itself.
const normUrl=u=>String(u||'').toLowerCase().replace(/[?#].*$/,'').replace(/\/+$/,'');
const dedupe=L=>{const s=new Set(),o=[];for(const j of L){if(!j.title||!j.url)continue;const k2=[j.title,j.company,j.loc].join('|').toLowerCase().replace(/\s+/g,' '),k3='u:'+normUrl(j.url);if(s.has(j.id)||s.has(k2)||s.has(k3))continue;s.add(j.id);s.add(k2);s.add(k3);o.push(j)}return o};
async function refresh(){if(running||OFFLINE)return;running=true;
  try{if(!store.updated)console.log('Downloading jobs from every board - the first run with many companies can take a few minutes...');const r=await fetchAll(cfg),ok=new Set(r.sources.filter(s=>s.ok).map(s=>s.key)),now=Date.now();
    // boards that answered replace their old jobs (closed postings disappear); boards that failed keep theirs for up to 14 days
    const keep=store.jobs.filter(j=>!ok.has(j.sourceKey)&&(j.seen||now)>now-14*864e5);
    const fresh=r.jobs.map(j=>({...slim(j),seen:now}));
    store={jobs:dedupe([...fresh,...keep]),sources:r.sources.filter(s=>!s.missing),updated:new Date().toISOString()};enrichAll();saveStore();
    const shown=r.sources.filter(s=>!s.missing),bad=shown.filter(s=>!s.ok),notFound=r.sources.filter(s=>s.missing&&(!s.error||/404/.test(s.error))).length,
      unreachable=r.sources.filter(s=>s.probe&&s.missing&&s.error&&!/404/.test(s.error)).length;
    console.log(`Jobs refreshed: ${store.jobs.length} jobs from ${shown.length-bad.length} job boards (${notFound} company/platform combinations not found and skipped${bad.length?', '+bad.length+' failed':''})`);
    if(unreachable)console.log(`  ${unreachable} optional boards could not be reached just now (network?) - they will be retried next refresh`);
    r.sources.filter(s=>s.missing&&!s.probe).forEach(s=>console.log(`  not found: ${s.key} - check the spelling of the board name`));
    bad.forEach(s=>console.log(`  failed: ${s.key} - ${s.error}`))}
  catch(e){console.error('Refresh failed:',e.message)}finally{running=false}}
const readBody=(req,max)=>new Promise((ok,no)=>{const c=[];let n=0;req.on('data',d=>{n+=d.length;if(n>max){no(new Error('File too large'));req.destroy();return}c.push(d)});req.on('end',()=>ok(Buffer.concat(c)));req.on('error',no)});
const send=(res,code,obj,h={})=>{res.writeHead(code,{'Content-Type':'application/json',...h});res.end(JSON.stringify(obj))};
const json=async(req,max=3e6)=>{const t=(await readBody(req,max)).toString();try{return JSON.parse(t||'{}')}catch{throw Object.assign(new Error('Bad request'),{code:400})}};
// ---- accounts: scrypt-hashed passwords, cookie sessions, data saved to pathfinder-data/users.json ----
const UF=path.join(__dirname,'pathfinder-data','users.json');let DB={users:{},sessions:{}};
try{DB=JSON.parse(fs.readFileSync(UF,'utf8'));DB.users=DB.users||{};DB.sessions=DB.sessions||{}}catch{}
const saveDB=()=>{fs.mkdirSync(path.dirname(UF),{recursive:true});fs.writeFileSync(UF+'.tmp',JSON.stringify(DB));fs.renameSync(UF+'.tmp',UF)};
const hashPw=(pw,salt)=>crypto.scryptSync(pw,salt,64).toString('hex');
const blank=()=>({prefs:{roles:'',industries:'',locations:'',salary:'',level:'',type:'',remote:'any',home:'US',targets:''},resumes:[],active:null,tailored:[],saved:[],applied:[],recent:[],savedSnap:{}});
const pub=u=>({email:u.email,name:u.name,...blank(),...u.data});
const authed=req=>{const c=(req.headers.cookie||'').split(/;\s*/).find(x=>x.startsWith('pf='));const s=c&&DB.sessions[c.slice(3)];return s&&s.exp>Date.now()?DB.users[s.email]:null};
const fails=new Map();
function multipart(buf,ct){const b=/boundary=(?:"([^"]+)"|([^;]+))/.exec(ct||'');if(!b)return null;const bd=Buffer.from('--'+(b[1]||b[2]));
  let pos=buf.indexOf(bd);while(pos>=0){const next=buf.indexOf(bd,pos+bd.length);if(next<0)break;const part=buf.subarray(pos+bd.length+2,next-2),he=part.indexOf('\r\n\r\n');
    const m=/filename="([^"]*)"/.exec(part.subarray(0,he).toString('utf8'));if(m)return {originalname:m[1],buffer:part.subarray(he+4)};pos=next}return null}
// ---- search, profiles ----
const S=M.search.create(()=>store);
const PROF=new Map();   // pid -> {P,prefs}; the browser registers a resume once and then only sends the short id with each search
function registerProfile(text,prefs){text=String(text||'').slice(0,40000);const P=M.profile.analyze(text);P._text=text;
  const pid=crypto.createHash('sha1').update(text+'|'+JSON.stringify(prefs?.roles||'')+'|'+M.fit.W.exp).digest('hex').slice(0,16);
  PROF.set(pid,{P,prefs:prefs||{}});if(PROF.size>30)PROF.delete(PROF.keys().next().value);const {_text,roles,...view}=P;return {pid,analysis:view}}
const prof=pid=>pid&&PROF.get(pid)||null;
const INTL_BG={ES:'Spain: non-EU citizens generally need an employer-sponsored work authorization (look for the "Visa Sponsorship" tag). Spain also has a visa aimed at remote workers employed by non-Spanish companies. Rules change, so confirm requirements with the Spanish consulate or official government sites.',
  JP:'Japan: work visas (for example Engineer/Specialist in Humanities/International Services) are usually sponsored by the employer and generally depend on a relevant degree or years of experience. Japan also has a digital-nomad visa for remote workers. Rules change, so confirm with the Japanese embassy or official government sites.'};
function intlNotes(j,x,el,P){const n=[...el.n];const L=Object.fromEntries((P?.languages||[]).map(l=>[l.l,l.lvl]));const LN={f:'fluent',n:'native',p:'professional',c:'conversational',b:'basic'};
  for(const l of x.langs){const nm=Object.keys(M.profile.LNAME).find(k=>M.profile.LNAME[k]===l.l)||l.l;if(l.l==='en')continue;n.push(`${nm[0].toUpperCase()+nm.slice(1)} is ${l.r?'required':'preferred'}${l.d?' (about '+({f:'business/fluent',c:'conversational',b:'basic'}[l.d])+' level)':''}${P?'; your resume shows '+(L[l.l]?LN[L[l.l]]:'no level listed'):''}.`)}
  if(x.en==='o'&&x.cc.some(c=>!['US','GB','IE','CA','AU','NZ','SG'].includes(c)))n.push('No language requirement was listed and the posting is in English, but the working language of the local team is not stated.');
  const bg=x.cc.map(c=>INTL_BG[c]).filter(Boolean)[0]||null;return {notes:n,background:bg}}
function detail(id,pid,home,where){const r=S.byId(id);if(!r)return null;const j=r.j,x=r.x,sec=M.enrich.sections(j.desc),ent=prof(pid),b=a=>a.map(l=>l.replace(/\s+/g,' ').slice(0,260)).slice(0,7);
  const fit=ent?M.fit.fit(j,M.fit.prep(ent.P,ent.prefs),{detail:true}):null,el=M.fit.eligibility(j,where||home||'US');
  const fallback=(j.desc||'').split(/(?<=[.!?])\s+/).filter(s=>s.length>40).slice(0,3);
  return {job:{id:j.id,title:j.title,company:j.company,loc:j.loc,url:j.url,posted:j.posted,source:j.source,type:x.ty,lv:x.lv,cat:x.cat,usd:x.usd,sal:j.salary,cur:j.cur,desc:j.desc},badges:M.search.badges(j),fit,el,
    facts:{years:x.yr,degree:x.dg,degreeEq:x.dgEq,langs:x.langs,certs:x.certs,skillsReq:x.sk,skillsPref:x.skp,clearance:!!x.clr,studentOnly:!!x.stu,remoteScope:x.rs,remoteCountries:x.rc.map(M.geo.countryName),countries:x.cc.map(M.geo.countryName)},
    evidence:M.enrich.evidence(j.desc),summary:{do:b(sec.resp),need:b(sec.req),nice:b(sec.pref),fallback:sec.resp.length||sec.req.length?[]:fallback},intl:intlNotes(j,x,el,ent?.P),company:S.companyInfo(r),
    similar:S.similar(r).map(q=>S.card(q,null,where||home||'US',null))}}
const handle=async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost'),p=u.pathname,g=k=>u.searchParams.get(k)||'',post=req.method==='POST';
  if(req.method==='GET'&&(p==='/'||p==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(M.client.page)}
  if(req.method==='GET'&&p==='/api/status'){const by={};for(const j of store.jobs)by[j.source]=(by[j.source]||0)+1;const f=S.facets('');
    return send(res,200,{count:store.jobs.length,companies:new Set(store.jobs.map(j=>j.company)).size,updated:store.updated,refreshing:running,sources:by,countries:f.countries.length,fx:FX.date,offline:OFFLINE})}
  if(req.method==='GET'&&p==='/api/facets')return send(res,200,S.facets(g('country').toUpperCase()));
  if(post&&p==='/api/profile'){const b=await json(req,2e6);if(String(b.text||'').trim().length<40)return send(res,400,{error:'Resume text is empty.'});return send(res,200,registerProfile(b.text,b.prefs))}
  if(post&&p==='/api/search'){const b=await json(req);const ent=prof(b.pid);if(b.pid&&!ent)return send(res,409,{error:'profile-expired'});
    return send(res,200,{...S.run(b,ent?.P,ent?.prefs),count:store.jobs.length,updated:store.updated,refreshing:running})}
  if(post&&p==='/api/recommend'){const b=await json(req),ent=prof(b.pid);if(!ent)return send(res,409,{error:'profile-expired'});
    return send(res,200,S.recommend(ent.P,ent.prefs,{home:b.home,targets:b.targets}))}
  if(post&&p==='/api/job'){const b=await json(req);if(b.pid&&!prof(b.pid))return send(res,409,{error:'profile-expired'});const d=detail(String(b.id||''),b.pid,String(b.home||'US').toUpperCase(),b.where&&String(b.where).toUpperCase());if(!d)return send(res,404,{error:'This job is no longer listed (it may have been filled or removed).'});return send(res,200,d)}
  if(post&&p==='/api/cards'){const b=await json(req),ent=prof(b.pid),C=ent?M.fit.prep(ent.P,ent.prefs):null,home=String(b.home||'US').toUpperCase();const jobs=[],missing=[];
    for(const id of (b.ids||[]).slice(0,300)){const r=S.byId(id);if(!r){missing.push(id);continue}jobs.push(S.card(r,C?M.fit.fit(r.j,C):null,home,C))}return send(res,200,{jobs,missing})}
  if(post&&p==='/api/refresh'){refresh();return send(res,200,{started:!OFFLINE})}
  if(req.method==='GET'&&p==='/api/ai/status')return send(res,200,await M.ai.status());
  if(post&&p==='/api/ai/insight'){const b=await json(req),r=S.byId(String(b.id||''));if(!r)return send(res,404,{error:'Job not found.'});
    try{const model=await M.ai.pickModel();
      if(b.kind==='summary')return send(res,200,{text:await M.ai.summarize(r.j,model),model});
      const ent=prof(b.pid);if(!ent)return send(res,409,{error:'profile-expired'});const fit=M.fit.fit(r.j,M.fit.prep(ent.P,ent.prefs),{detail:true}),el=M.fit.eligibility(r.j,String(b.home||'US').toUpperCase());
      return send(res,200,{text:await M.ai.explainFit(r.j,fit,el,ent.P._text,model),model})}catch(e){return send(res,502,{error:e.message})}}
  if(post&&p==='/api/ai/generate'){if(!authed(req))return send(res,401,{error:'Not logged in'});
    const b=await json(req,2e6),job=store.jobs.find(j=>j.id===b.jobId),resume=String(b.resume||'').trim().slice(0,12000);
    if(!job)return send(res,404,{error:'Job not found. Refresh the job list and try again.'});
    if(resume.length<80)return send(res,400,{error:'Your resume text is empty. Upload a resume first.'});
    try{const model=await M.ai.pickModel(),out=await M.ai.generate(b.kind==='cover'?'cover':'tailor',job,resume,model);return send(res,200,{...out,model})}
    catch(e){return send(res,502,{error:e.message})}}
  if(post&&p==='/api/resume/parse'){const f=multipart(await readBody(req,20e6),req.headers['content-type']);if(!f)return send(res,400,{error:'No file uploaded'});
    const r=await parseResume(f);if((r.text||'').trim().length<80)return send(res,422,{error:'No readable text found in this file.'});
    return send(res,200,{...r,text:r.text.trim(),lowConfidence:r.confidence!=null&&r.confidence<60})}
  if(post&&(p==='/api/signup'||p==='/api/login')){const b=await json(req,1e5),email=String(b.email||'').trim().toLowerCase(),pw=String(b.pw||'');
    if(!/^\S+@\S+\.\S+$/.test(email))return send(res,400,{error:'Enter a valid email address.'});
    const fk=req.socket.remoteAddress+email,f=fails.get(fk);if(f&&f.n>=8&&Date.now()-f.t<9e5)return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});
    if(p==='/api/signup'){if(pw.length<6)return send(res,400,{error:'Password must be at least 6 characters.'});
      if(DB.users[email])return send(res,409,{error:'An account with this email already exists. Use Log in.'});
      const salt=crypto.randomBytes(16).toString('hex');DB.users[email]={email,name:String(b.name||'').trim()||email.split('@')[0],salt,hash:hashPw(pw,salt),created:new Date().toISOString(),data:blank()}}
    const u=DB.users[email];let good=false;if(u){const a=Buffer.from(hashPw(pw,u.salt),'hex'),h=Buffer.from(u.hash,'hex');good=a.length===h.length&&crypto.timingSafeEqual(a,h)}
    if(!good){fails.set(fk,{n:(f&&Date.now()-f.t<9e5?f.n:0)+1,t:Date.now()});return send(res,401,{error:'Wrong email or password.'})}
    fails.delete(fk);const tok=crypto.randomBytes(24).toString('hex');DB.sessions[tok]={email,exp:Date.now()+30*864e5};
    for(const k of Object.keys(DB.sessions))if(DB.sessions[k].exp<Date.now())delete DB.sessions[k];saveDB();
    return send(res,200,{user:pub(u)},{'Set-Cookie':`pf=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30*86400}`})}
  if(post&&p==='/api/logout'){const c=(req.headers.cookie||'').split(/;\s*/).find(x=>x.startsWith('pf='));if(c){delete DB.sessions[c.slice(3)];saveDB()}return send(res,200,{ok:true},{'Set-Cookie':'pf=; HttpOnly; Path=/; Max-Age=0'})}
  if(p==='/api/me'){const u=authed(req);if(!u)return req.method==='GET'?send(res,200,{user:null}):send(res,401,{error:'Not logged in'});
    if(req.method==='GET')return send(res,200,{user:pub(u)});
    if(req.method==='PUT'){const b=await json(req,15e6);u.data=u.data||blank();
      for(const k of ['prefs','resumes','active','tailored','saved','applied','recent','savedSnap'])if(k in b)u.data[k]=b[k];
      if(typeof b.name==='string'&&b.name.trim())u.name=b.name.trim();saveDB();return send(res,200,{ok:true})}}
  send(res,404,{error:'Not found'})}catch(e){send(res,e.code===400?400:500,{error:e.message})}};
const server=http.createServer(handle);
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${PORT} is already in use. Close the other program, or use another port (cmd: set PORT=3001  then  node pathfinder.js).`:e.message);process.exit(1)});
const s6=http.createServer(handle);s6.on('error',()=>{});s6.listen(PORT,'::1');  // also answer on IPv6 localhost
server.listen(PORT,process.env.HOST||'127.0.0.1',()=>{console.log(`\nPathfinder is running ->  http://localhost:${PORT}   (or http://127.0.0.1:${PORT})\nAccounts and jobs are saved in: ${path.dirname(DATA)}\nCtrl+C to stop.\n`);
  refresh();refreshFx();M.ai.report();if(EVERY>0)setInterval(refresh,EVERY);setInterval(refreshFx,6*36e5);setTimeout(()=>deps().catch(e=>console.log('Resume libraries not ready yet:',e.message)),3000)});
