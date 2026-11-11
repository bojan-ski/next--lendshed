-- CreateTable
CREATE TABLE "upload_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_blob_deletion" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_blob_deletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upload_log_createdAt_idx" ON "upload_log"("createdAt");

-- CreateIndex
CREATE INDEX "upload_log_userId_createdAt_idx" ON "upload_log"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pending_blob_deletion_storageKey_key" ON "pending_blob_deletion"("storageKey");

-- AddForeignKey
ALTER TABLE "upload_log" ADD CONSTRAINT "upload_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
