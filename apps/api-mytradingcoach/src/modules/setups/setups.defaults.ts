import { PrismaClient } from '@prisma/client';

export interface DefaultSetup {
  title: string;
  color: string;
  description: string;
  sortOrder: number;
}

// Setups par défaut (couleurs + descriptions d'origine, alignées sur l'ancien
// setup-color.pipe et la migration enum→table). Tout nouvel inscrit les reçoit.
export const DEFAULT_SETUPS: DefaultSetup[] = [
  { title: 'Breakout', color: '#10b981', description: "Cassure d'un niveau clé avec volume",   sortOrder: 0 },
  { title: 'Pullback', color: '#3b82f6', description: 'Repli sur support/EMA puis reprise',     sortOrder: 1 },
  { title: 'Range',    color: '#f59e0b', description: 'Trade entre support et résistance',      sortOrder: 2 },
  { title: 'Reversal', color: '#ef4444', description: 'Retournement sur extrême + divergence',  sortOrder: 3 },
  { title: 'Scalping', color: '#8b5cf6', description: 'Entrées rapides sur petits mouvements',  sortOrder: 4 },
  { title: 'News',     color: '#60a5fa', description: 'Trade sur publication économique',       sortOrder: 5 },
];

// Palette autorisée pour la couleur d'un setup (mockup proto-profil-onglets.html).
export const SETUP_PALETTE = [
  '#10b981', '#3b82f6', '#60a5fa', '#22d3ee',
  '#f59e0b', '#8b5cf6', '#a78bfa', '#ef4444',
];

/**
 * Idempotent : crée les 6 setups par défaut si le user n'en a aucun.
 * Réutilisé par le signup (SetupsService), la démo (demo-seed) — la migration
 * fait l'équivalent en SQL pour les users existants.
 */
export async function seedDefaultSetups(prisma: PrismaClient, userId: string): Promise<boolean> {
  const existing = await prisma.setup.count({ where: { userId } });
  if (existing > 0) return false;
  await prisma.setup.createMany({
    data: DEFAULT_SETUPS.map((d) => ({
      userId,
      title: d.title,
      color: d.color,
      description: d.description,
      sortOrder: d.sortOrder,
    })),
  });
  return true;
}
