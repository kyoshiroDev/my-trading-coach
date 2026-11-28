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

// ── Jauge de pression (#1270, étude) ────────────────────────────────────────

/**
 * Jauge de pression : somme de points par signal, plafonnée à 100, TOUJOURS par rapport à la
 * référence du trader (sauf règles du plan et limite déclarée, qui viennent d'ailleurs). Valeurs
 * de départ de l'étude, à régler après le rejeu (`scripts/replay-pressure.ts`, `docs/audit-1270.md`).
 * Rien n'est affiché tant que l'étude n'a pas montré un pouvoir prédictif.
 */
export const PRESSURE_MAX = 100;
/** Seuils des états : sous `WATCH` calme, à partir de `RED` zone rouge. */
export const PRESSURE_WATCH = 30;
export const PRESSURE_RED = 60;

/** Ré-entrée après une perte : délai / délai médian du trader après une perte → points. */
export const PRESSURE_REENTRY: readonly { below: number; points: number }[] = [
  { below: 1 / 3, points: 30 },
  { below: 1 / 2, points: 20 },
  { below: 1, points: 10 },
];
/** Taille au-dessus du p90 du trader sur l'actif ; majorée juste après une perte. */
export const PRESSURE_SIZE_POINTS = 15;
export const PRESSURE_SIZE_AFTER_LOSS_POINTS = 25;
/** Rythme : rang de la position dans la séance au-delà du p90 de positions par séance du trader. */
export const PRESSURE_PACE_POINTS = 15;
export const PRESSURE_PACE_HIGH_FACTOR = 1.5;
export const PRESSURE_PACE_HIGH_POINTS = 25;
/** Pertes d'affilée dans la séance avant l'entrée → points (la plus haute ligne atteinte). */
export const PRESSURE_STREAK: readonly { from: number; points: number }[] = [
  { from: 4, points: 30 },
  { from: 3, points: 20 },
  { from: 2, points: 10 },
];
/** Part de la perte max du jour déjà consommée → points. */
export const PRESSURE_DAILY_LOSS: readonly { above: number; points: number }[] = [
  { above: 0.8, points: 30 },
  { above: 0.5, points: 15 },
];
/** Règle du plan dépassée (taille) ou limite de positions déclarée par le trader dépassée. */
export const PRESSURE_OVER_PLAN_POINTS = 30;
export const PRESSURE_OVER_LIMIT_POINTS = 15;

// ── E1 stop éloigné (#672) ────────────────────────────────────────────────────

/**
 * Écart minimal (ticks) entre l'ancien et le nouveau stop pour signaler un éloignement : en dessous,
 * un glissement d'un tick (stop suiveur, clic imprécis) n'est pas un geste.
 */
export const E1_MIN_TICKS = 2;
/** Une alerte E1 par position : clé gardée le temps d'une séance (comme `behavior:pos`). */
export const E1_ONCE_TTL_S = 12 * 3600;
