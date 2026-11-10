-- CreateTable
CREATE TABLE "password_reset_grant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "password_reset_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_grant_tokenHash_key" ON "password_reset_grant"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_grant_userId_usedAt_idx" ON "password_reset_grant"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "password_reset_grant_expiresAt_idx" ON "password_reset_grant"("expiresAt");

-- AddForeignKey
ALTER TABLE "password_reset_grant" ADD CONSTRAINT "password_reset_grant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_grant" ADD CONSTRAINT "password_reset_grant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
