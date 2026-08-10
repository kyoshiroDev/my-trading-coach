# Agent VPS — Infrastructure & Monitoring

## Infrastructure

```
VPS OVH — 51.83.197.230 (user: greg)
├── mtc_traefik     → reverse proxy + SSL
├── mtc_postgres    → PostgreSQL 17 — port 5432
├── mtc_pgbouncer   → PgBouncer — port 6432
├── mtc_redis       → Redis 7.4
├── mtc_api_prod    → NestJS production
└── mtc_api_dev     → NestJS dev
```

---

## Module NestJS `vps`

Fichiers : `src/modules/vps/`
- `vps.service.ts` → connexion SSH via node-ssh
- `vps.controller.ts` → stats système, apt, reboot
- `docker.service.ts` → gestion containers
- `docker.controller.ts`
- `backup.service.ts` → pg_dump, liste fichiers
- `backup.controller.ts`
- `logs.service.ts` → docker logs SSE
- `logs.controller.ts`

---

## Connexion SSH

```typescript
import { NodeSSH } from 'node-ssh';

private ssh = new NodeSSH();

private async connect() {
  if (this.ssh.isConnected()) return this.ssh;
  const privateKey = Buffer.from(
    process.env.VPS_SSH_KEY_B64!, 'base64'
  ).toString('utf-8');
  await this.ssh.connect({
    host: process.env.VPS_HOST ?? '51.83.197.230',
    username: process.env.VPS_USER ?? 'greg',
    privateKey,
  });
  return this.ssh;
}
```

---

## Variables d'environnement

```
VPS_HOST=51.83.197.230
VPS_USER=greg
VPS_SSH_KEY_B64=<clé privée SSH encodée base64>
BACKUP_DIR=/opt/backups/mtc
```

---

## Stats système — commandes SSH

```bash
cat /proc/loadavg          # CPU load
free -b                    # RAM (bytes)
df -B1 /                   # Disque (bytes)
cat /proc/net/dev          # Network
cat /proc/uptime           # Uptime (secondes)
uname -r                   # Kernel
node -v                    # Node.js version
docker -v                  # Docker version
```

---

## SSE — Streaming logs

```typescript
@Get('logs/:container')
async streamLogs(
  @Param('container') container: string,
  @Req() req: Request,
  @Res() res: Response,
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const ssh = await this.vpsService.getConnection();
  ssh.exec(`docker logs -f --tail 100 ${container}`, [], {
    onStdout: (chunk) =>
      res.write(`data: ${chunk.toString().replace(/\n/g, '\ndata: ')}\n\n`),
    onStderr: (chunk) =>
      res.write(`data: ${chunk.toString().replace(/\n/g, '\ndata: ')}\n\n`),
  });
  req.on('close', () => res.end());
}
```

---

## Sécurité

- Tous les endpoints VPS/Docker/Backup/Logs : `@UseGuards(JwtAuthGuard, AdminGuard)`
- Clé SSH uniquement via `VPS_SSH_KEY_B64` env var — jamais en dur dans le code
- Actions destructives (reboot, restore) : vérification côté frontend + backend

---

## Backup

```
Répertoire : /opt/backups/mtc/          (surveillé par l'app admin via BACKUP_DIR)
Script     : /opt/backups/mtc/backup.sh (cron greg 3h00, log /opt/backups/mtc-backup.log)
Format     : mtc_<prod|dev|beta>_YYYYMMDDTHHMM_<auto|manual>.sql.gz
Commande   : docker exec mtc_postgres pg_dump -U mtc_user mytradingcoach_<env> | gzip > ...
Rétention  : 14 jours (find -name "*_auto.sql.gz" -mtime +14 -delete)
```

Les **3 environnements** sont dumpés : `prod` (requis — le script échoue si KO),
`dev` et `beta` (optionnels). Un dump vide ou tronqué est **supprimé** plutôt que
conservé, pour ne pas donner une fausse impression de sécurité.

`BackupService` déduit l'environnement du nom de fichier (`_dev_` / `_beta_`,
sinon `prod`) → tout nouveau label de base doit être ajouté **aux 3 endroits** :
`backup.sh` (VPS), `backup.service.ts` (`DB_BY_TARGET` + `LABEL_BY_TARGET` +
`targetFromFilename`) et `TARGET_CONFIG` du front admin. Sinon le dump s'affiche
sous le mauvais environnement dans l'admin.

⚠️ Pas d'alerte automatique en cas d'échec — l'app admin sert de contrôle de
fraîcheur. Les logs cron de `greg` doivent aller dans `/opt/backups/*.log` :
`greg` ne peut pas **créer** de fichier dans `/var/log/`, et une redirection qui
échoue à l'ouverture empêche le job entier de tourner, silencieusement.
