"""Generate Russian female narration from the public tutorial catalog."""
import asyncio,json,os,subprocess
from pathlib import Path
import edge_tts
from edge_tts import communicate
if os.environ.get('CODEX_PROXY_CERT'):
 communicate._SSL_CTX.load_verify_locations(cafile=os.environ['CODEX_PROXY_CERT'])
root=Path('work/tutorial-voices');root.mkdir(exist_ok=True)
catalog=json.loads(Path('apps/web/app/collection/tutorial-catalog.json').read_text())
semaphore=asyncio.Semaphore(2)
async def one(item,index,text):
 path=root/(item['id']+f'--{index:02d}.mp3')
 async with semaphore:
  if not path.exists() or path.stat().st_size<1000:
   for attempt in range(4):
    try:
     c=edge_tts.Communicate(text,voice='ru-RU-SvetlanaNeural',rate='-7%',proxy=os.environ.get('HTTPS_PROXY'))
     await c.save(str(path),str(path.with_suffix('.srt')));break
    except Exception:
     if attempt==3:raise
     await asyncio.sleep(2+attempt*2)
  duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)],text=True))
  return {'file':str(path),'seconds':duration,'text':text}
async def main():
 result={}
 for item in catalog:
  result[item['id']]=await asyncio.gather(*(one(item,i,t) for i,t in enumerate(item['steps'])))
  Path('work/tutorial-voice-timings.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
  print('Voice ready:',item['id'],flush=True)
asyncio.run(main())
