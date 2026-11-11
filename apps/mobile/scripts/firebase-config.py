#!/usr/bin/env python3
"""Build public Firebase client options; never reads a Firebase admin private key."""
import argparse, json, plistlib
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--platform',choices=['android','ios'],required=True)
parser.add_argument('--role',choices=['driver','collection'],required=True)
parser.add_argument('--firebase-file',required=True)
parser.add_argument('--api-url',required=True)
parser.add_argument('--web-url',required=True)
parser.add_argument('--output',required=True)
a=parser.parse_args()
package=('kz.milanium.collection.driver' if a.platform=='ios' else 'kz.milanium.collection_driver') if a.role=='driver' else 'kz.milanium.collection'
if a.platform=='android':
 data=json.loads(Path(a.firebase_file).read_text())
 if 'private_key' in data: raise SystemExit('Refusing server private-key file as mobile configuration')
 client=next((client for client in data.get('client',[]) if client.get('client_info',{}).get('android_client_info',{}).get('package_name')==package),None)
 if client is None: raise SystemExit('Firebase registration for '+package+' not found')
 options={'FIREBASE_API_KEY':client['api_key'][0]['current_key'],'FIREBASE_APP_ID':client['client_info']['mobilesdk_app_id'],'FIREBASE_MESSAGING_SENDER_ID':data['project_info']['project_number'],'FIREBASE_PROJECT_ID':data['project_info']['project_id']}
else:
 data=plistlib.loads(Path(a.firebase_file).read_bytes())
 if data.get('BUNDLE_ID')!=package:raise SystemExit('Firebase bundle ID does not match '+package)
 options={'FIREBASE_API_KEY':data['API_KEY'],'FIREBASE_APP_ID':data['GOOGLE_APP_ID'],'FIREBASE_MESSAGING_SENDER_ID':data['GCM_SENDER_ID'],'FIREBASE_PROJECT_ID':data['PROJECT_ID']}
options.update({'API_URL':a.api_url,'WEB_URL':a.web_url,'DRIVER_API_PREFIX':'/collection-driver'})
output=Path(a.output);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(options));output.chmod(0o600)
print('Prepared '+a.platform+' Firebase client configuration for '+package+' (values hidden)')
