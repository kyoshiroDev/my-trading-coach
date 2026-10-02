// Valide le catalogue des règles prop firm (schema.json + contrôles métier). Usage : pnpm prop-firms:validate
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const RULES_DIR = resolve(__dirname, '../../libs/shared/src/prop-firm-rules');

interface Phase {
  phase: string;
  profit_target: number | null;
  daily_loss_limit: { amount: number | null } | null;
  max_drawdown: { amount: number };
}

interface Plan {
  id: string;
  account_size: number;
  phases: Phase[];
  source_urls: string[];
}

interface FirmFile {
  firm: { id: string };
  plans: Plan[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(join(RULES_DIR, 'schema.json'), 'utf8')));

const errors: string[] = [];
const planIds = new Map<string, string>();
const files = readdirSync(RULES_DIR).filter((f) => f.endsWith('.json') && f !== 'schema.json');

if (files.length === 0) errors.push(`aucun fichier firm dans ${RULES_DIR}`);

for (const file of files) {
  const data = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf8')) as FirmFile;

  if (!validate(data)) {
    for (const e of validate.errors ?? []) errors.push(`${file}: schéma ${e.instancePath || '/'} ${e.message}`);
    continue;
  }

  if (`${data.firm.id}.json` !== file) errors.push(`${file}: firm.id "${data.firm.id}" ne correspond pas au nom du fichier`);

  for (const plan of data.plans) {
    const where = `${file}: ${plan.id}`;

    const seenIn = planIds.get(plan.id);
    if (seenIn) errors.push(`${where}: id déjà utilisé dans ${seenIn}`);
    planIds.set(plan.id, file);

    if (!plan.id.startsWith(`${data.firm.id}-`)) errors.push(`${where}: l'id doit commencer par "${data.firm.id}-"`);
    if (plan.source_urls.length === 0) errors.push(`${where}: aucune source_url`);

    for (const phase of plan.phases) {
      const at = `${where} [${phase.phase}]`;
      const dd = phase.max_drawdown.amount;

      if (phase.profit_target !== null && phase.profit_target >= plan.account_size) {
        errors.push(`${at}: profit_target (${phase.profit_target}) >= account_size (${plan.account_size})`);
      }
      if (!(dd > 0 && dd < plan.account_size)) {
        errors.push(`${at}: max_drawdown.amount (${dd}) doit être > 0 et < account_size (${plan.account_size})`);
      }
      // Seul le montant de base est contrôlé : des paliers de DLL peuvent dépasser le drawdown (cas réel chez Apex).
      const dll = phase.daily_loss_limit?.amount;
      if (dll != null && dll > dd) errors.push(`${at}: daily_loss_limit.amount (${dll}) > max_drawdown.amount (${dd})`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Catalogue prop firm invalide (${errors.length} erreur(s)) :`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Catalogue prop firm valide : ${files.length} firm(s), ${planIds.size} plan(s).`);
