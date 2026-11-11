import { BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
/** Caller must authorize the session first. Pages contain only public GPS fields. */
export async function readDriverRoute(
  db: PrismaClient,
  sessionId: string,
  cursor?: string,
) {
  if (cursor && !/^[A-Za-z0-9_-]{1,64}$/.test(cursor))
    throw new BadRequestException("Некорректная страница маршрута");
  if (
    cursor &&
    !(await db.collectionDriverPoint.findFirst({
      where: { id: cursor, sessionId },
      select: { id: true },
    }))
  )
    throw new BadRequestException("Страница маршрута не найдена");
  const rows = await db.collectionDriverPoint.findMany({
    where: { sessionId },
    orderBy: [{ recordedAt: "asc" }, { sequence: "asc" }],
    take: 2001,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      sequence: true,
      latitude: true,
      longitude: true,
      accuracy: true,
      recordedAt: true,
      receivedAt: true,
    },
  });
  const more = rows.length > 2000;
  const points = more ? rows.slice(0, 2000) : rows;
  return {
    points,
    nextCursor: more ? points[points.length - 1].id : null,
    total: await db.collectionDriverPoint.count({ where: { sessionId } }),
  };
}
