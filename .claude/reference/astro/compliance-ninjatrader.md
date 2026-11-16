# Conformité NinjaTrader Ecosystem (PROMPT-201)

> Contenu déplacé à l'identique depuis `.claude/agents/astro.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : astro.md · Compliance NinjaTrader Ecosystem (PROMPT-201) · 2026-09-03 -->
> **Origine** : `astro.md` · « Compliance NinjaTrader Ecosystem (PROMPT-201) » · 2026-09-03

## Compliance NinjaTrader Ecosystem (PROMPT-201)

MyTradingCoach est référencé dans l'écosystème NinjaTrader, ce qui impose 4 avertissements
au texte **non modifiable** (source : `Ninja Trader/3. Disclaimers_VF.docx`, hors dépôt) :

| Avertissement | Où |
|---|---|
| Risques · Performances hypothétiques · Live Trade Room · Témoignages | `src/pages/disclaimer.astro`, section 7 |

Règles :
- **Ne jamais paraphraser, résumer ni tronquer** ces 4 textes — ce sont des mentions réglementaires
  imposées. Toute retouche doit repartir de la `.docx`.
- Le `footer` doit conserver les mentions clés (risque de perte, performances passées,
  résultats hypothétiques) + le lien vers `/disclaimer`.

### Wordmark NinjaTrader

- Assets : `public/ninjatrader/` — wordmark `NinjaTrader_Wordmark_color_RGB.png` (2376×300, `#FF4200`
  sur transparent) + 5 bannières publicitaires (`ninjatrader-banner-*.png`).
- **Bloc de confiance sur `/` et `/prop-firm` (demande NinjaTrader du 21/10/2026, revue Compliance
  de la newsletter)** : leur équipe ne trouvait pas le logo, seul au footer. Composant
  `NinjaTraderTrust.astro` : tout le bloc est le lien affilié (`NINJATRADER_AFFILIATE_URL`,
  `target="_blank"`, `rel="noopener sponsored nofollow"`), texte « Référencé dans l'écosystème » +
  wordmark tel quel (26 px, 22 px < 768 px) + « Lien affilié ». Emplacements : home, `.hero-eco` juste
  sous la ligne `.hero-trust` (premier écran à 1440×900, y ≈ 750) ; /prop-firm, `.pf-hero-side` sous la
  carte d'exemple (premier écran à 1440×900, y ≈ 630 ; juste après en mobile). Formulation imposée :
  « Référencé dans l'écosystème NinjaTrader », **jamais** « partenaire », « officiel », « approuvé »
  ni « recommandé par NinjaTrader », **aucun autre nom de courtier** dans ou à côté du bloc. Ce sont
  les **seuls** emplacements autorisés hors footer ; le wordmark reste aussi au footer.
- Affiché dans `Footer.astro` (`.footer-eco`) : **ligne dédiée centrée** sous la barre légale,
  hauteur **18 px** (`width:auto`, `aspect-ratio:2376/300` pour zéro CLS, `object-fit:contain`).
  **Ne pas recolorer, déformer ni rogner** — le seul levier de discrétion est la taille : le
  orange `#FF4200` domine tout le footer dès qu'on dépasse ~20 px, et doit rester secondaire
  devant la marque « MyTradingCoach » (22 px).
- Les bannières ne sont **pas utilisées** : ce sont des créatives publicitaires avec CTA « Learn More »,
  elles supposent un lien d'affiliation actif.
- Le wordmark est un **lien d'affiliation** (PROMPT-204) : `NINJATRADER_AFFILIATE_URL` dans
  `src/config.ts` (partagé par `Footer.astro` et `NinjaTraderTrust.astro`), `rel="noopener sponsored
  nofollow"` + `target="_blank"`. URL = **lien d'affiliation
  unique** fourni par NinjaTrader, `https://ninjatraderdomesticvendor.sjv.io/DWZgnd` (remplace depuis le
  2026-10-20 l'ancien `…/c/7724604/3069488/37581`, demande NinjaTrader avant la revue Compliance de la
  newsletter). Il porte le tracking vendeur : ne jamais le modifier ni en utiliser un autre.
- **Lien affilié = divulgation obligatoire**, aux deux endroits : mention « Lien affilié » à côté de
  chaque logo (footer et bloc de confiance) *et* paragraphe « Divulgation d'affiliation » en section 7
  de `disclaimer.astro` (qui cite le footer et le bloc de / et /prop-firm). Ne jamais
  retirer l'un sans l'autre, ni le lien sans les deux.
- **Plateforme uniquement, jamais le courtage** (Affiliate Success Playbook NinjaTrader) : l'affiliation
  porte sur l'inscription à la **plateforme** NinjaTrader. Jamais « ouvrir un compte » (de courtage),
  frais de courtage, commissions de trading ni marges en lien avec NinjaTrader (corrigé le 2026-10-19
  dans la divulgation d'affiliation de `disclaimer.astro`).

### Annonce de la synchro Tradovate (PROMPT-211)

- `Features.astro` (carte 02 « Synchro Tradovate & import CSV ») et `FAQ.astro` (« Puis-je importer
  mon historique ? ») présentent la **connexion Tradovate** comme voie principale, en lecture seule.
  **Depuis l'import d'historique par la Reporting API, tout l'historique remonte à la connexion**
  (`launchFullImport`, cf. nestjs.md « toute la vie du compte ») puis les trades + frais arrivent en
  direct. L'ancienne règle « le passé s'importe à part en CSV » est périmée (corrigée le 2026-10-06).
  L'import CSV couvre aussi les autres brokers, **mais pas tous en gratuit** : formats reconnus d'office
  (Tradovate, Binance, Bybit, MT4/5, IBKR, MEXC) = Gratuit ; tout autre broker passe par l'import IA =
  **Premium** (cf. plans.md). Jamais « import CSV universel » ni « tout broker » sur le Gratuit (#507) :
  Pricing (Gratuit + ligne Premium « Import IA »), Compare (« brokers reconnus » / « + import IA »), FAQ,
  Features, `/prop-firm` et `/journal-trading-prop-firm` disent la même chose.
- **Formulation factuelle uniquement (clause 17)** : jamais « Partenaire officiel de NinjaTrader »,
  « Recommandé / Approuvé par NinjaTrader » ni aucune caution. Le logo NinjaTrader n'apparaît
  qu'au footer et dans le bloc `NinjaTraderTrust` de `/` et `/prop-firm` (21/10). Aucune promesse de gain (AMF) : on décrit ce que fait la synchro, pas un résultat.
- `Compare.astro` **inchangé volontairement** : TraderSync et TradesViz proposent une synchro
  broker ; une ligne « Synchro broker directe » les montrerait à tort sans (cf. règle ci-dessous).
