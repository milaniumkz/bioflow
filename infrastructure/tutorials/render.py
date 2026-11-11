"""Render a recorded lesson with the supplied neural narration and readable captions."""
import json,subprocess,sys,textwrap
from pathlib import Path
meta=json.loads(Path(sys.argv[1]).read_text())
root=Path('work/tutorial-final');root.mkdir(exist_ok=True)
parts=Path('work/tutorial-render')/meta['id'];parts.mkdir(parents=True,exist_ok=True)
def run(args):
 result=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if result.returncode:
  print(result.stderr.decode(errors='replace')[-5000:]);raise RuntimeError('Media rendering failed')
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
intro=1.2
run(['ffmpeg','-y','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t',str(intro),str(parts/'intro.wav')])
wavefiles=[parts/'intro.wav'];subs=[];events=[];time=intro
for i,segment in enumerate(meta['segments']):
 wav=parts/f'{i:02}.wav';duration=segment['seconds']
 run(['ffmpeg','-y','-i',segment['audio'],'-af',f'apad=whole_dur={duration},atrim=duration={duration}','-ar','48000','-ac','1',str(wav)])
 wavefiles.append(wav)
 text='\n'.join(textwrap.wrap(segment['text'],46))
 subs.append(f'{i+1}\n{stamp(time)} --> {stamp(time+duration-.15)}\n{text}\n')
 events.append((time,time+duration-.15,text));time+=duration
concat=parts/'audio.txt';concat.write_text('\n'.join("file '"+str(p.resolve())+"'" for p in wavefiles)+'\n')
srt=root/(meta['id']+'.srt');srt.write_text('\n'.join(subs))
title=parts/'title.txt';title.write_text(meta['title'])
role=parts/'role.txt';role.write_text({'owner':'ВЛАДЕЛЕЦ','collector':'СБОРЩИК','warehouse':'СКЛАД','factory':'ЗАВОД','driver':'ВОДИТЕЛЬ'}[meta['role']]+' · УЧЕБНЫЙ ПРИМЕР')
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
ass=parts/'captions.ass'
header='[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1760\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,24,&H00253920,&H00253920,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,0,0,1,1,0,2,24,24,28,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
def at(t):
 cs=round(t*100);return f'{cs//360000:01}:{cs//6000%60:02}:{cs//100%60:02}.{cs%100:02}'
ass.write_text(header+''.join('Dialogue: 0,'+at(start)+','+at(end)+',Default,,0,0,0,,'+text.replace('\n','\\N')+'\n' for start,end,text in events))
crop="crop=430:900:0:0," if meta["role"]!="driver" else ""
filters=f"{crop}scale=720:1430:force_original_aspect_ratio=decrease,pad=720:1760:(ow-iw)/2:86:white,setsar=1,tpad=stop_mode=clone:stop_duration=10,drawtext=fontfile={font}:textfile={role}:fontsize=16:fontcolor=0x386957:x=24:y=12,drawtext=fontfile={font}:textfile={title}:fontsize=23:fontcolor=0x123d2d:x=24:y=40,subtitles={ass}"

output=root/(meta['id']+'.mp4')
run(['ffmpeg','-y','-ss',str(meta.get('startOffset',0)),'-i',meta['video'],'-f','concat','-safe','0','-i',str(concat),'-vf',filters,'-map','0:v:0','-map','1:a:0','-t',str(time),'-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-r','24','-c:a','aac','-b:a','96k','-movflags','+faststart',str(output)])
run(['ffmpeg','-y','-ss','1.4','-i',str(output),'-frames:v','1','-q:v','3',str(root/(meta['id']+'.jpg'))])
print('Rendered',meta['id'],round(time,1),'seconds',output.stat().st_size,'bytes',flush=True)
