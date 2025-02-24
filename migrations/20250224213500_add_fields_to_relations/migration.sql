/*
  Warnings:

  - Added the required column `fromFieldId` to the `Relation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `toFieldId` to the `Relation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Relation" ADD COLUMN     "fromFieldId" INTEGER NOT NULL,
ADD COLUMN     "toFieldId" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_fromFieldId_fkey" FOREIGN KEY ("fromFieldId") REFERENCES "Field"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_toFieldId_fkey" FOREIGN KEY ("toFieldId") REFERENCES "Field"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
