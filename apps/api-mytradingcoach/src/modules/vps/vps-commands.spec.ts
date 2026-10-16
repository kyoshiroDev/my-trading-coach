import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VPS_READ_COMMANDS, allowedCommandsFile } from './vps-commands';

const ALLOWED_FILE = join(__dirname, '../../../../../infra/vps/mtc-monitor-allowed-commands');

describe('commandes autorisées du serveur secondaire', () => {
  it('infra/vps/mtc-monitor-allowed-commands est aligné sur vps-commands.ts', () => {
    // En cas d'échec : régénérer le fichier, puis le recopier sur l'ancien VPS
    // (/etc/mtc-monitor/allowed-commands), sinon le secondaire refuse la nouvelle commande.
    //   pnpm exec tsx -e "import { allowedCommandsFile } from './apps/api-mytradingcoach/src/modules/vps/vps-commands'; process.stdout.write(allowedCommandsFile())" > infra/vps/mtc-monitor-allowed-commands
    expect(readFileSync(ALLOWED_FILE, 'utf8')).toBe(allowedCommandsFile());
  });

  it('une commande par ligne, sans doublon (comparaison grep -Fx du wrapper)', () => {
    const cmds = Object.values(VPS_READ_COMMANDS);
    for (const cmd of cmds) expect(cmd).not.toMatch(/[\r\n]/);
    expect(new Set(cmds).size).toBe(cmds.length);
  });

  it("aucune commande d'écriture docker dans la liste du secondaire", () => {
    for (const cmd of Object.values(VPS_READ_COMMANDS)) {
      expect(cmd).not.toMatch(/docker\s+(start|stop|restart|rm|kill|exec|run|logs)\b/);
    }
  });
});
