-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "allowDuplicate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mediaSig" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Post_accountId_mediaSig_idx" ON "Post"("accountId", "mediaSig");
