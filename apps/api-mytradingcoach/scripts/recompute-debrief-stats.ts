/**
 * Recalcul des stats des débriefs hebdo déjà enregistrés (#943, suite de #934). Logique et règles :
 * `src/modules/debrief/debrief-stats-recompute.ts` (même calcul que la génération, `stats` seul,
 * aucun appel IA, comptes démo exclus, semaine dont les trades ont disparu laissée telle quelle).
 *
 * Sans `--apply` : LECTURE SEULE, bilan sans identifiant (lus, modifiés, inchangés, champs touchés,
 * ignorés : trades supprimés depuis la génération / ancien format).
 * Avec `--apply` : `--backup <fichier>` obligatoire, NOUVEAU fichier (jamais écrasé), une ligne JSON
 * `{ id, stats }` écrite AVANT chaque modification.
 * `--user <id>` : un seul trader (essai sur un compte avant le passage complet).
 * Retour arrière : `--restore <fichier>` (simulation), puis `--restore <fichier> --apply`.
 *
 * Exécution dans le conteneur worker de l'API (DATABASE_URL déjà présent, fuseau de l'API) :
 *   pnpm exec esbuild apps/api-mytradingcoach/scripts/recompute-debrief-stats.ts --bundle --platform=node \
 *     --tsconfig=apps/api-mytradingcoach/tsconfig.app.json \
 *     --external:@prisma/client --external:@prisma/adapter-pg --external:pg --outfile=rds.js
 *   scp rds.js <vps>:~/rds-943.js   (depuis l'ordinateur où le bundle a été fait)
 *   docker cp ~/rds-943.js <conteneur>:/tmp/   (/app appartient à root, le conteneur tourne en uid 1001)
 *   docker exec -e NODE_PATH=/app/node_modules <conteneur> node /tmp/rds-943.js
 *   docker exec -e NODE_PATH=/app/node_modules <conteneur> node /tmp/rds-943.js --apply --backup /tmp/debrief-stats-backup-AAAAMMJJ-HHMM.jsonl
 *   docker cp <conteneur>:/tmp/debrief-stats-backup-AAAAMMJJ-HHMM.jsonl ~/ && wc -l ~/debrief-stats-backup-*.jsonl
 *   (NODE_PATH : hors de /app, Node ne trouve pas @prisma/client. Garder la sauvegarde hors du
 *   conteneur : un redéploiement efface /tmp.)
 */
import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  recomputeDebriefStats,
  restoreDebriefStats,
  type DebriefStatsBackupRow,
} from '../src/modules/debrief/debrief-stats-recompute';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const valeur = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? (args[i + 1] ?? null) : null;
  };
  const backup = valeur('--backup');
  const restore = valeur('--restore');
  if (apply && !restore && !backup) throw new Error('--apply exige --backup <fichier> (nouveau fichier, jamais écrasé)');

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as ConstructorParameters<typeof PrismaClient>[0]);
  // 'wx' : échoue si le fichier existe, jamais d'écrasement d'une sauvegarde.
  const fd = apply && !restore && backup ? openSync(backup, 'wx') : null;
  try {
    if (restore) {
      const rows = readFileSync(restore, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as DebriefStatsBackupRow);
      const bilan = await restoreDebriefStats(prisma, rows, apply);
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', phase: 'restore', ...bilan }, null, 2));
      return;
    }
    const bilan = await recomputeDebriefStats(prisma, {
      apply,
      backup: fd != null ? (row) => writeSync(fd, `${JSON.stringify(row)}\n`) : undefined,
      userId: valeur('--user') ?? undefined,
    });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', phase: 'recalcul', ...bilan }, null, 2));
  } finally {
    if (fd != null) {
      fsyncSync(fd);
      closeSync(fd);
    }
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
