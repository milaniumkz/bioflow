#!/usr/bin/env bash
set -euo pipefail
umask 077
if ! command -v age >/dev/null; then export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y age; fi
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
age --decrypt --identity /etc/ssh/ssh_host_ed25519_key > "$archive"
python3 - "$archive" <<'PY'
from pathlib import Path
import json,os,plistlib,sys,tarfile,tempfile
allowed={'firebase-service-account.json','google-services.json','GoogleService-Collection.plist','GoogleService-Driver.plist','opening-balances.json','collection-release.jks','mobile-signing.json'}
with tarfile.open(sys.argv[1]) as tar:
 members=tar.getmembers()
 if {m.name for m in members}!=allowed or any(not m.isfile() for m in members):raise SystemExit('Unexpected configuration archive members')
 files={m.name:tar.extractfile(m).read() for m in members}
server=json.loads(files['firebase-service-account.json'])
if server.get('project_id')!='collection-d2013' or not server.get('private_key','').startswith('-----BEGIN PRIVATE KEY-----'):raise SystemExit('Invalid Firebase server configuration')
android=json.loads(files['google-services.json'])
if android.get('project_info',{}).get('project_id')!='collection-d2013':raise SystemExit('Invalid Firebase mobile configuration')
for name,bundle in [('GoogleService-Collection.plist','kz.milanium.collection'),('GoogleService-Driver.plist','kz.milanium.collection.driver')]:
 data=plistlib.loads(files[name])
 if data.get('BUNDLE_ID')!=bundle or data.get('PROJECT_ID')!='collection-d2013':raise SystemExit('Unexpected iOS Firebase registration')
root=Path('/opt/collection-live/shared/secrets');root.mkdir(parents=True,exist_ok=True);root.chmod(0o700)
for name,contents in files.items():
 descriptor,temporary=tempfile.mkstemp(dir=root)
 with os.fdopen(descriptor,'wb') as f:f.write(contents)
 os.chmod(temporary,0o600);os.replace(temporary,root/name)
print('Firebase configuration installed privately for collection-d2013; no key material printed')
PY
