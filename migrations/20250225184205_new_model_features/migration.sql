-- AlterTable
ALTER TABLE "Field" ADD COLUMN     "enumValues" JSONB,
ADD COLUMN     "isIndex" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isUnique" BOOLEAN NOT NULL DEFAULT false;
