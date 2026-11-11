-- CreateTable
CREATE TABLE "CollectionNoticeLink" (
    "notificationId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "locationId" TEXT,

    CONSTRAINT "CollectionNoticeLink_pkey" PRIMARY KEY ("notificationId")
);
