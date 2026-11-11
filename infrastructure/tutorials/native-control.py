"""Disposable-emulator controller for genuine Driver UI tutorial recordings."""
import base64,http.server,io,json,os,subprocess,time,threading,urllib.request,urllib.error,xml.etree.ElementTree as ET
from pathlib import Path
import websocket
from PIL import Image
ADB=os.environ.get('ANDROID_HOME',os.environ.get('ANDROID_SDK_ROOT',''))+'/platform-tools/adb'
PKG='kz.milanium.collection_driver'
root=Path('work/native-tutorial-raw');root.mkdir(parents=True,exist_ok=True)
media=Path(os.environ.get('COLLECTION_TUTORIAL_MEDIA','work/native-tutorial-media'));media.mkdir(parents=True,exist_ok=True)
fixture=json.loads(Path('work/tutorial-fixture.json').read_text())
catalog={i['id']:i for i in json.loads(Path('apps/web/app/collection/tutorial-catalog.json').read_text())}
timings=json.loads(Path('infrastructure/tutorials/voice-duration-data.json').read_text())
if not urllib.parse.urlparse(fixture['api']).hostname in ['127.0.0.1','localhost']:raise RuntimeError('Refusing live API')
def adb(*args):return subprocess.check_output([ADB,*args],stderr=subprocess.STDOUT)
if adb('shell','getprop','ro.kernel.qemu').strip()!=b'1':raise RuntimeError('Disposable emulator required')
record=None;current=None;offline=False
api=fixture['api']
def request(path,body=None,token=None):
 req=urllib.request.Request(api+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
 return json.load(urllib.request.urlopen(req,timeout=15))
def new_trip():
 import uuid
 actor=fixture['roles']['collector'];token=request('/auth/login',{'phone':actor['phone'],'password':actor['password'],'platform':'web'})['accessToken']
 trip=request('/collection/trips',{'idempotencyKey':str(uuid.uuid4()),'warehouseId':fixture['heliosId'],'bagCount':8,'weightKg':'400'},token)
 fixture['nativeTrip']=trip;push_photo(trip)
 return trip
def push_photo(trip):
 photo=root/'qr.png';photo.write_bytes(base64.b64decode(trip['qrImage'].split(',')[1]));adb('shell','mkdir','-p','/sdcard/Pictures')
 adb('push',str(photo),'/sdcard/Pictures/collection-qr.png');adb('shell','am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file:///sdcard/Pictures/collection-qr.png')
def ui():
 adb('shell','uiautomator','dump','/sdcard/tutorial-ui.xml');return ET.fromstring(adb('shell','cat','/sdcard/tutorial-ui.xml'))
def tap_node(n):
 import re
 nums=list(map(int,re.findall(r'\d+',n.get('bounds',''))))
 if len(nums)==4:adb('shell','input','tap',str((nums[0]+nums[2])//2),str((nums[1]+nums[3])//2))
def permissions():
 seen=False;empty=0
 for _ in range(10):
  tree=ui();nodes=list(tree.iter('node'));choice=next((n for n in nodes if n.get('resource-id','').endswith('permission_location_accuracy_radio_fine')),None)
  if choice is not None:tap_node(choice)
  button=next((n for n in nodes if n.get('resource-id','').endswith(('permission_allow_foreground_only_button','permission_allow_button'))),None)
  if button is None:
   empty+=1
   if seen and empty>=2:break
   time.sleep(.6);continue
  seen=True;empty=0;tap_node(button);time.sleep(.8)
def resume():adb('shell','monkey','-p',PKG,'-c','android.intent.category.LAUNCHER','1');time.sleep(.6)
def cdp(expr):
 pid=adb('shell','pidof',PKG).decode().strip().split()[0];adb('forward','tcp:9223','localabstract:webview_devtools_remote_'+pid)
 targets=json.load(urllib.request.urlopen('http://127.0.0.1:9223/json'))
 target=next(t for t in targets if t.get('type')=='page' and '/collection/' in t.get('url',''))
 ws=websocket.create_connection(target['webSocketDebuggerUrl'],suppress_origin=True,timeout=20)
 try:
  ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expr,'returnByValue':True}}))
  while True:
   r=json.loads(ws.recv())
   if r.get('id')==1:return r.get('result',{}).get('result',{}).get('value')
 finally:ws.close()
def web_tap(text=None,video=False):
 for _ in range(25):
  try:
   selector="document.querySelector('video')" if video else "[...document.querySelectorAll('button,[role=button]')].find(e=>e.textContent.trim()==="+json.dumps(text)+")"
   rect=cdp("(()=>{const e="+selector+";if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:innerWidth};})()")
   if not rect:time.sleep(.5);continue
   tree=ui();wv=next(n for n in tree.iter('node') if n.get('class')=='android.webkit.WebView')
   import re
   box=list(map(int,re.findall(r'\d+',wv.get('bounds'))));scale=(box[2]-box[0])/rect['w']
   adb('shell','input','tap',str(round(box[0]+rect['x']*scale)),str(round(box[1]+rect['y']*scale)));return
  except Exception:time.sleep(.6)
 raise RuntimeError('Web control not ready')
