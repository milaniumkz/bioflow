/** Records actual application workflows against synthetic loopback data only. */
const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto'),{spawnSync}=require('child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.COLLECTION_TUTORIAL_FIXTURE||'work/tutorial-fixture.json'));
if(!['127.0.0.1','localhost'].includes(new URL(fixture.api).hostname))throw Error('Tutorial recorder refuses a live API');
const catalog=JSON.parse(fs.readFileSync('apps/web/app/collection/tutorial-catalog.json'));
const timing=JSON.parse(fs.readFileSync('work/tutorial-voice-timings.json'));
const base=process.env.COLLECTION_TUTORIAL_WEB||'http://127.0.0.1:3198';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Tutorial recorder requires loopback web');
async function api(path,body,role='owner'){const actor=fixture.roles[role];const login=await fetch(fixture.api+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:actor.phone,password:actor.password,platform:'web'})});const token=(await login.json()).accessToken;const r=await fetch(fixture.api+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(path+' HTTP '+r.status);return d;}
async function rawArrival(){const t=await api('/collection/trips',{idempotencyKey:randomUUID(),warehouseId:fixture.heliosId,bagCount:8,weightKg:'400'},'collector');const c=await fetch(fixture.api+'/collection-driver/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t.qrToken,clientToken:randomUUID()+randomUUID(),plateNumber:'003 ABC 01',phone:'+70000000102'})});const driver=await c.json();for(const type of ['LOADED','DEPARTED','ARRIVED']){const r=await fetch(fixture.api+'/collection-driver/events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+driver.token},body:JSON.stringify({requestId:randomUUID(),type,recordedAt:new Date().toISOString()})});if(!r.ok)throw Error('Arrival fixture failed');}return t;}
async function run(){
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{for(const item of catalog.filter(x=>x.role!=='driver')){
  if(fs.existsSync(`work/tutorial-final/${item.id}.mp4`)&&fs.statSync(`work/tutorial-final/${item.id}.mp4`).size>10000){console.log('Already rendered:',item.id);continue;}
  const videoDir=path.resolve('work/tutorial-raw',item.id);fs.mkdirSync(videoDir,{recursive:true});
  const context=await browser.newContext({viewport:{width:430,height:900},deviceScaleFactor:2,recordVideo:{dir:videoDir,size:{width:430,height:900}},permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
  await context.addInitScript(()=>{document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='@keyframes lessonTap{from{transform:translate(-50%,-50%) scale(.35);opacity:1}to{transform:translate(-50%,-50%) scale(1.5);opacity:0}} .lesson-ripple{position:fixed;border:4px solid #ffb632;background:#ffbd4b33;width:44px;height:44px;border-radius:50%;pointer-events:none;z-index:2147483647;animation:lessonTap .9s ease-out forwards}';document.head.append(style);document.addEventListener('pointerdown',e=>{const dot=document.createElement('span');dot.className='lesson-ripple';dot.style.left=e.clientX+'px';dot.style.top=e.clientY+'px';document.body.append(dot);setTimeout(()=>dot.remove(),1000);},true);});});
  const page=await context.newPage();const created=Date.now();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const tap=async locator=>{await locator.scrollIntoViewIfNeeded();await locator.hover();await page.waitForTimeout(180);await locator.click();await page.waitForTimeout(350);};
  const fill=async(label,value,scope=page)=>{const field=scope.getByLabel(label,{exact:true});await tap(field);await field.fill('');await field.pressSequentially(String(value),{delay:65});};
  const select=async(label,value)=>{const field=page.getByLabel(label,{exact:true});await tap(field);await field.selectOption(value);await page.keyboard.press('Escape');};
  const tab=async name=>{await tap(page.getByRole('button',name==='Уведомления'?{name:/^Уведомления/}:{name,exact:true}));};
  const actor=fixture.roles[item.role];const slug=item.id.split('--')[1];let target,qrTrip;
  try{
   // Isolated scene preparation is omitted from the recorded action segment.
   if(item.role==='warehouse'&&['receipt','notifications'].includes(slug))target=await rawArrival();
   if(item.role==='factory'&&['receipt','notifications'].includes(slug))target=await api('/collection/shipments',{idempotencyKey:randomUUID(),locationId:fixture.heliosId,factoryId:fixture.factoryId,bagCount:2,weightKg:'100'},'warehouse');
   await page.goto(base+'/collection',{waitUntil:'domcontentloaded'});
   if(slug!=='login'){
    await page.getByLabel('Телефон или email',{exact:true}).fill(actor.phone);await page.getByLabel('Пароль',{exact:true}).fill(actor.password);await page.getByRole('button',{name:'Войти в Collection →',exact:true}).click();await page.getByRole('button',{name:'Видеоинструкции',exact:true}).waitFor();
   }else await page.getByLabel('Телефон или email',{exact:true}).waitFor({state:'visible'});
   if(item.role==='collector'&&['save','print'].includes(slug))qrTrip=fixture.routeTrip;
   await page.waitForTimeout(800);const startOffset=(Date.now()-created)/1000;await page.waitForTimeout(1200);
   const steps=[];
   async function step(i,action){const before=Date.now();if(action)await action();const voice=timing[item.id][i];const elapsed=(Date.now()-before)/1000;await page.waitForTimeout(Math.max(0,(voice.seconds+.8-elapsed)*1000));steps.push({audio:voice.file,text:voice.text,seconds:(Date.now()-before)/1000});}
   if(slug==='login'){
    await step(0,()=>fill('Телефон или email',actor.phone));
    await step(1,async()=>{await fill('Пароль',actor.password);await tap(page.getByRole('button',{name:'Войти в Collection →',exact:true}));await page.getByRole('button',{name:'Видеоинструкции',exact:true}).waitFor();});await step(2);
   }else if(item.role==='owner'&&slug==='overview'){
    await step(0,()=>page.locator('.c-stats').first().scrollIntoViewIfNeeded());await step(1,()=>tab('Склады и заводы'));await step(2,()=>tab('Движение'));
   }else if(slug==='route'){
    const roleTab=item.role==='owner'?'Перевозки':item.role==='collector'?'Мои отправки':'Доставка ГП';const id=item.role==='factory'?fixture.gp.id:fixture.routeTrip.id;
    await step(0,async()=>{await tab(roleTab);await page.locator('#c-item-'+id).scrollIntoViewIfNeeded();});
    await step(1,async()=>{await tap(page.locator('#c-item-'+id).getByRole('button',{name:'Маршрут на карте',exact:true}));await page.locator('#c-item-'+id+' .leaflet-container').waitFor();});
    await step(2,async()=>{const c=page.locator('#c-item-'+id);await tap(c.getByRole('button',{name:'Весь маршрут',exact:true}));await page.waitForTimeout(600);await tap(c.getByRole('button',{name:'Последняя позиция',exact:true}));});
    if(item.steps.length>3)await step(3);
   }else if(slug==='notifications'){
    await step(0,()=>tab('Уведомления'));
    await step(1,async()=>{const button=target?page.locator('.c-card').filter({hasText:target.number}).getByRole('button',{name:/Открыть/}).first():page.getByRole('button',{name:/Открыть/}).first();await tap(button);});
    await step(2,async()=>{if(target&&['warehouse','factory'].includes(item.role)){await tap(page.locator('#c-item-'+target.id).getByRole('button',{name:'Подтвердить приход',exact:true}));}else await page.waitForTimeout(500);});
   }else if(item.role==='owner'&&slug==='people'){
    await step(0,()=>tab('Люди'));await step(1,()=>page.locator('.c-card').last().scrollIntoViewIfNeeded());await step(2,()=>tab('Перевозки'));
   }else if(item.role==='owner'&&slug==='factory'){
    await step(0,async()=>{await tab('Обзор');await page.getByLabel('Название завода',{exact:true}).scrollIntoViewIfNeeded();});await step(1,()=>fill('Название завода','Учебный завод 2'));await step(2,()=>tap(page.getByRole('button',{name:'Добавить завод',exact:true})));
   }else if(item.role==='collector'&&slug==='create'){
    await step(0,async()=>{await tab('Мои отправки');await select('На какой склад',fixture.heliosId);});await step(1,async()=>{await fill('Количество мешков','10');await fill('Общий вес всех мешков, кг','500');});await step(2,()=>tap(page.getByRole('button',{name:'Создать отправку и QR',exact:true})));await step(3,()=>page.locator('dialog').waitFor({state:'visible'}));
   }else if(item.role==='collector'&&['save','print'].includes(slug)){
    await step(0,async()=>{await tab('Мои отправки');await tap(page.locator('#c-item-'+qrTrip.id).getByRole('button',{name:'Открыть QR',exact:true}));});
    if(slug==='save'){await step(1,()=>tap(page.getByRole('button',{name:'Сохранить PNG',exact:true})));await step(2,()=>tap(page.getByRole('button',{name:'Отправить как фото',exact:true})));}
    else{await step(1,()=>tap(page.getByRole('button',{name:'Распечатать',exact:true})));await step(2,()=>page.emulateMedia({media:'print'}));}
   }else if(item.role==='warehouse'&&slug==='receipt'){
    await step(0,()=>tab('Приход сырья'));await step(1,()=>page.locator('#c-item-'+target.id).scrollIntoViewIfNeeded());await step(2,async()=>{await tap(page.locator('#c-item-'+target.id).getByRole('button',{name:'Подтвердить приход',exact:true}));await tab('Остатки и мойка');});
   }else if(item.role==='warehouse'&&slug==='wash'){
    await step(0,()=>tab('Остатки и мойка'));await step(1,()=>fill('Создать мытое на Гелиос, тонн','0.2'));await step(2,()=>tap(page.getByLabel('Создать мытое на Гелиос, тонн',{exact:true}).locator('xpath=ancestor::form').getByRole('button',{name:'Перевести в мытое',exact:true})));
   }else if(item.role==='warehouse'&&slug==='shipment'){
    await step(0,async()=>{await tab('На завод');await select('Со склада',fixture.heliosId);await select('На завод',fixture.factoryId);});await step(1,async()=>{await fill('Количество бигбегов','4');await fill('Общий вес, кг','240');});await step(2,()=>tap(page.locator('form.c-form').getByRole('button').last()));await step(3);
   }else if(item.role==='warehouse'&&slug==='stock'){
    await step(0,()=>tab('Остатки и мойка'));await step(1,()=>page.locator('.c-stats').first().scrollIntoViewIfNeeded());await step(2,()=>page.locator('.c-location-grid').first().scrollIntoViewIfNeeded());
   }else if(item.role==='factory'&&slug==='receipt'){
    await step(0,()=>tab('Приход на завод'));await step(1,()=>page.locator('#c-item-'+target.id).scrollIntoViewIfNeeded());await step(2,async()=>{await tap(page.locator('#c-item-'+target.id).getByRole('button',{name:'Подтвердить приход',exact:true}));await tab('Остатки');});
   }else if(item.role==='factory'&&slug==='production'){
    await step(0,async()=>{await tab('Производство');await select('Завод',fixture.factoryId);});
    const fieldset=name=>page.locator('fieldset').filter({has:page.locator('legend').getByText(name,{exact:true})});
    await step(1,async()=>{const f=fieldset('Готовая продукция');await fill('Количество бигбегов','1',f);await fill('Бигбег 1, кг','80',f);});await step(2,async()=>{const f=fieldset('Некондиция');await fill('Количество бигбегов','1',f);await fill('Бигбег 1, кг','5',f);});await step(3,()=>tap(page.getByRole('button',{name:'Подтвердить выпуск',exact:true})));
   }else if(item.role==='factory'&&slug==='dispatch'){
    await step(0,async()=>{await tab('Доставка ГП');await select('С завода',fixture.factoryId);await fill('Получатель','Учебный получатель');await fill('Адрес доставки','Пример адреса доставки');});await step(1,()=>tap(page.getByRole('checkbox').first()));await step(2,()=>tap(page.getByRole('button',{name:'Создать доставку ГП и QR',exact:true})));await step(3,()=>page.locator('dialog').waitFor({state:'visible'}));
   }else if(item.role==='factory'&&slug==='stock'){
    await step(0,()=>tab('Остатки'));await step(1,()=>tab('Производство'));await step(2,()=>page.getByRole('heading',{name:'Выпущенные партии',exact:true}).scrollIntoViewIfNeeded());
   }else throw Error('Unrecorded lesson '+item.id);
   if(errors.length)throw Error(errors.join('\n'));
   const video=await page.video().path();await context.close();
   const meta={...item,video,startOffset,segments:steps};const json=`work/tutorial-raw/${item.id}.json`;fs.writeFileSync(json,JSON.stringify(meta,null,2));
   const rendered=spawnSync('python3',['infrastructure/tutorials/render.py',json],{stdio:'inherit'});if(rendered.status!==0)throw Error('Render failed '+item.id);
   console.log('Completed lesson:',item.id);
  }catch(error){await page.screenshot({path:`work/tutorial-raw/${item.id}-failure.png`,fullPage:true}).catch(()=>{});await context.close().catch(()=>{});throw error;}
 }}finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1});
