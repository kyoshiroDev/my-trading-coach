// Veille des sources du catalogue prop firm : articles modifiés depuis le dernier relevé. Usage : pnpm prop-firms:watch [--update] [--report <fichier.md>] [--github-output]
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const RULES_DIR = resolve(__dirname, '../../libs/shared/src/prop-firm-rules');
const SNAPSHOT = join(RULES_DIR, 'veille/sources.json');
const STALE_DAYS = 30;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

/**
 * `date` = date de modification publiée par la firm ; `hash` = empreinte du contenu.
 * `values` : toutes les versions connues. Certaines pages de vente servent plusieurs versions à la fois
 * (test A/B, déploiement progressif) : seule une version jamais vue compte comme une modification.
 */
interface Fingerprint {
  kind: 'date' | 'hash';
  values: string[];
}

/** Lectures par page à empreinte, pour voir les versions servies en alternance. */
const SAMPLES = 4;
/** Versions gardées par source dans le relevé. */
const MAX_VARIANTS = 4;

type Snapshot = Record<string, Fingerprint & { firms: string[] }>;

type Result =
  | { url: string; firms: string[]; status: 'ok'; fp: Fingerprint }
  | { url: string; firms: string[]; status: 'unreachable'; reason: string };

interface FirmFile {
  firm: { id: string; name: string };
  verified_at: string;
  plans: { source_urls: string[] }[];
}

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const GITHUB_OUTPUT = args.includes('--github-output');
const reportArg = args.indexOf('--report');
const REPORT = reportArg >= 0 ? args[reportArg + 1] : null;

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

function loadCatalog() {
  const firms = readdirSync(RULES_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'schema.json')
    .map((f) => JSON.parse(readFileSync(join(RULES_DIR, f), 'utf8')) as FirmFile);
  const urls = new Map<string, Set<string>>();
  for (const f of firms) {
    for (const p of f.plans) for (const u of p.source_urls) urls.set(u, (urls.get(u) ?? new Set()).add(f.firm.id));
  }
  return { firms, urls };
}

async function get(url: string, attempt = 0): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json' }, signal: AbortSignal.timeout(20_000) });
  // Help Scout (OneUp) limite le débit : une seconde tentative après une pause suffit.
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
    return get(url, attempt + 1);
  }
  return { status: res.status, body: await res.text() };
}

async function getJson<T>(url: string): Promise<T> {
  const { status, body } = await get(url);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return JSON.parse(body) as T;
}

