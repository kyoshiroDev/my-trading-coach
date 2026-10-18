-- Connexion Google (#618). Additive et compatible N-1 : colonnes nullables ou avec DEFAULT,
-- mot de passe rendu nullable (l'ancien code ne lit jamais un compte Google pendant la bascule
-- avant que le nouveau n'en crée).

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "googleId" TEXT,
ADD COLUMN "authProvider" "AuthProvider" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "signupFinalizedAt" TIMESTAMP(3),
ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