def choose_photo():
 for _ in range(20):
  nodes=list(ui().iter('node'));photo=next((n for n in nodes if n.get('resource-id','').endswith(('icon_thumbnail','media_item_thumbnail'))),None)
  if photo is not None:tap_node(photo);return
  time.sleep(.7)
 raise RuntimeError('Photo picker thumbnail not found')
def save_video():
 for _ in range(20):
  nodes=list(ui().iter('node'));button=next((n for n in nodes if n.get('text','').strip().lower() in ['сохранить','save'] and n.get('enabled')=='true'),None)
  if button is not None:tap_node(button);return
  time.sleep(.6)
 raise RuntimeError('Native save dialog unavailable')
class Control(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  data={'fixture':fixture,'catalog':catalog,'timings':timings}
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(data).encode())
 def do_POST(self):
  global record,current,offline
  try:
   body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or '{}');path=self.path
   print('Control operation',path,body.get('id',''),flush=True)
   if path=='/start':
    current=body['id']
    if current not in catalog or catalog[current]['role']!='driver':raise RuntimeError('Unknown lesson')
    record=subprocess.Popen([ADB,'shell','screenrecord','--bit-rate','2000000','--size','540x1200','/sdcard/tutorial.mp4'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(.8);result={}
   elif path=='/stop':
    adb('shell','pkill','-2','screenrecord');record.wait(timeout=15);adb('pull','/sdcard/tutorial.mp4',str(root/(current+'.mp4')))
    native=catalog[current];segments=[{'seconds':seconds,'audio':f'work/tutorial-voices/{current}--{i:02}.mp3','text':native['steps'][i]} for i,seconds in enumerate(body['durations'])]
    (root/(current+'.json')).write_text(json.dumps({**native,'video':str(root/(current+'.mp4')),'startOffset':0,'segments':segments},ensure_ascii=False,indent=2))
    if os.environ.get('TUTORIAL_CAPTURE_TAG'):
     subprocess.run(['gh','release','upload',os.environ['TUTORIAL_CAPTURE_TAG'],str(root/(current+'.mp4')),str(root/(current+'.json')),'--repo',os.environ['GITHUB_REPOSITORY'],'--clobber'],check=True)
    result={} 
   elif path=='/permissions':permissions();result={}
   elif path=='/background':adb('shell','input','keyevent','3');time.sleep(1);adb('shell','cmd','statusbar','expand-notifications');result={}
   elif path=='/resume':adb('shell','cmd','statusbar','collapse');resume();result={}
   elif path=='/offline':offline=True;result={}
   elif path=='/online':offline=False;result={}
   elif path=='/new-trip':result=new_trip()
   elif path=='/photo':choose_photo();result={}
   elif path=='/web-tap':web_tap(body.get('text'),body.get('video',False));result={}
   elif path=='/save-video':save_video();result={}
   elif path=='/prepare-help':
    import shutil
    shutil.copyfile(root/'driver--start.mp4',media/'driver--start.mp4');Image.open(io.BytesIO(adb('exec-out','screencap','-p'))).convert('RGB').save(media/'driver--start.jpg');result={}
   else:raise RuntimeError('Unknown operation')
   self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(result).encode())
  except Exception as e:
   print('Control failure',self.path,str(e),flush=True)
   try:
    (root/'failure.png').write_bytes(adb('exec-out','screencap','-p'));(root/'failure.xml').write_bytes(adb('shell','cat','/sdcard/tutorial-ui.xml'))
   except Exception:pass
   self.send_response(500);self.end_headers();self.wfile.write(str(e).encode())
class Proxy(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):self.forward()
 def do_POST(self):self.forward()
 def do_OPTIONS(self):self.forward()
 def forward(self):
  if offline:self.send_response(503);self.end_headers();return
  body=self.rfile.read(int(self.headers.get('Content-Length',0)))
  req=urllib.request.Request('http://127.0.0.1:4198'+self.path,data=body if self.command=='POST' else None,headers={k:v for k,v in self.headers.items() if k.lower() not in ['host','content-length']},method=self.command)
  try:r=urllib.request.urlopen(req,timeout=20)
  except urllib.error.HTTPError as e:r=e
  data=r.read();self.send_response(r.status)
  for k,v in r.headers.items():
   if k.lower() not in ['content-length','connection','transfer-encoding']:self.send_header(k,v)
  self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
def gps():
 j=0
 while True:
  try:adb('emu','geo','fix',str(76.95+(j%80)*.00015),str(52.284-(j%80)*.00009))
  except:pass
  j+=1;time.sleep(4)
push_photo(fixture['nativeTrip']);threading.Thread(target=gps,daemon=True).start()
threading.Thread(target=http.server.ThreadingHTTPServer(('0.0.0.0',4199),Proxy).serve_forever,daemon=True).start()
http.server.ThreadingHTTPServer(('127.0.0.1',4200),Control).serve_forever()
