/** Synthetic training data; never runs against the live database. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrapCollection} from '../../apps/backend/prisma/bootstrap-collection';
import {applyOpeningBalances} from '../../apps/backend/prisma/opening-collection';
const requireBackend=createRequire(resolve('apps/backend/package.json'));
const {PrismaClient}=requireBackend('@prisma/client');
const argon=requireBackend('argon2');
const db=new PrismaClient();
const api=process.env.COLLECTION_TUTORIAL_API??'http://127.0.0.1:4198/api/v1';
if(!new URL(process.env.DATABASE_URL??'').pathname.endsWith('_tutorial_spec')||!['localhost','127.0.0.1'].includes(new URL(api).hostname))throw Error('Training fixtures require an isolated tutorial_spec database and loopback API');
process.env.COLLECTION_ORGANIZATION_ID='collection-lessons';
async function call(path:string,body?:any,token?:string){const r=await fetch(api+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(path+' HTTP '+r.status);return data;}
(async()=>{
 const org=await bootstrapCollection(db);const locations=await db.collectionLocation.findMany({where:{organizationId:org.id}});const helios=locations.find((l:any)=>l.code==='HELIOS');
 await applyOpeningBalances(db,{effectiveDate:'2026-11-11',balances:[{warehouseCode:'HELIOS',state:'RAW',tonnes:'6'},{warehouseCode:'HELIOS',state:'WASHED',tonnes:'2'},{warehouseCode:'ZHANA_AUL',state:'RAW',tonnes:'7'},{warehouseCode:'EKIBASTUZ',state:'RAW',tonnes:'3'},{warehouseCode:'TEC3',state:'RAW',tonnes:'4'}]});
 const roles:any={};let i=1;
 for(const [key,code,name] of [['owner','OWNER','Учебный владелец'],['collector','COLLECTOR','Учебный сборщик'],['warehouse','WAREHOUSE_MANAGER','Учебный ответственный склада'],['factory','FACTORY_MANAGER','Учебный ответственный завода']]){
  const role=await db.role.findUniqueOrThrow({where:{code}});const phone='+7000000000'+i++;
  const user=await db.user.create({data:{organizationId:org.id,fullName:name,phone,passwordHash:await argon.hash('123456'),mustChangePassword:false,accessAllObjects:key==='owner',userRoles:{create:{roleId:role.id}}}});
  roles[key]={id:user.id,phone,password:'123456',...await call('/auth/login',{phone,password:'123456',platform:'web'})};
 }
 const factory=await call('/collection/factories',{idempotencyKey:randomUUID(),name:'Учебный завод'},roles.owner.accessToken);
 for(const [actor,locationId] of [[roles.warehouse,helios.id],[roles.factory,factory.id]])await db.collectionMembership.create({data:{userId:actor.id,locationId}});
 async function trip(active=true){
  const row=await call('/collection/trips',{idempotencyKey:randomUUID(),warehouseId:helios.id,bagCount:12,weightKg:'600'},roles.collector.accessToken);
  const driver=await call('/collection-driver/claim',{token:row.qrToken,clientToken:randomUUID()+randomUUID(),plateNumber:'001 ABC 01',phone:'+70000000100'});
  const coords=Array.from({length:45},(_,j)=>({sequence:j+1,latitude:52.284-j*.00013+Math.sin(j*.3)*.0002,longitude:76.949+j*.00022,accuracy:8,recordedAt:new Date(Date.now()-30000+j*400).toISOString()}));
  await call('/collection-driver/points',{points:coords},driver.token);
  for(const type of ['LOADED','DEPARTED',...(!active?['ARRIVED']:[])])await call('/collection-driver/events',{requestId:randomUUID(),type,recordedAt:new Date().toISOString()},driver.token);
  return {...row,driverToken:driver.token};
 }
 const routeTrip=await trip();const receiptTrip=await trip(false);
 const shipment=await call('/collection/shipments',{idempotencyKey:randomUUID(),locationId:helios.id,factoryId:factory.id,bagCount:5,weightKg:'1500'},roles.warehouse.accessToken);
 await call('/collection/shipments/'+shipment.id+'/confirm',{idempotencyKey:randomUUID()},roles.factory.accessToken);
 const pendingShipment=await call('/collection/shipments',{idempotencyKey:randomUUID(),locationId:helios.id,factoryId:factory.id,bagCount:2,weightKg:'200'},roles.warehouse.accessToken);
 await call('/collection/production',{idempotencyKey:randomUUID(),locationId:factory.id,finished:[{weightKg:'100'},{weightKg:'100'}],rejected:[{weightKg:'20'}]},roles.factory.accessToken);
 const state=await call('/collection/state',undefined,roles.factory.accessToken);
 const bag=state.batches.find((b:any)=>b.state==='FINISHED').bags.find((b:any)=>b.status==='AVAILABLE');
 const gp=await call('/collection/gp-trips',{idempotencyKey:randomUUID(),locationId:factory.id,recipientName:'Учебный получатель',recipientAddress:'Пример адреса доставки',bagIds:[bag.id]},roles.factory.accessToken);
 const gpDriver=await call('/collection-driver/claim',{token:gp.qrToken,clientToken:randomUUID()+randomUUID(),plateNumber:'002 ABC 01',phone:'+70000000101'});
 for(const type of ['LOADED','DEPARTED'])await call('/collection-driver/events',{requestId:randomUUID(),type,recordedAt:new Date().toISOString()},gpDriver.token);
 await call('/collection-driver/points',{points:Array.from({length:40},(_,j)=>({sequence:j+1,latitude:52.28-j*.0001,longitude:76.97+j*.00018,accuracy:10,recordedAt:new Date(Date.now()-25000+j*350).toISOString()}))},gpDriver.token);
 const nativeTrip=await call('/collection/trips',{idempotencyKey:randomUUID(),warehouseId:helios.id,bagCount:8,weightKg:'400'},roles.collector.accessToken);
 writeFileSync(process.env.COLLECTION_TUTORIAL_FIXTURE??'work/tutorial-fixture.json',JSON.stringify({api,roles,organizationId:org.id,heliosId:helios.id,factoryId:factory.id,routeTrip,receiptTrip,pendingShipment,gp:{...gp,driverToken:gpDriver.token},nativeTrip},null,2),{mode:0o600});
 console.log('Synthetic training fixture ready; no live database accessed');
})().finally(()=>db.$disconnect());
