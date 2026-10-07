#!/usr/bin/env python3
"""Encrypt the generated test login into a standalone offline HTML artifact."""
import base64
import json
import os
import sys
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

password = os.environ.get('SSHPASS')
if not password:
    raise SystemExit('A protected SSH password is required to encrypt the test-access artifact')
payload = Path(sys.argv[1]).read_bytes()
values = json.loads(payload)
if not all(values.get(key) for key in ('url', 'email', 'password')):
    raise SystemExit('Incomplete test login response')
salt, nonce = os.urandom(16), os.urandom(12)
key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=200000).derive(password.encode())
ciphertext = AESGCM(key).encrypt(nonce, payload, None)
box = json.dumps({key: base64.b64encode(value).decode() for key, value in
                  {'salt': salt, 'nonce': nonce, 'ciphertext': ciphertext}.items()})
html = '''<!doctype html><html lang="ru"><meta charset="utf-8"><title>BIOFLOW — тестовый доступ</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{background:#061225;color:#d8dee8;font:18px system-ui;max-width:700px;margin:60px auto;padding:24px}input,button{padding:12px;font:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>Тестовый доступ BIOFLOW</h1><p>Откройте этот скачанный файл локально. Введите пароль SSH сервера, который вы добавили в GitHub Secrets. Файл расшифровывается в браузере без отправки пароля в сеть.</p>
<form id="form"><input id="password" type="password" required autocomplete="off" placeholder="Пароль SSH"><button>Расшифровать</button></form><pre id="result"></pre>
<script>
const box = BOX;
const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
document.getElementById('form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = document.getElementById('result');
  try {
    const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(document.getElementById('password').value), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt:decode(box.salt), iterations:200000, hash:'SHA-256'}, raw, {name:'AES-GCM', length:256}, false, ['decrypt']);
    const data = await crypto.subtle.decrypt({name:'AES-GCM', iv:decode(box.nonce)}, key, decode(box.ciphertext));
    const access = JSON.parse(new TextDecoder().decode(data));
    result.textContent = 'Сайт: '+access.url+'\\nЛогин: '+access.email+'\\nВременный пароль: '+access.password+'\\n\\nПри первом входе приложение предложит сменить пароль.';
    document.getElementById('password').value = '';
  } catch (_) { result.textContent = 'Не удалось расшифровать. Проверьте пароль SSH и откройте файл локально в современном браузере.'; }
});
</script></html>'''.replace('BOX', box)
Path(sys.argv[2]).write_text(html)
Path(sys.argv[2]).chmod(0o600)
