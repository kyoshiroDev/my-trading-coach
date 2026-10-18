/**
 * Seuils des détecteurs de comportement (#602) : TOUS ici, un seul endroit à régler après le rejeu
 * silencieux (`scripts/replay-behavior-alerts.ts`, rapport `docs/rapport-detecteurs-silencieux.md`).
 *
 * Principe : les détecteurs comportementaux (B, C1, C3) comparent le trader À LUI-MÊME (référence
 * personnelle), jamais à un seuil universel. Seuls les détecteurs A (règles du plan prop firm) et C2
 * (limite déclarée par le trader) ont des seuils fixes, parce que la règle vient d'ailleurs.
 */

// ── Séances et positions ────────────────────────────────────────────────────

/**
 * Lignes sorties dans cette fenêtre, même compte / actif / sens = une seule sortie remplie en
 * plusieurs fills (Tradovate découpe une position en paires de fills, souvent de 1 contrat).
 */
export const POSITION_EXIT_WINDOW_MS = 2_000;

/** Référence personnelle : calculée sur les N dernières séances clôturées (compte × journée CME). */
export const BASELINE_SESSIONS = 20;

/** Période d'apprentissage : B, C1 et C3 muets tant que la référence repose sur moins de séances. */
export const LEARNING_MIN_SESSIONS = 10;

/** Taille de référence d'un actif retenue seulement à partir de ce nombre de positions. */
export const MIN_SIZE_SAMPLES = 5;

/** Délai de référence retenu seulement à partir de ce nombre d'intervalles mesurés. */
export const MIN_GAP_SAMPLES = 5;

/**
 * Quantité aberrante exclue de la référence : au-delà de N × le p90 du trader sur l'actif
 * (fill cassé côté broker, ex. 145 MNQ pour 1 $ de P&L vu en prod).
 */
export const SIZE_OUTLIER_FACTOR = 10;

// ── Anti-spam ───────────────────────────────────────────────────────────────

/** Une même alerte (même type) au plus une fois par fenêtre, dans une séance. */
export const ANTI_SPAM_MS = 15 * 60_000;

// ── A. Règles prop firm ─────────────────────────────────────────────────────

/**
 * A2 : alerte quand la distance avant la perte max du jour (en points défavorables, position
 * ouverte comprise) passe sous ce seuil. Actif absent → A2 muet sur cet actif.
 */
export const A2_MIN_POINTS: Readonly<Record<string, number>> = {
  NQ: 40,
  MNQ: 40,
  ES: 10,
  MES: 10,
};

/** A2 en sévérité haute sous cette fraction du seuil. */
export const A2_HIGH_FRACTION = 0.5;

/** A3 : nouvelle entrée alors que plus de cette part de la perte max du jour est consommée. */
export const A3_DAILY_LOSS_USED = 0.5;

/**
 * Micro → mini : le catalogue donne `max_contracts.minis` et `micros` séparément ; une position
 * mêlant les deux se ramène en minis. 10 micros = 1 mini sur les contrats relevés.
 */
export const MICRO_TO_MINI: Readonly<Record<string, number>> = {
  MNQ: 0.1,
  MES: 0.1,
  MYM: 0.1,
  M2K: 0.1,
  MCL: 0.1,
  MGC: 0.1,
  M6E: 0.1,
};

// ── B. Trade de vengeance ───────────────────────────────────────────────────

/** B : ré-entrée « rapide » = délai < (délai médian du trader après une perte) / N. */
export const B_DELAY_DIVISOR = 3;
/** B : nombre minimal de signaux simultanés. Une ré-entrée rapide SEULE ne déclenche jamais B. */
export const B_MIN_SIGNALS = 2;
/** B en sévérité haute à partir de ce nombre de signaux. */
export const B_HIGH_SIGNALS = 3;

// ── C. Forcer après une perte ───────────────────────────────────────────────

/** C1 : pertes consécutives dans la séance avant une nouvelle entrée. */
export const C1_CONSECUTIVE_LOSSES = 3;
/** C3 : taille ≥ N × la taille de la position perdante précédente sur le même actif. */
export const C3_MARTINGALE_FACTOR = 2;
