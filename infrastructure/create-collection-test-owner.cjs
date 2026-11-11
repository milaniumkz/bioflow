// Explicitly requested test account only. Payload arrives over encrypted stdin.
// Never print the phone, password, password hash, JWTs or Firebase credentials.
const fs = require('node:fs');
const { createRequire } = require('node:module');
const backendRequire = createRequire('/app/apps/backend/package.json');
const { PrismaClient } = backendRequire('@prisma/client');
const argon2 = backendRequire('argon2');
const db = new PrismaClient();
(async () => {
  if (process.env.COLLECTION_ENABLED !== 'true' || new URL(process.env.DATABASE_URL).pathname !== '/collection_live' || process.env.COLLECTION_ORGANIZATION_ID !== 'collection-live') throw Error('Refusing another database or organization');
  const raw = fs.readFileSync(0, 'utf8');
  if (Buffer.byteLength(raw) > 4096) throw Error('Invalid account input');
  const account = JSON.parse(raw);
  if (!/^\+[1-9][0-9]{6,14}$/.test(account.phone || '') || account.role !== 'OWNER' || account.password !== '123456' || account.mustChangePassword !== false) throw Error('Unexpected test-account request');
  const id = 'collection-test-owner';
  const passwordHash = await argon2.hash(account.password, { type: argon2.argon2id });
  const created = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('collection-test-owner-provision'))`;
    await tx.organization.findUniqueOrThrow({ where: { id: 'collection-live' } });
    const role = await tx.role.findUniqueOrThrow({ where: { code: 'OWNER' } });
    const phoneOwner = await tx.user.findUnique({ where: { phone: account.phone } });
    const existing = await tx.user.findUnique({ where: { id } });
    if ((phoneOwner && phoneOwner.id !== id) || (existing && existing.organizationId !== 'collection-live')) throw Error('Account conflicts with an existing user; nothing changed');
    await tx.user.upsert({ where: { id }, create: { id, organizationId: 'collection-live', fullName: 'Тестовый владелец', phone: account.phone, passwordHash, mustChangePassword: false, accessAllObjects: true }, update: { phone: account.phone, passwordHash, mustChangePassword: false, isBlocked: false, accessAllObjects: true } });
    await tx.userRole.upsert({ where: { userId_roleId: { userId: id, roleId: role.id } }, create: { userId: id, roleId: role.id }, update: {} });
    await tx.auditLog.create({ data: { organizationId: 'collection-live', userId: id, action: 'collection.test-owner.provision', entity: 'User', entityId: id } });
    return !existing;
  });
  const login = await fetch('http://127.0.0.1:4000/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: account.phone, password: account.password, platform: 'web' }), signal: AbortSignal.timeout(15000) });
  if (!login.ok) throw Error('Test login failed HTTP ' + login.status);
  const tokens = await login.json();
  const headers = { Authorization: 'Bearer ' + tokens.accessToken };
  const profile = await fetch('http://127.0.0.1:4000/api/v1/auth/me', { headers, signal: AbortSignal.timeout(15000) });
  const me = await profile.json();
  if (!profile.ok || me.id !== id || !me.roles?.includes('OWNER') || me.mustChangePassword !== false) throw Error('Owner profile verification failed');
  const state = await fetch('http://127.0.0.1:4000/api/v1/collection/state', { headers, signal: AbortSignal.timeout(15000) });
  if (!state.ok) throw Error('Collection owner access verification failed');
  // Retire only the temporary verification refresh token; retain any user sessions.
  const { createHash } = require('node:crypto');
  if (tokens.refreshToken) await db.refreshToken.updateMany({ where: { userId: id, tokenHash: createHash('sha256').update(tokens.refreshToken).digest('hex') }, data: { revokedAt: new Date() } });
  console.log(JSON.stringify({ database: 'collection_live', created, role: 'OWNER', mustChangePassword: false, loginVerified: true, ownerWorkspaceVerified: true }));
})().catch(() => { console.error('Test account operation failed; personal information and credentials omitted'); process.exitCode = 1; }).finally(() => db.$disconnect());
