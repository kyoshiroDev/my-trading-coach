import { API_URL } from '../config';

/**
 * État PUBLIC de l'offre fondateur (#525), lu côté navigateur sur `GET /pricing/founder`.
 * Bandeau, carte Fondateur et FAQ s'y branchent tous : UNE requête par page (promesse partagée),
 * et la valeur reste au plus 60 s en sessionStorage (même durée que le cache HTTP de l'API) pour
 * l'afficher sans attendre sur les pages suivantes.
 *
 * Jamais de chiffre inventé : API injoignable, réponse invalide ou trop vieille → `null`, et rien
 * ne s'affiche (le HTML statique, sans offre, reste correct).
 */
export interface FounderState {
  open: boolean;
  ended: boolean;
  seatsTotal: number;
  seatsLeft: number;
  priceMonthlyEur: number;
  priceAnnualEur: number;
}

const CACHE_KEY = 'mtc_founder';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 4_000;

/** Point de clic retenu pour la session (`bandeau`, `faq`) ; sinon la carte dit `carte`. */
export const CTA_KEY = 'mtc_cta';

function parse(raw: unknown): FounderState | null {
  const s = raw as Partial<FounderState> | null;
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (
    !s ||
    typeof s.open !== 'boolean' ||
    typeof s.ended !== 'boolean' ||
    !int(s.seatsTotal) ||
    !int(s.seatsLeft) ||
    (s.seatsLeft as number) > (s.seatsTotal as number) ||
    !int(s.priceMonthlyEur) ||
    !int(s.priceAnnualEur)
  ) {
    return null;
  }
  return s as FounderState;
}

/** Dernier état connu de moins de 60 s (affichage immédiat), sinon `null`. */
export function cachedFounderState(): FounderState | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') as { ts: number; state: unknown } | null;
    if (!c || Date.now() - c.ts > CACHE_TTL_MS) return null;
    return parse(c.state);
  } catch {
    return null;
  }
}

let pending: Promise<FounderState | null> | null = null;

/** État à jour (une seule requête par page, quel que soit le nombre d'appelants). */
export function founderState(): Promise<FounderState | null> {
  pending ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/pricing/founder`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      // Enveloppe `{ data }` de l'API (intercepteur global), comme le compteur de traders.
      const body = (await res.json()) as { data?: unknown } | null;
      const state = parse(body?.data);
      if (state) {
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), state }));
        } catch {
          /* stockage indisponible : on affiche quand même */
        }
      }
      return state;
    } catch {
      return null;
    }
  })();
  return pending;
}

/** Applique `apply` tout de suite avec le cache (s'il existe), puis avec l'état frais. */
export function onFounderState(apply: (s: FounderState | null) => void): void {
  const cached = cachedFounderState();
  if (cached) apply(cached);
  void founderState().then((fresh) => {
    // API injoignable alors qu'un cache récent existe : on garde ce qui est affiché (< 60 s).
    if (fresh || !cached) apply(fresh);
  });
}

/** L'offre vend-elle ? (ouverte et au moins une place) */
// Garde de type sur `open: true` (et non sur FounderState) : la branche « faux » garde un état
// possible, utile pour lire `ended` quand l'offre ne vend pas.
export const isSelling = (s: FounderState | null): s is FounderState & { open: true } =>
  !!s && s.open && s.seatsLeft > 0;

/** « 12 places » / « 1 place ». */
export const placesLabel = (n: number) => `${n} place${n > 1 ? 's' : ''}`;

/** Retient le point de clic de la session (bandeau, faq) jusqu'au CTA de la carte. */
export function rememberCta(cta: string): void {
  try {
    sessionStorage.setItem(CTA_KEY, cta);
  } catch {
    /* sans stockage : la carte enverra `carte` */
  }
}

/**
 * Lien entrant portant un point de clic (campagne e-mail : `?cta=email`) : retenu pour la session,
 * comme un clic sur le bandeau, jusqu'au CTA de la carte puis à l'app. Seul `email` est accepté
 * depuis l'URL (les autres points de clic sont posés par la page elle-même).
 */
export function captureCtaFromUrl(): void {
  try {
    if (new URL(window.location.href).searchParams.get('cta') === 'email') rememberCta('email');
  } catch {
    /* URL illisible : rien à retenir */
  }
}

export function rememberedCta(): string | null {
  try {
    return sessionStorage.getItem(CTA_KEY);
  } catch {
    return null;
  }
}
