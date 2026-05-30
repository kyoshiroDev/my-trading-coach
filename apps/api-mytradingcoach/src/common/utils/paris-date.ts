export function todayParis(): string {
  return new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

export function toParisDateStr(d: Date): string {
  return d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}
