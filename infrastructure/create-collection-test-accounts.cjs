// Explicitly requested test accounts only; encrypted stdin, no credential logging.
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const backendRequire = createRequire('/app/apps/backend/package.json');
const { PrismaClient } = backendRequire('@prisma/client');
const argon2 = backendRequire('argon2');
const db = new PrismaClient();
const roles = {
  OWNER: { id: 'collection-test-owner', name: 'Тестовый владелец' },
  COLLECTOR: { id: 'collection-test-collector', name: 'Тестовый сборщик' },
  WAREHOUSE_MANAGER: { id: 'collection-test-warehouse', name: 'Тестовый ответственный склада' },
  FACTORY_MANAGER: { id: 'collection-test-factory', name: 'Тестовый ответственный завода' },
};
(async () => {
  if (process.env.COLLECTION_ENABLED !== 'true' || new URL(process.env.DATABASE_URL).pathname !== '/collection_live' || process.env.COLLECTION_ORGANIZATION_ID !== 'collection-live') throw Error('Refusing another database');
  const raw = fs.readFileSync(0, 'utf8');
  if (Buffer.byteLength(raw) > 8192) throw Error('Invalid account input');
  const { accounts } = JSON.parse(raw);
  if (!Array.isArray(accounts) || accounts.length !== 4 || new Set(accounts.map(a => a.role)).size !== 4 || new Set(accounts.map(a => a.phone)).size !== 4 || accounts.some(a => !Object.hasOwn(roles, a.role) || !/^\+[1-9][0-9]{6,14}$/.test(a.phone || '') || a.password !== '123456' || a.mustChangePassword !== false)) throw Error('Unexpected test-account request');
  const prepared = await Promise.all(accounts.map(async a => ({ ...a, passwordHash: await argon2.hash(a.password, { type: argon2.argon2id }) })));
  const provisioned = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('collection-test-account-provision'))`;
    await tx.organization.findUniqueOrThrow({ where: { id: 'collection-live' } });
    const warehouse = await tx.collectionLocation.findUniqueOrThrow({ where: { organizationId_code: { organizationId: 'collection-live', code: 'HELIOS' } } });
    if (warehouse.kind !== 'WAREHOUSE' || !warehouse.active) throw Error('Test warehouse unavailable');
    // Check every identity before creating anything; never overwrite other users.
    for (const account of prepared) {
      const existing = await tx.user.findUnique({ where: { id: roles[account.role].id } });
      const phoneOwner = await tx.user.findUnique({ where: { phone: account.phone } });
      if ((existing && existing.organizationId !== 'collection-live') || (phoneOwner && phoneOwner.id !== roles[account.role].id)) throw Error('Test-account identity conflict');
      await tx.role.findUniqueOrThrow({ where: { code: account.role } });
    }
    let factory = await tx.collectionLocation.findFirst({ where: { organizationId: 'collection-live', kind: 'FACTORY', active: true }, orderBy: { code: 'asc' } });
    let factoryCreated = false;
    if (!factory) {
      factory = await tx.collectionLocation.create({ data: { organizationId: 'collection-live', code: 'TEST_FACTORY', name: 'Тестовый завод', kind: 'FACTORY' } });
      factoryCreated = true;
    }
    const result = [];
    for (const account of prepared) {
      const config = roles[account.role];
      const existing = await tx.user.findUnique({ where: { id: config.id }, include: { userRoles: { include: { role: true } } } });
      if (existing?.userRoles.some(r => r.role.code !== account.role)) throw Error('Existing test identity has another role');
      const role = await tx.role.findUniqueOrThrow({ where: { code: account.role } });
      const data = { phone: account.phone, passwordHash: account.passwordHash, mustChangePassword: false, isBlocked: false, accessAllObjects: account.role === 'OWNER' };
      await tx.user.upsert({ where: { id: config.id }, create: { id: config.id, organizationId: 'collection-live', fullName: config.name, ...data }, update: data });
      await tx.userRole.upsert({ where: { userId_roleId: { userId: config.id, roleId: role.id } }, create: { userId: config.id, roleId: role.id }, update: {} });
      const locationId = account.role === 'WAREHOUSE_MANAGER' ? warehouse.id : account.role === 'FACTORY_MANAGER' ? factory.id : null;
      if (locationId) await tx.collectionMembership.upsert({ where: { userId_locationId: { userId: config.id, locationId } }, create: { userId: config.id, locationId }, update: {} });
      await tx.auditLog.create({ data: { organizationId: 'collection-live', userId: config.id, action: 'collection.test-account.provision', entity: 'User', entityId: config.id } });
      result.push({ role: account.role, created: !existing, locationId });
    }
    return { accounts: result, factoryCreated };
  });
  for (const account of accounts) {
    const login = await fetch('http://127.0.0.1:4000/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: account.phone, password: account.password, platform: 'web' }), signal: AbortSignal.timeout(15000) });
    if (!login.ok) throw Error('Test login failed HTTP ' + login.status);
    const tokens = await login.json();
    const headers = { Authorization: 'Bearer ' + tokens.accessToken };
    const profile = await fetch('http://127.0.0.1:4000/api/v1/auth/me', { headers, signal: AbortSignal.timeout(15000) });
    const me = await profile.json();
    if (!profile.ok || me.id !== roles[account.role].id || me.roles?.length !== 1 || !me.roles.includes(account.role) || me.mustChangePassword !== false) throw Error('Test profile verification failed');
    const response = await fetch('http://127.0.0.1:4000/api/v1/collection/state', { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('Test workspace access failed');
    const state = await response.json();
    const target = provisioned.accounts.find(a => a.role === account.role).locationId;
    if (target && (state.assignedLocationIds.length !== 1 || state.assignedLocationIds[0] !== target)) throw Error('Test location scope verification failed');
    if (account.role === 'OWNER' && !['HELIOS','ZHANA_AUL','EKIBASTUZ','TEC3'].every(code => state.locations.some(l => l.code === code))) throw Error('Owner warehouse visibility failed');
    if (tokens.refreshToken) await db.refreshToken.updateMany({ where: { userId: me.id, tokenHash: createHash('sha256').update(tokens.refreshToken).digest('hex') }, data: { revokedAt: new Date() } });
  }
  console.log(JSON.stringify({ database: 'collection_live', accounts: provisioned.accounts.map(({ role, created }) => ({ role, created, mustChangePassword: false, loginVerified: true, workspaceVerified: true })), factoryCreated: provisioned.factoryCreated, warehouseAssignment: 'HELIOS', materialInventoryChanged: false }));
})().catch(() => { console.error('Test account operation failed; credentials and personal information omitted'); process.exitCode = 1; }).finally(() => db.$disconnect());
