#!/usr/bin/env python3
"""Add or replace only the isolated Collection virtual host in an existing proxy."""
import re,sys
from pathlib import Path
path=Path(sys.argv[1]);domain=sys.argv[2];phase=sys.argv[3]
if not re.fullmatch(r'[a-z0-9.-]+',domain):raise SystemExit('Invalid domain')
source=path.read_text();source=re.sub(r'\n\s*# BEGIN COLLECTION LIVE\n.*?# END COLLECTION LIVE\n','\n',source,flags=re.S)
block=f'''\n  # BEGIN COLLECTION LIVE
  server {{
    listen 80;
    server_name {domain};
    location ^~ /.well-known/acme-challenge/ {{ root /acme; }}
    location / {{ return 308 https://{domain}$request_uri; }}
  }}
'''
if phase=='tls':
 block+=f'''  server {{
    listen 443 ssl;
    server_name {domain};
    ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    location / {{
      proxy_pass http://collection-live-gateway:8080;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }}
  }}
'''
block+='  # END COLLECTION LIVE\n'
end=source.rfind('}')
if end<0:raise SystemExit('Expected an nginx http block')
# Preserve the inode of the file bind-mounted by Docker.
path.write_text(source[:end]+block+source[end:])
