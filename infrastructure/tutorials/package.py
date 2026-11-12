import json,zipfile
from pathlib import Path
catalog=json.loads(Path('apps/web/app/collection/tutorial-catalog.json').read_text())
root=Path('work/tutorial-final');roles={'owner':'Владелец','collector':'Сборщик','warehouse':'Склад','factory':'Завод','driver':'Водитель'}
for item in catalog:
 for ext in ['.mp4','.srt','.jpg']:assert (root/(item['id']+ext)).is_file(),'Not ready: '+item['id']+ext
with zipfile.ZipFile(root/'collection-tutorials.zip','w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as z:
 text=f'Collection — видеоинструкции\n\n{len(catalog)} отдельных видео с женской озвучкой, субтитрами и подсветкой нажатий. Показаны учебные данные.\n\nВнутри приложения каждая роль видит только свои инструкции. Этот архив содержит все роли для отдельного скачивания.\n\n'
 for role,title in roles.items():
  text+=title+'\n'
  for i,item in enumerate([v for v in catalog if v['role']==role],1):
   text+=f"{i}. {item['title']}\n"
   for ext in ['.mp4','.srt']:
    z.write(root/(item['id']+ext),f"{title}/"+('Субтитры/' if ext=='.srt' else '')+f"{i:02}. {item['title']}{ext}")
  text+='\n'
 z.writestr('Прочитайте.txt',text)
with zipfile.ZipFile(root/'collection-tutorials.zip') as z:assert z.testzip() is None;assert len(z.namelist())==len(catalog)*2+1
print('Packaged',len(catalog),'MP4 and SRT; bytes', (root/'collection-tutorials.zip').stat().st_size)
