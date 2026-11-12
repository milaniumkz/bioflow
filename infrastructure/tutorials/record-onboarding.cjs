/** Real onboarding UI, synthetic loopback users, Russian narrated videos. */
const fs=require('fs'),{spawnSync}=require('child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const catalog=JSON.parse(fs.readFileSync('apps/web/app/collection/tutorial-catalog.json'));
const timing=JSON.parse(fs.readFileSync('work/tutorial-voice-timings.json'));
const base=process.env.COLLECTION_TUTORIAL_WEB||'http://127.0.0.1:3198';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Onboarding recorder requires loopback');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
try{for(const item of catalog.filter(i=>/--(register|install)$/.test(i.id))){
if(fs.existsSync('work/tutorial-final/'+item.id+'.mp4'))continue;
const context=await browser.newContext({viewport:{width:430,height:900},recordVideo:{dir:'work/tutorial-raw',size:{width:430,height:900}}});
await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
const style=document.createElement('style');style.textContent='@keyframes tap{from{transform:translate(-50%,-50%) scale(.4);opacity:1}to{transform:translate(-50%,-50%) scale(1.5);opacity:0}}.tap{position:fixed;width:44px;height:44px;border:4px solid #ffb632;background:#ffbd4b33;border-radius:50%;pointer-events:none;z-index:2147483647;animation:tap .9s ease-out forwards}';document.head.append(style);document.addEventListener('pointerdown',e=>{const d=document.createElement('span');d.className='tap';d.style.left=e.clientX+'px';d.style.top=e.clientY+'px';document.body.append(d);setTimeout(()=>d.remove(),1000)},true);
}));
const page=await context.newPage();page.setDefaultTimeout(20000);const created=Date.now(),segments=[];
const tap=async locator=>{await locator.scrollIntoViewIfNeeded();await locator.click();await page.waitForTimeout(350)};
const fill=async(label,value)=>{const field=page.getByLabel(label,{exact:true});await tap(field);await field.pressSequentially(value,{delay:45})};
const step=async(i,fn)=>{const start=Date.now();await fn();const voice=timing[item.id][i];await page.waitForTimeout(Math.max(0,(voice.seconds+.8)*1000-(Date.now()-start)));segments.push({audio:voice.file,text:voice.text,seconds:(Date.now()-start)/1000})};
try{
const signup=item.id.endsWith('--register');
await page.goto(base+(signup?'/collection?mobile=1':'/collection/install?mobile=1'));
if(signup)await page.getByRole('button',{name:'Создать аккаунт',exact:true}).waitFor();
await page.waitForTimeout(500);const startOffset=(Date.now()-created)/1000;await page.waitForTimeout(1200);
if(signup){
let index=0;
await step(index++,async()=>{await tap(page.getByRole('button',{name:'Создать аккаунт',exact:true}));const role=item.role==='collector'?'COLLECTOR':item.role==='warehouse'?'WAREHOUSE_MANAGER':'FACTORY_MANAGER';await tap(page.getByLabel('Ваша роль',{exact:true}));await page.getByLabel('Ваша роль',{exact:true}).selectOption(role);await page.keyboard.press('Escape')});
if(item.role!=='collector')await step(index++,async()=>{const label=item.role==='warehouse'?'Выберите мойку':'Выберите завод';await tap(page.getByLabel(label,{exact:true}));await page.getByLabel(label,{exact:true}).selectOption({label:item.role==='warehouse'?'Гелиос':'СЭЗ'});await page.keyboard.press('Escape')});
await step(index++,async()=>{await fill('ФИО','Учебный сотрудник');await fill('Номер телефона','+799'+String(Date.now()).slice(-8));await fill('Придумайте пароль','123456')});
await step(index++,async()=>{await tap(page.getByRole('button',{name:'Зарегистрироваться и войти',exact:true}));await page.getByRole('button',{name:'Видеоинструкции',exact:true}).waitFor()});
}else{
await step(0,async()=>{await tap(page.getByRole('heading',{name:'Android',exact:true}));await page.getByRole('link',{name:item.role==='driver'?'Collection Driver — для водителя':'Collection — для сотрудников',exact:true}).hover()});
await step(1,()=>tap(page.getByText('Откройте скачанный APK в «Загрузках».',{exact:true})));
await step(2,()=>tap(page.getByRole('heading',{name:'iPhone',exact:true})));
await step(3,()=>tap(page.getByRole('heading',{name:'Как пользоваться',exact:true})));
}
const video=await page.video().path();await context.close();const meta={...item,video,startOffset,segments};const file='work/tutorial-raw/'+item.id+'.json';fs.writeFileSync(file,JSON.stringify(meta));const result=spawnSync('python3',['infrastructure/tutorials/render.py',file],{stdio:'inherit'});if(result.status)throw Error('Render failed');console.log('Completed onboarding',item.id);
}catch(e){await page.screenshot({path:'work/tutorial-raw/'+item.id+'-failure.png'}).catch(()=>{});await context.close().catch(()=>{});throw e}
}}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
