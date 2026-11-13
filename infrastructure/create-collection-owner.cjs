const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const backendRequire = createRequire('/app/apps/backend/package.json');
const { PrismaClient } = backendRequire('@prisma/client');
const argon2 = backendRequire('argon2');
const db = new PrismaClient();

async function provision() {
  const liveOrganizationId = 'collection-live';
  if (process.env.COLLECTION_ENABLED !== 'true' ||
      new URL(process.env.DATABASE_URL).pathname !== '/collection_live' ||
      process.env.COLLECTION_ORGANIZATION_ID !== liveOrganizationId) {
    throw new Error('Wrong Collection environment');
  }
  const { email, password, review = false } = JSON.parse(readFileSync(0, 'utf8'));
  const apple = review === 'apple';
  if ((typeof review !== 'boolean' && !apple) ||
      email !== (apple ? 'apple-app-review@collection.invalid' : review ? 'google-play-review@collection.invalid' : 'milaniumkz@yandex.kz') ||
      !/^[a-f0-9]{48}$/.test(password)) {
    throw new Error('Unexpected owner input');
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const organizationId = apple ? 'collection-apple-app-review' : review ? 'collection-google-play-review' : liveOrganizationId;
  const roleCode = apple ? 'WAREHOUSE_MANAGER' : 'OWNER';
  await db.$transaction(async (tx) => {
    let warehouse;
    if (review) {
      await tx.organization.create({ data: { id: organizationId, name: apple ? 'Collection Apple App Review' : 'Collection Google Play Review' } });
      warehouse = await tx.collectionLocation.create({
        data: { organizationId, code: 'REVIEW-WAREHOUSE', name: 'Review warehouse', kind: 'WAREHOUSE' },
      });
    }
    const role = await tx.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await tx.user.create({
      data: {
        organizationId, email, passwordHash,
        fullName: apple ? 'Apple App Reviewer' : review ? 'Google Play Reviewer' : 'Dmitriy Shtrakhov',
        mustChangePassword: !review,
        accessAllObjects: !apple,
        userRoles: { create: { roleId: role.id } },
      },
    });
    if (apple) await tx.collectionMembership.create({ data: { userId: user.id, locationId: warehouse.id } });
    await tx.auditLog.create({
      data: {
        organizationId, userId: user.id, entity: 'User',
        entityId: user.id, action: review ? 'collection.review.provision' : 'collection.owner.provision',
      },
    });
  });
  if (review) {
    const base = 'http://127.0.0.1:4000/api/v1';
    const login = await fetch(base + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, platform: 'web' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!login.ok) throw new Error('Review login failed');
    const { accessToken } = await login.json();
    const headers = { Authorization: 'Bearer ' + accessToken };
    if (apple) {
      const profile = await fetch(base + '/auth/me', { headers, signal: AbortSignal.timeout(15000) });
      const me = await profile.json();
      if (!profile.ok || me.roles?.length !== 1 || me.roles[0] !== roleCode) throw new Error('Review role verification failed');
    }
    const state = await fetch(base + '/collection/state', {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!state.ok) throw new Error('Review workspace unavailable');
    const { locations } = await state.json();
    if (locations.length !== 1 || locations[0].organizationId !== organizationId ||
        locations[0].code !== 'REVIEW-WAREHOUSE') throw new Error('Review scope verification failed');
    console.log('Review login and isolated warehouse verified.');
  } else {
    console.log('Collection owner created; password change required.');
  }
}

provision().catch(() => {
  console.error('Provisioning or verification failed; existing accounts were not overwritten.');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
