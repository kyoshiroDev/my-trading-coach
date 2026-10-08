import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { runsCrons } from '../../config/app-role';

const BASE = 'https://api.anthropic.com/v1/organizations/cost_report';

export interface DailyModelCost {
  date: string; // 'YYYY-MM-DD' (UTC)
  model: string;
  amountUsd: number;
}

/**
 * Coût RÉEL facturé par Anthropic via la Cost API (clé Admin org-wide, lecture).
 * Source autoritative qui colle à la facture, tous environnements confondus.
 * Mis en cache quotidiennement dans AnthropicCostDaily ; endpoints en beta → parsing défensif.
 */
@Injectable()
export class AnthropicCostService implements OnModuleInit {
  private readonly logger = new Logger(AnthropicCostService.name);
  private readonly adminKey = process.env['ANTHROPIC_ADMIN_KEY'];

  constructor(private readonly prisma: PrismaService) {}

  /** Au boot du worker cron : remplit le cache s'il est vide (premier déploiement). */
  async onModuleInit(): Promise<void> {
    if (!runsCrons()) return;
    try {
      const count = await this.prisma.anthropicCostDaily.count();
      if (count === 0) {
        this.logger.log('Cache coût Anthropic vide au boot → refresh initial.');
        await this.refreshLast30Days();
      }
    } catch (e) {
      this.logger.warn(`Boot refresh coût Anthropic ignoré: ${(e as Error).message}`);
    }
  }

  // 06h00 chaque jour (worker cron only) : le re-upsert des 30j corrige les révisions tardives.
  @Cron('0 6 * * *')
  async scheduledRefresh(): Promise<void> {
    const { rows, total30d } = await this.refreshLast30Days();
    this.logger.log(`Refresh coût Anthropic: ${rows} lignes, total 30j ≈ $${total30d.toFixed(2)}`);
  }

  /**
   * Identifiant du modèle depuis la description, version comprise : « Claude Haiku 5.5 … » →
   * 'claude-haiku-5-5', « Claude Sonnet 4.6 … » → 'claude-sonnet-4-6'. Sans version lisible →
   * 'claude-haiku' / 'claude-sonnet' / … ; pas un modèle (web search, code execution…) → 'other'.
   * La version compte : pendant une migration, deux générations coexistent sur les 30 jours.
   */
  private parseModel(description: string): string {
    const d = (description ?? '').toLowerCase();
    const m = d.match(/\b(haiku|sonnet|opus|fable|mythos)\b(?:[\s-]+(\d+)(?:[.-](\d{1,2})(?!\d))?)?/);
    if (!m) return 'other';
    const [, family, major, minor] = m;
    if (!major) return `claude-${family}`;
    return minor ? `claude-${family}-${major}-${minor}` : `claude-${family}-${major}`;
  }

  /**
   * Appelle la Cost API (fetch natif, l'Admin API n'est pas couverte par le SDK messages).
   * Pagination via has_more/next_page. Montants en cents (chaînes) → /100 USD.
   * ADMIN_KEY absente ou erreur → [] (best-effort, ne throw pas).
   */
  async fetchCostReport(startIso: string, endIso: string): Promise<DailyModelCost[]> {
    if (!this.adminKey) {
      this.logger.warn('ANTHROPIC_ADMIN_KEY non configuré : bloc coût réel ignoré.');
      return [];
    }

    const agg = new Map<string, number>(); // `${date}|${model}` → USD
    let page: string | undefined;

    try {
      do {
        const url = new URL(BASE);
        url.searchParams.set('starting_at', startIso);
        url.searchParams.set('ending_at', endIso);
        url.searchParams.append('group_by[]', 'description');
        if (page) url.searchParams.set('page', page);

        const res = await fetch(url.toString(), {
          headers: {
            'anthropic-version': '2023-06-01',
            'x-api-key': this.adminKey,
            'user-agent': 'MyTradingCoach/1.0',
          },
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          this.logger.error(`Cost API ${res.status}: ${body.slice(0, 500)}`);
          break; // best-effort : on garde ce qu'on a déjà agrégé
        }

        const json = (await res.json()) as {
          data?: { starting_at?: string; results?: { amount?: string; description?: string }[] }[];
          has_more?: boolean;
          next_page?: string | null;
        };

        for (const bucket of json.data ?? []) {
          const date = (bucket.starting_at ?? '').slice(0, 10); // 'YYYY-MM-DD'
          if (!date) continue;
          for (const result of bucket.results ?? []) {
            const cents = parseFloat(result.amount ?? '');
            if (!Number.isFinite(cents)) continue;
            const model = this.parseModel(result.description ?? '');
            const key = `${date}|${model}`;
            agg.set(key, (agg.get(key) ?? 0) + cents / 100);
          }
        }

        page = json.has_more && json.next_page ? json.next_page : undefined;
      } while (page);
    } catch (e) {
      this.logger.error(`Cost API fetch failed: ${(e as Error).message}`);
    }

    return [...agg.entries()].map(([k, amountUsd]) => {
      const [date, model] = k.split('|');
      return { date, model, amountUsd };
    });
  }

  /**
   * Rafraîchit le cache sur 30 jours (jour courant inclus, possiblement partiel).
   * Upsert par (date, model). Best-effort : 0 ligne renvoyée → le cache existant est conservé.
   */
  async refreshLast30Days(): Promise<{ rows: number; total30d: number }> {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

    const rows = await this.fetchCostReport(start.toISOString(), end.toISOString());
    if (rows.length === 0) return { rows: 0, total30d: 0 };

    let total = 0;
    for (const r of rows) {
      total += r.amountUsd;
      await this.prisma.anthropicCostDaily.upsert({
        where: { date_model: { date: r.date, model: r.model } },
        create: { date: r.date, model: r.model, amountUsd: r.amountUsd },
        update: { amountUsd: r.amountUsd },
      });
    }
    return { rows: rows.length, total30d: total };
  }
}