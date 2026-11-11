-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('new', 'good', 'worn', 'needs_care');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('hidden', 'listed', 'retired');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('requested', 'approved', 'out', 'returned', 'declined', 'cancelled', 'expired', 'lapsed');

-- CreateEnum
CREATE TYPE "ReturnedAsLent" AS ENUM ('yes', 'no', 'unknown');

-- CreateEnum
CREATE TYPE "LoanActor" AS ENUM ('owner', 'borrower', 'organizer', 'system');

-- CreateEnum
CREATE TYPE "LoanSystemReason" AS ENUM ('dates_taken', 'item_hidden', 'item_retired', 'owner_suspended', 'borrower_suspended', 'account_deleted');

-- CreateTable
CREATE TABLE "item" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "condition" "ItemCondition" NOT NULL,
    "maxLoanDays" INTEGER NOT NULL DEFAULT 7,
    "pickupNotes" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'hidden',
    "listedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "retiredNote" TEXT,
    "retiredById" TEXT,
    "photoKey" TEXT,
    "photoUrl" TEXT,
    "photoWidth" INTEGER,
    "photoHeight" INTEGER,
    "photoBytes" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "borrowerId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'requested',
    "requestMessage" TEXT,
    "statusReason" TEXT,
    "endedBy" "LoanActor",
    "systemReason" "LoanSystemReason",
    "returnedOn" DATE,
    "returnedAsLent" "ReturnedAsLent",
    "closedById" TEXT,
    "ownerSeenAt" TIMESTAMPTZ(3),
    "borrowerSeenAt" TIMESTAMPTZ(3),
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_status_listedAt_idx" ON "item"("status", "listedAt" DESC);

-- CreateIndex
CREATE INDEX "item_ownerId_idx" ON "item"("ownerId");

-- CreateIndex
CREATE INDEX "item_categoryId_idx" ON "item"("categoryId");

-- CreateIndex
CREATE INDEX "loan_itemId_status_idx" ON "loan"("itemId", "status");

-- CreateIndex
CREATE INDEX "loan_borrowerId_status_idx" ON "loan"("borrowerId", "status");

-- CreateIndex
CREATE INDEX "loan_itemId_startDate_idx" ON "loan"("itemId", "startDate");

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_retiredById_fkey" FOREIGN KEY ("retiredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written (spec 09): Prisma can't express CHECK constraints.
ALTER TABLE "item" ADD CONSTRAINT "item_maxLoanDays_check" CHECK ("maxLoanDays" BETWEEN 1 AND 30);

ALTER TABLE "loan" ADD CONSTRAINT "loan_dates_check" CHECK ("endDate" >= "startDate");
