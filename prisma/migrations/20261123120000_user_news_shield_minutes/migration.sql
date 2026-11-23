-- Bouclier annonces (#670) : minutes avant une annonce forte, réglables dans le Profil (additive, nullable).
ALTER TABLE "User" ADD COLUMN "newsShieldMinutes" INTEGER;