/** Texte visible normalisé : sans scripts, styles ni balises, et sans les « Updated over 3 weeks ago » relatifs. */
function visibleText(html: string): string {
  const main = html.match(/<(article|main)\b[\s\S]*<\/\1>/i)?.[0] ?? html;
  return main
    // Cloudflare (Rocket Loader) renomme ces attributs à chaque chargement.
    .replace(/\sdata-cf-[a-z]+-[0-9a-f]+-(="[^"]*")?/gi, '')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\b(updated|mis à jour|written by)\b[^.<]{0,60}\b(ago|week|month|year|day|hour|minute)s?\b/gi, ' ')
    // Fils de « payouts récents » (MyFundedFutures…) : montants au centime et latences en ms, renouvelés à chaque chargement.
    // Les règles s'expriment en dollars ronds : on ne perd rien d'utile.
    .replace(/\$\s?[\d,]+\.\d{2}\b/g, ' ')
    .replace(/\b\d+\s?ms\b/g, ' ')
    // …et ce bloc lui-même n'est pas toujours rendu.
    .replace(/Real Recent Payouts|Payout auto-approved|Sample only\. Not all payouts shown\.[^.]*\./gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fingerprint(url: string): Promise<Fingerprint> {
  const u = new URL(url);

  // Take Profit Trader : l'API Zendesk donne la date de la dernière modification du texte.
  const zendesk = u.hostname.endsWith('zendesk.com') && u.pathname.match(/articles\/(\d+)/);
  if (zendesk) {
    const { article } = await getJson<{ article: { edited_at: string } }>(`${u.origin}/api/v2/help_center/en-us/articles/${zendesk[1]}.json`);
    return { kind: 'date', values: [article.edited_at] };
  }

  // Phidias : l'updatedAt de l'API bouge sans modification, on prend l'empreinte du contenu.
  const phidias = u.hostname === 'helpcenter.phidiaspropfirm.com' && u.pathname.match(/^\/help\/([^/]+)/);
  if (phidias) {
    const { article } = await getJson<{ article: { title: string; content: string } }>(
      `${u.origin}/api/portal/phidias-prop-firm/knowledge/${phidias[1]}?locale=fr`,
    );
    return { kind: 'hash', values: [sha(article.title + article.content)] };
  }

  // Bulenox : pages rendues côté client, le contenu vient du CMS public (Directus).
  const bulenox = u.hostname === 'bulenox.com' && u.pathname.match(/^\/help-center\/([^/]+)/);
  if (bulenox) {
    const cms = `${u.origin}/cms/items`;
    const items = await getJson<{ data: { id: string }[] }>(`${cms}/help_items?limit=-1&fields=id&filter[category][_eq]=${bulenox[1]}`);
    const ids = items.data.map((i) => i.id).sort().join(',');
    if (!ids) throw new Error(`catégorie CMS vide (${bulenox[1]})`);
    const tr = await getJson<{ data: unknown[] }>(
      `${cms}/help_items_translations?limit=-1&filter[languages_code][_eq]=en&filter[help_items_id][_in]=${ids}&fields=help_items_id,title,lead,blocks.sort,blocks.text,blocks.list_items,blocks.table_head,blocks.table_rows&sort=help_items_id`,
    );
    return { kind: 'hash', values: [sha(JSON.stringify(tr.data))] };
  }

  const { status, body } = await get(url);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  // Centres d'aide Intercom (Lucid, BluSky, Earn2Trade, MyFundedFutures, Top One, Topstep…) : date publiée en JSON-LD.
  const modified = body.match(/"dateModified"\s*:\s*"([^"]+)"/)?.[1];
  if (modified) return { kind: 'date', values: [modified] };
  // Freshdesk (TradeDay) : « Modified on Mon, 27 Apr at 3:42 PM ».
  const freshdesk = body.match(/Modified on ([^<]+?)\s*</)?.[1];
  if (freshdesk) return { kind: 'date', values: [freshdesk.replace(/\s+/g, ' ')] };
  const text = visibleText(body);
  if (text.length < 200) throw new Error('contenu rendu en JavaScript, illisible sans navigateur');
  const seen = new Set([sha(text)]);
  for (let i = 1; i < SAMPLES; i++) {
    await new Promise((r) => setTimeout(r, 1_500));
    const again = await get(url);
    if (again.status === 200) seen.add(sha(visibleText(again.body)));
  }
  return { kind: 'hash', values: [...seen].sort() };
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function report(firms: FirmFile[], results: Result[], previous: Snapshot): { markdown: string; attention: boolean } {
  const name = new Map(firms.map((f) => [f.firm.id, f.firm.name]));
  const isNew = (r: Result) => r.status === 'ok' && r.fp.values.some((v) => !previous[r.url].values.includes(v));
  const changed = results.filter((r) => r.status === 'ok' && previous[r.url] && isNew(r));
  const variants = results.filter((r) => r.status === 'ok' && r.fp.values.length > 1);
  const added = results.filter((r) => r.status === 'ok' && !previous[r.url]);
  const unreachable = results.filter((r) => r.status === 'unreachable');
  const today = Date.now();
  const stale = firms
    .map((f) => ({ f, days: Math.floor((today - Date.parse(f.verified_at)) / 86_400_000) }))
    .filter((x) => x.days > STALE_DAYS)
    .sort((a, b) => b.days - a.days);

  const byFirm = (rs: Result[], line: (r: Result) => string) => {
    const groups = new Map<string, string[]>();
    for (const r of rs) for (const f of r.firms) groups.set(f, [...(groups.get(f) ?? []), line(r)]);
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([f, lines]) => `**${name.get(f) ?? f}**\n${lines.join('\n')}`).join('\n\n');
  };

  const md: string[] = [
    `## Veille des règles prop firm · ${new Date().toISOString().slice(0, 10)}`,
    '',
    `${results.length} sources relues : **${changed.length} modifiée(s)**, ${added.length} nouvelle(s), ${unreachable.length} illisible(s) hors navigateur. ${stale.length} firm(s) vérifiée(s) il y a plus de ${STALE_DAYS} jours.`,
  ];
  if (changed.length) {
    md.push('', '### Articles modifiés depuis le dernier relevé', '', 'Relire l\'article, mettre à jour le JSON de la firm et son `verified_at`, puis `pnpm prop-firms:validate` et `pnpm prop-firms:watch --update`.', '');
    md.push(byFirm(changed, (r) => {
      const before = previous[r.url];
      const fp = (r as Extract<Result, { status: 'ok' }>).fp;
      return `- ${r.url} (${fp.kind === 'date' ? `modifié le ${fp.values[0].slice(0, 10)}, relevé du ${before.values[0].slice(0, 10)}` : 'contenu modifié'})`;
    }));
  }
  if (stale.length) {
    md.push('', `### Firms à revérifier (plus de ${STALE_DAYS} jours)`, '');
    md.push(...stale.map(({ f, days }) => `- ${f.firm.name} : vérifiée le ${f.verified_at} (${days} jours)`));
  }
  if (variants.length) {
    md.push('', '### Pages servies en plusieurs versions', '', 'Le texte change d\'une lecture à l\'autre (test A/B ou nouvelle offre en cours de déploiement) : vérifier quelle version fait foi auprès de la firm.', '');
    md.push(byFirm(variants, (r) => `- ${r.url} (${(r as Extract<Result, { status: 'ok' }>).fp.values.length} versions)`));
  }
  if (added.length) md.push('', `### Nouvelles sources`, '', `${added.length} URL(s) ajoutée(s) au catalogue depuis le dernier relevé : \`pnpm prop-firms:watch --update\` les enregistre.`);
  if (unreachable.length) {
    md.push('', '### À relire dans un navigateur', '', 'Ces pages bloquent les requêtes automatiques : les vérifier à la main lors de la revérification mensuelle.', '');
    md.push(byFirm(unreachable, (r) => `- ${r.url} (${(r as Extract<Result, { status: 'unreachable' }>).reason})`));
  }
  return { markdown: md.join('\n') + '\n', attention: changed.length > 0 || stale.length > 0 };
}

async function main() {
  const { firms, urls } = loadCatalog();
  const previous: Snapshot = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : {};
  const entries = [...urls].sort(([a], [b]) => a.localeCompare(b));

  const results = await pool(entries, 6, async ([url, firmSet]): Promise<Result> => {
    const base = { url, firms: [...firmSet].sort() };
    try {
      return { ...base, status: 'ok', fp: await fingerprint(url) };
    } catch (e) {
      return { ...base, status: 'unreachable', reason: e instanceof Error ? e.message : String(e) };
    }
  });

  const { markdown, attention } = report(firms, results, previous);
  process.stdout.write(markdown);
  if (REPORT) writeFileSync(REPORT, markdown);
  if (GITHUB_OUTPUT && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `needs_attention=${attention}\n`);

  if (UPDATE) {
    // Les sources illisibles gardent leur dernière empreinte ; celles qui ont quitté le catalogue sont oubliées.
    const next: Snapshot = {};
    for (const r of results) {
      if (r.status === 'ok') {
        const before = previous[r.url];
        const keep = r.fp.kind === 'hash' && before?.kind === 'hash' ? before.values : [];
        next[r.url] = { kind: r.fp.kind, values: [...new Set([...r.fp.values, ...keep])].slice(0, MAX_VARIANTS), firms: r.firms };
      }
      else if (previous[r.url]) next[r.url] = { ...previous[r.url], firms: r.firms };
    }
    mkdirSync(dirname(SNAPSHOT), { recursive: true });
    writeFileSync(SNAPSHOT, JSON.stringify(next, null, 2) + '\n');
    console.error(`Relevé enregistré : ${Object.keys(next).length} source(s) dans ${SNAPSHOT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
