import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** API REST Metricool (plans Advanced / Custom) : jeton `X-Mc-Auth`, `userId` + `blogId` en query. */
const METRICOOL_BASE = 'https://app.metricool.com/api';
const TIMEOUT_MS = 15_000;

export interface MetricoolPublishResult {
  /** Identifiant de la publication chez Metricool. */
  postId: string | null;
  /** Lien public si Metricool le renvoie (souvent absent tant que le post n'est pas parti). */
  publicUrl: string | null;
}

/** Erreur Metricool affichable (jamais le corps brut de la réponse). */
export class MetricoolError extends Error {
  constructor(readonly status: number | null, message: string) {
    super(message);
    this.name = 'MetricoolError';
  }
}

/**
 * Client Metricool (PROMPT-tirage-mensuel, lot C) : publication Instagram d'un gagnant.
 * Variables `METRICOOL_API_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID` ; absentes → `configured`
 * faux et l'admin propose « Télécharger l'image » et « Copier la légende ». Aucun envoi sans les trois.
 */
@Injectable()
export class MetricoolClient {
  private readonly logger = new Logger(MetricoolClient.name);

  constructor(private readonly config: ConfigService) {}

  private get creds(): { token: string; userId: string; blogId: string } | null {
    const token = this.config.get<string>('METRICOOL_API_TOKEN')?.trim();
    const userId = this.config.get<string>('METRICOOL_USER_ID')?.trim();
    const blogId = this.config.get<string>('METRICOOL_BLOG_ID')?.trim();
    return token && userId && blogId ? { token, userId, blogId } : null;
  }

  get configured(): boolean {
    return this.creds !== null;
  }

  /**
   * Publie sur Instagram : l'image (URL publique temporaire) est d'abord copiée chez Metricool
   * (`normalize/image/url`), puis le post est programmé avec `autoPublish` (sinon Instagram attend une
   * confirmation sur le téléphone). `publishAt` absent → dans 2 minutes (pas de « maintenant » côté API).
   */
  async publishInstagram(args: { caption: string; imageUrl: string; publishAt?: Date | null }): Promise<MetricoolPublishResult> {
    const c = this.creds;
    if (!c) throw new MetricoolError(null, 'Metricool non configuré.');
    const query = new URLSearchParams({ blogId: c.blogId, userId: c.userId });

    const normalized = await this.call<unknown>(
      `${METRICOOL_BASE}/actions/normalize/image/url?${new URLSearchParams({ url: args.imageUrl, ...Object.fromEntries(query) })}`,
      { method: 'GET', headers: { 'X-Mc-Auth': c.token } },
    );
    const media = typeof normalized === 'string' ? normalized : ((normalized as { data?: unknown })?.data ?? normalized);
    const mediaUrl = typeof media === 'string' ? media : args.imageUrl;

    const when = args.publishAt ?? new Date(Date.now() + 2 * 60_000);
    const dateTime = when.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).replace(' ', 'T');
    const body = {
      text: args.caption,
      publicationDate: { dateTime, timezone: 'Europe/Paris' },
      providers: [{ network: 'instagram' }],
      autoPublish: true,
      media: [mediaUrl],
      instagramData: { type: 'POST' },
    };
    const res = await this.call<{ data?: { id?: number | string; publicUrl?: string } }>(
      `${METRICOOL_BASE}/v2/scheduler/posts?${query}`,
      { method: 'POST', headers: { 'X-Mc-Auth': c.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    const id = res?.data?.id;
    return { postId: id === undefined || id === null ? null : String(id), publicUrl: res?.data?.publicUrl ?? null };
  }

  private async call<T>(url: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      this.logger.warn(`Metricool injoignable : ${(err as Error).name}`);
      throw new MetricoolError(null, 'Metricool injoignable.');
    }
    if (!res.ok) {
      // Corps jamais journalisé ni renvoyé tel quel (peut contenir des identifiants).
      this.logger.warn(`Metricool a refusé la requête : HTTP ${res.status}`);
      const reason = res.status === 401 || res.status === 403 ? 'accès refusé (abonnement ou jeton)' : `erreur ${res.status}`;
      throw new MetricoolError(res.status, `Metricool : ${reason}.`);
    }
    const text = await res.text();
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      return text as unknown as T;
    }
  }
}
