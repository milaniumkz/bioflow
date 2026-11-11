// Read-only live verification. Never log credentials, balances or personal data.
const fs = require('node:fs');
const { createSign } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  if (process.env.COLLECTION_ENABLED !== 'true' || new URL(process.env.DATABASE_URL).pathname !== '/collection_live') throw Error('Refusing another database');
  const organizationId = process.env.COLLECTION_ORGANIZATION_ID || 'collection-live';
  const opening = JSON.parse(fs.readFileSync('/run/collection-secrets/opening-balances.json', 'utf8'));
  for (const row of opening.balances) {
    const kg = new Prisma.Decimal(row.tonnes).mul(1000);
    if (kg.isZero()) continue;
    const batch = await db.collectionBatch.findUnique({ where: { organizationId_sourceType_sourceId_state: { organizationId, sourceType: 'OPENING', sourceId: `opening:${opening.effectiveDate}:${row.warehouseCode}:${row.state}`, state: row.state } } });
    if (!batch || !batch.totalKg.equals(kg)) throw Error('Opening inventory verification failed');
  }
  const c = JSON.parse(fs.readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE, 'utf8'));
  if (c.project_id !== 'collection-d2013') throw Error('Unexpected Firebase project');
  const b = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const assertion = b({ alg: 'RS256', typ: 'JWT' }) + '.' + b({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const jwt = assertion + '.' + createSign('RSA-SHA256').update(assertion).sign(c.private_key, 'base64url');
  const oauth = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }), signal: AbortSignal.timeout(20000) });
  if (!oauth.ok) throw Error('Firebase OAuth HTTP ' + oauth.status);
  const token = (await oauth.json()).access_token;
  const validation = await fetch('https://fcm.googleapis.com/v1/projects/collection-d2013/messages:send', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ validate_only: true, message: { token: 'validation-only-not-a-real-device-token', notification: { title: 'Configuration validation', body: 'No message is sent' } } }), signal: AbortSignal.timeout(20000) });
  const result = await validation.json();
  if (validation.status !== 400 || result.error?.status !== 'INVALID_ARGUMENT') throw Error('Unexpected FCM validation response HTTP ' + validation.status);
  console.log(JSON.stringify({ isolatedDatabase: true, openingInventoryMatches: true, warehouseCount: await db.collectionLocation.count({ where: { organizationId, kind: 'WAREHOUSE' } }), userAccounts: await db.user.count({ where: { organizationId } }), firebaseAuthorized: true, fcmApiEnabled: true, validationOnly: true, messageSent: false }));
})().catch(error => { console.error('Collection verification failed:', error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
