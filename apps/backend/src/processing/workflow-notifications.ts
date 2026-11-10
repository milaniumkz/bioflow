import { Prisma } from "@prisma/client";

// Target the responsible accounts, never another organization or warehouse.
export async function workflowNotice(
  tx: Prisma.TransactionClient,
  event: {
    id: string;
    organizationId: string;
    warehouseIds: string[];
    driverUserId?: string | null;
    type: string;
    title: string;
    body: string;
  },
) {
  const users = await tx.user.findMany({
    where: {
      organizationId: event.organizationId,
      isBlocked: false,
      OR: [
        ...(event.driverUserId ? [{ id: event.driverUserId }] : []),
        { userRoles: { some: { role: { code: "OWNER" } } } },
        {
          AND: [
            { counterpartyScopeId: null },
            {
              userRoles: {
                some: {
                  role: {
                    permissions: {
                      some: {
                        permission: {
                          code: {
                            in: [
                              "processing.receive",
                              "processing.wash",
                              "processing.dry",
                              "processing.finished",
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            {
              OR: [
                { accessAllObjects: true },
                { warehouseScopeIds: { hasSome: event.warehouseIds } },
              ],
            },
          ],
        },
      ],
    },
    select: { id: true },
  });
  for (const user of users) {
    const notice = await tx.notification.upsert({
      where: { id: `${event.id}:${user.id}` },
      update: {},
      create: {
        id: `${event.id}:${user.id}`,
        organizationId: event.organizationId,
        userId: user.id,
        type: event.type,
        title: event.title,
        body: event.body,
      },
    });
    const devices = await tx.device.findMany({
      where: { userId: user.id, pushToken: { not: null } },
      select: { id: true },
    });
    for (const device of devices)
      await tx.pushDelivery.upsert({
        where: {
          notificationId_deviceId: {
            notificationId: notice.id,
            deviceId: device.id,
          },
        },
        update: {},
        create: { notificationId: notice.id, deviceId: device.id },
      });
  }
}
