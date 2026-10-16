/**
 * Commandes SSH de LECTURE de la page Surveillance (stats système + liste des containers).
 *
 * Le serveur secondaire n'accepte QUE ces chaînes, à l'identique : sa clé SSH a une commande
 * forcée (`infra/vps/mtc-monitor-ro.sh`) qui les compare à `infra/vps/mtc-monitor-allowed-commands`.
 * Modifier une chaîne ici = régénérer ce fichier (`vps-commands.spec.ts` échoue sinon) puis le
 * recopier sur l'ancien VPS (`/etc/mtc-monitor/allowed-commands`), sinon le secondaire la refuse.
 */
export const VPS_READ_COMMANDS = {
  loadAvg: 'cat /proc/loadavg',
  memInfo: 'cat /proc/meminfo',
  disk: 'df -B1 / | tail -1',
  uptime: 'cat /proc/uptime',
  kernel: 'uname -r',
  node: 'node -v 2>/dev/null || echo n/a',
  docker: "docker -v 2>/dev/null | awk '{print $3}' | tr -d ',' || echo n/a",
  network: "cat /proc/net/dev | grep -E 'eth0|ens' | head -1",
  dockerPs:
    'docker ps -a --format \'{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","ports":"{{.Ports}}"}\'',
  dockerStats: 'docker stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"',
} as const;

/** Contenu attendu de `infra/vps/mtc-monitor-allowed-commands` : une commande par ligne. */
export function allowedCommandsFile(): string {
  return `${Object.values(VPS_READ_COMMANDS).join('\n')}\n`;
}
