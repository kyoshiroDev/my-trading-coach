/**
 * `AAAAMMJJ-HHMM` (UTC) : nom de la sauvegarde d'une exécution de réparation admin (#956, #1000).
 * Un seul format pour toutes les réparations : `GET …/backup?at=` le reconnaît partout.
 */
export function backupStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
