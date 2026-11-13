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
  if (typeof review !== 'boolean' ||
      email !== (review ? 'google-play-review@collection.invalid' : 'milaniumkz@yandex.kz') ||
      !/^[a-f0-9]{48}$/.test(password)) {
    throw new Error('Unexpected owner input');
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const organizationId = review ? 'collection-google-play-review' : liveOrganizationId;
  await db.$transaction(async (tx) => {
    if (review) {
      await tx.organization.create({ data: { id: organizationId, name: 'Collection Google Play Review' } });
      await tx.collectionLocation.create({
        data: { organizationId, code: 'REVIEW-WAREHOUSE', name: 'Review warehouse', kind: 'WAREHOUSE' },
      });
    }
    const role = await tx.role.findUniqueOrThrow({ where: { code: 'OWNER' } });
    const user = await tx.user.create({
      data: {
        organizationId, email, passwordHash,
        fullName: review ? 'Google Play Reviewer' : 'Dmitriy Shtrakhov',
        mustChangePassword: !review,
        accessAllObjects: true,
        userRoles: { create: { roleId: role.id } },
      },
    });
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
    const state = await fetch(base + '/collection/state', {
      headers: { Authorization: 'Bearer ' + accessToken },
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
