import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DemoSeedService } from './demo-seed.service';
import { DEMO_EMAIL } from './demo-seed';

/**
 * Garantit l'invariant vitrine : **le compte démo n'est jamais vide et ses trades
 * restent récents**.
 *
 * Le seed ne s'appelait que manuellement (POST /api/admin/seed-demo). Ses dates étant
 * RELATIVES au moment du run, la démo prod a vieilli en silence : seedée le 2026-06-07,
 * elle affichait encore le 2026-08-28 « P&L jour +0$ · Win Rate 0% · 0 trade loggé »
 * et une session active depuis 1978 h. Un prospect voyait un produit vide.
 *
 * Deux filets :
 *  - un re-seed quotidien (dates recalculées, donc toujours J-0/J-1 peuplés) ;
 *  - un contrôle au boot du worker cron, qui rattrape une API restée éteinte plus
 *    d'une journée sans attendre le prochain passage du cron.
 *
 * Le seed est idempotent (purge scopée au user démo puis recréation) : un re-run
 * REMPLACE, il n'empile pas. Cf. demo-seed-idempotence.spec.ts.
 */
@Injectable()
export class DemoSeedCron implements OnModuleInit {
  private readonly logger = new Logger(DemoSeedCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly demoSeed: DemoSeedService,
  ) {}

  /** 03h20 Paris : re-seed complet, hors des heures de visite. */
  @Cron('20 3 * * *', { timeZone: 'Europe/Paris' })
  async scheduledReseed(): Promise<void> {
    await this.reseed('cron quotidien');
  }

  /**
   * Boot du worker cron uniquement (même garde que ScheduleModule, cf. app.module) :
   * sur les 8 workers du cluster, un seul re-seede — sinon 8 purges/recréations
   * concurrentes sur le même user.
   */
  async onModuleInit(): Promise<void> {
    if (process.env['IS_CRON_WORKER'] !== 'true') return;
    try {
      if (await this.isStale()) await this.reseed('boot (démo vide ou périmée)');
    } catch (e) {
      // Un échec de seed ne doit jamais empêcher l'API de démarrer.
      this.logger.warn(`Contrôle démo au boot ignoré: ${(e as Error).message}`);
    }
  }

  /** Démo absente, sans trade, ou dont le dernier trade ne date pas d'aujourd'hui. */
  private async isStale(): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { email: DEMO_EMAIL },
      select: { id: true },
    });
    if (!user) return true;

    const last = await this.prisma.trade.findFirst({
      where: { userId: user.id },
      orderBy: { tradedAt: 'desc' },
      select: { tradedAt: true },
    });
    if (!last) return true;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return last.tradedAt < startOfToday;
  }

  private async reseed(reason: string): Promise<void> {
    const res = await this.demoSeed.run();
    this.logger.log(
      `Démo re-seedée (${reason}) : ${res.trades} trades sur ${res.accounts} comptes · WR net ${res.winRate}% · net ${res.pnl} $ (brut ${res.grossPnl} $, frais ${res.fees} $)`,
    );
  }
}
