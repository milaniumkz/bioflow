const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const backendRequire = createRequire('/app/apps/backend/package.json');
const { PrismaClient } = backendRequire('@prisma/client');
const argon2 = backendRequire('argon2');
const db = new PrismaClient();

async function provision() {
  const organizationId = 'collection-live';
  if (process.env.COLLECTION_ENABLED !== 'true' ||
      new URL(process.env.DATABASE_URL).pathname !== '/collection_live' ||
      process.env.COLLECTION_ORGANIZATION_ID !== organizationId) {
    throw new Error('Wrong Collection environment');
  }
  const { email, password } = JSON.parse(readFileSync(0, 'utf8'));
  if (email !== 'milaniumkz@yandex.kz' || !/^[a-f0-9]{48}$/.test(password)) {
    throw new Error('Unexpected owner input');
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await db.$transaction(async (tx) => {
    const role = await tx.role.findUniqueOrThrow({ where: { code: 'OWNER' } });
    const user = await tx.user.create({
      data: {
        organizationId, email, passwordHash,
        fullName: 'Dmitriy Shtrakhov',
        mustChangePassword: true,
        accessAllObjects: true,
        userRoles: { create: { roleId: role.id } },
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId, userId: user.id, entity: 'User',
        entityId: user.id, action: 'collection.owner.provision',
      },
    });
  });
  console.log('Collection owner created; password change required.');
}

provision().catch(() => {
  console.error('Owner provisioning failed; existing accounts were not changed.');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
