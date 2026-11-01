-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('VIDEO', 'IMAGE');

-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('UPLOAD', 'AI_GENERATED', 'CLAUDE_CODE');

-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('VIDEO', 'PHOTO', 'CAROUSEL');

-- CreateEnum
CREATE TYPE "PostMode" AS ENUM ('DIRECT', 'DRAFT_INBOX');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'REVOKED');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'QUEUED', 'SENDING', 'PROCESSING', 'INBOX_DELIVERED', 'PUBLISHED', 'FAILED', 'UNKNOWN', 'CANCELED');

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TikTokAccount" (
    "id" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "scopes" TEXT[],
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "creatorInfo" JSONB,
    "creatorInfoAt" TIMESTAMP(3),
    "audited" BOOLEAN NOT NULL DEFAULT false,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TikTokAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "source" "MediaSource" NOT NULL DEFAULT 'UPLOAD',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "PostType" NOT NULL,
    "mode" "PostMode" NOT NULL DEFAULT 'DIRECT',
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[],
    "privacyLevel" TEXT NOT NULL DEFAULT 'SELF_ONLY',
    "disableComment" BOOLEAN NOT NULL DEFAULT false,
    "disableDuet" BOOLEAN NOT NULL DEFAULT false,
    "disableStitch" BOOLEAN NOT NULL DEFAULT false,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "brandContent" BOOLEAN NOT NULL DEFAULT false,
    "brandOrganic" BOOLEAN NOT NULL DEFAULT false,
    "coverIndex" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT NOT NULL,
    "approvedHash" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishId" TEXT,
    "tiktokPostId" TEXT,
    "failReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "initSentAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMedia" (
    "postId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PostMedia_pkey" PRIMARY KEY ("postId","position")
);

-- CreateTable
CREATE TABLE "PostEvent" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "PostEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokAccount_openId_key" ON "TikTokAccount"("openId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MediaAsset_sha256_idx" ON "MediaAsset"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Post_publishId_key" ON "Post"("publishId");

-- CreateIndex
CREATE INDEX "Post_status_scheduledAt_idx" ON "Post"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Post_accountId_createdAt_idx" ON "Post"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "PostEvent_postId_at_idx" ON "PostEvent"("postId", "at");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TikTokAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostEvent" ADD CONSTRAINT "PostEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
