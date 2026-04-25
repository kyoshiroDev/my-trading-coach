-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER', 'BETA_TESTER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER';
