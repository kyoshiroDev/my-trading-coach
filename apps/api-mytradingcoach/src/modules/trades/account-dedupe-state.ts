import { CrossSourcePool } from './import-dedupe.util';
import { CentRoundingPool, LegacyNetPnlPool, dedupeKey, occurrenceHash } from './trade-identity.util';

/** Trade déjà en base, tel que lu pour le dédoublonnage d'un import. */
export interface StoredForDedupe {
  asset: string;
  side: string;
  tradedAt: Date;
  entry: number;
  exit: number | null;
  pnl: number | null;
  accountId: string | null;
}

/**
 * État du dédoublonnage d'un import pour UN compte (#1001) : empreintes déjà prises, rapprochements
 * (autre fuseau, ancien P&L net MEXC, ancien arrondi au centime) et rang des répétitions dans la source.
 *
 * Un trade est un doublon seulement s'il existe déjà dans le MÊME compte : le même trade copié sur deux
 * comptes (copy trading) est importé dans chacun. Les trades sans compte (ancienne donnée, 0 en prod le
 * 15/11) comptent pour tous les comptes : jamais recréés par prudence.
 */
export class AccountDedupeState {
  readonly otherTimezone: CrossSourcePool;
  readonly legacyNet: LegacyNetPnlPool;
  readonly centRounding: CentRoundingPool;
  /** Empreintes déjà prises : la clé, puis `#2`, `#3`… autant de fois que la clé existe en base. */
  readonly seen = new Set<string>();
  /** Nombre de trades en base par clé exacte. */
  readonly inBase = new Map<string, number>();
  /** Rang de chaque clé DANS la source : deux lignes identiques sont deux trades (cf. occurrenceHash). */
  readonly inSource = new Map<string, number>();

  constructor(stored: StoredForDedupe[]) {
    this.otherTimezone = new CrossSourcePool(stored);
    this.legacyNet = new LegacyNetPnlPool(stored);
    this.centRounding = new CentRoundingPool(stored);
    for (const t of stored) {
      const key = dedupeKey(t);
      const n = (this.inBase.get(key) ?? 0) + 1;
      this.inBase.set(key, n);
      this.seen.add(occurrenceHash(key, n));
    }
  }
}

/**
 * États par compte, créés à la demande sur les trades déjà lus (une seule requête par import).
 * Sait aussi dans quels AUTRES comptes une clé existe déjà : le résultat de l'import le dit
 * (« 12 trades existent aussi dans le compte « Apex 50k #1 » : importés ici aussi. »).
 */
export class AccountDedupeStates {
  private readonly states = new Map<string, AccountDedupeState>();
  private readonly accountsByKey = new Map<string, Set<string>>();

  constructor(
    private readonly stored: StoredForDedupe[],
    /** Empreintes d'avant #1001 (sans préfixe) trouvées en base pour les clés du lot, avec leur compte. */
    private readonly legacyHashes: { importHash: string | null; accountId: string | null }[] = [],
  ) {
    for (const t of stored) {
      if (!t.accountId) continue;
      const key = dedupeKey(t);
      let set = this.accountsByKey.get(key);
      if (!set) this.accountsByKey.set(key, (set = new Set()));
      set.add(t.accountId);
    }
  }

  for(accountId: string | null): AccountDedupeState {
    const k = accountId ?? '';
    let s = this.states.get(k);
    if (!s) {
      const mine = (t: { accountId: string | null }) => t.accountId == null || t.accountId === accountId;
      s = new AccountDedupeState(this.stored.filter(mine));
      // Trade importé avant #1001 puis modifié : son empreinte reste prise DANS SON COMPTE (avant, l'index
      // le protégeait ; une empreinte venue d'un autre compte ne bloque rien, c'est le but de #1001).
      for (const h of this.legacyHashes) if (h.importHash && mine(h)) s.seen.add(h.importHash);
      this.states.set(k, s);
    }
    return s;
  }

  /** Autre compte où ce trade (même clé) existe déjà, ou null. Le plus petit identifiant si plusieurs : stable. */
  otherAccountWith(accountId: string | null, dto: Parameters<typeof dedupeKey>[0]): string | null {
    const others = [...(this.accountsByKey.get(dedupeKey(dto)) ?? [])].filter((a) => a !== accountId).sort();
    return others[0] ?? null;
  }
}
