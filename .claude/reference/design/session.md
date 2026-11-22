# Pages de séance (Ma session, session live)

> Contenu déplacé à l'identique depuis `.claude/agents/design.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : design.md · Page « Ma session » — patterns réutilisables (session-day) · 2026-07-11 -->
> **Origine** : `design.md` · « Page « Ma session » — patterns réutilisables (session-day) » · 2026-07-11

### Page « Ma session » — patterns réutilisables (session-day)

La page `session` a un **header propre** (pas le `mtc-topbar` partagé). Source de vérité
des valeurs : `maquettes/new/src/session-mockup-source/` (fichiers `.jsx`/`.css` lisibles ;
le `.html` standalone n'est qu'une cible visuelle). Conteneur page : `padding: 16px 18px;
display:block; container-type:inline-size; flex:1; min-height:0; overflow-y:auto`
(espacement header/contenu via `margin-bottom:14px` sur `.mtc-sess-header`).

- **Conteneur page** : `.session-page` en `display:block` + `overflow-y:auto`. Ne **jamais** la
  repasser en `display:flex; flex-direction:column` : un conteneur flex-column **fige son
  `scrollHeight`** quand un enfant est plus haut que lui → le contenu déborde et est clippé au
  lieu de scroller (bug historique : bouton « Logger ce trade » inatteignable en laptop court).
  Les panneaux (`.qt-panel`, `.cal-card`, `.feed-col`…) se **dimensionnent à leur contenu**
  (jamais `flex:1 + overflow:hidden` pour « remplir la hauteur d'écran »).
- **Deux régimes de scroll selon la largeur** :
  - **Desktop `@container (min-width:981px)`** (header compact 1 ligne) : chaque onglet **tient
    dans l'écran**, plafonné à `max-height: calc(100vh - 103px)`, le trop-plein scrolle **à
    l'intérieur du composant** (pas d'allongement de page, header toujours visible). Cibles du
    plafond : Pré-session → les 2 colonnes `.daily-row` + `.eco-card` (liste `.eco-events` scrolle) ·
    Débrief → `.session-debrief`. **Session live v3 : pas de plafond**, la page scrolle et le bandeau
    reste collé en haut (`position: sticky`).
    Offset 103 = padding-top 16 + header 57 + margin 14 + padding-bottom 16 ; `.session-page`
    colle au haut du viewport donc `100vh` est la bonne référence (robuste aux écrans courts).
  - **Tablette/mobile `≤980px`** : **pas** de plafond → flow naturel + **scroll de page**
    (`.session-page`). Sur mobile la Pré-session repasse aussi les colonnes en `display:block;
    overflow:visible` (`@container (max-width:820px)`).
- Listes internes bornées **à partir de 821px** : `.feed-list`, `.cal-events-list` gardent `overflow-y:auto`
  borné par `max-height` sur le panneau parent (≈420px). **≤820px** (colonnes empilées) : plafond
  levé, la liste s'affiche en entier et c'est la page qui scrolle — jamais de scroll dans le scroll sur mobile.
  Session live : voir « Session live v3 » ci-dessous (media queries `min-width` 768 / 1100) ·
  `.ctx-grid` 4 col ≤1100 puis 2 col ≤680 · `.qt-pnl-row` 1 col ≤520.

- **Header** (grille `1fr auto 1fr`) : titre `Space Grotesk 21px/700 -.4px` + sous-titre
  `12.5px --text-3` (gauche) · segmented control (centre) · StartButton/SessionActivePill (droite).
- **Segmented control** (`.mtc-sess-tabs`) : `bg-2` + `border`, radius 11, padding 4 ; onglet
  `padding:8px 14px; radius:8; 12.5px`, actif = `bg-card` + `box-shadow:0 1px 3px rgba(0,0,0,.3)`
  + icône `--blue-bright`, inactif = transparent `--text-3`. Onglets : Pré-session=`Sunrise`,
  Session live=`Zap` (⚡), Débrief=`Moon`.
- **StartButton** : `green-dim`→`--green` au hover (texte `#06281c`, glow `0 0 22px rgba(16,185,129,.35)`),
  `Space Grotesk 14/700`, radius 11, border `rgba(16,185,129,.3)`.
- **SessionActivePill** : `linear-gradient(135deg, var(--green-dim), var(--bg-card))` + border
  `rgba(16,185,129,.3)`, point vert `mtc-blink 1.6s`, `SESSION ACTIVE` mono 10.5/600 `--green`,
  timer mono 16/700, compte mono 10 `--text-3`, bouton « Clôturer » (icône `moon`) neutre.
- **Cartes session** : `radius 14`, `padding 18` (banner `20`, contexte marché/live `14/16`).
  Banner Pré-session = `linear-gradient(135deg, var(--blue-glow), var(--bg-card))`. Titre de
  section = `Space Grotesk 13.5/600 --text` (pas de label mono uppercase pour ces titres).
- **MoodRow** : boutons transparents `1px --border`, sélection = border `--blue-bright` + fond
  `--blue-glow` + texte `--text` (jamais violet). Grille 2 col en fin de session, flex sinon.
- **Contexte marché** (live) : cellule `bg-2`, radius 10, valeur mono 15px, variation mono
  10.5/600 (vert/rouge), descripteur `--text-faint`, **sans barre d'accent**. Session live v3 :
  détail complet (8 tickers + news) dans la feuille « Contexte » ; le bandeau PC n'en garde que 4.
- **Anti-pattern** : ne jamais réintroduire un accent `::before` sur ces cellules/cartes, ni le
  violet sur la mood row de fin de session (bleu = sélection).
- `@keyframes mtc-blink { 0%,100%{opacity:1} 50%{opacity:.25} }` — pill session active.

<!-- Origine : design.md · Session live v3 (#593) — mobile d'abord · 2026-10-18 -->
> **Origine** : `design.md` · « Session live v3 (#593) — mobile d'abord » · 2026-10-18

### Session live v3 (#593) — mobile d'abord

Maquettes : `docs/mockups/mockup-session-live-v3-mobile.html` (390 px, référence première) et
`docs/mockups/mockup-session-live-v3.html` (PC). Base = mobile, paliers `@media (min-width: 768px)`
et `(min-width: 1100px)` ; **aucune `max-width`**, aucun scroll horizontal à 360 px.

- **Hiérarchie** : bandeau collant → bandeau « Mes comptes » (#668, à partir de 2 comptes suivis) →
  prochaine annonce → trade en cours → suivi du compte →
  trades clôturés → (mobile) Contexte marché + Clôturer la session en bas de page.
- **Couleurs** : vert = gains, rouge = pertes, **cyan = live / IA** (chrono, pastille, badge LIVE,
  analyse IA d'une annonce publiée), violet = chip de plan. Ligne d'annonce : **rouge si impact
  fort, ambre si impact moyen** (couleur = impact le plus fort du créneau) ; ambre aussi pour la jauge
  perte du jour. Plusieurs annonces à la même heure : **une seule ligne**, la plus importante en
  tête, chip « +N » qui déplie une liste compacte (point de couleur + nom + impact) ; publiées : « N
  PUBLIÉES », les autres dans le dépliage sur 2 niveaux (nom ; publié · prévu · précédent en gris),
  un seul « J'ai lu » sur la ligne du titre. **≥ 2 annonces fortes** : avant publication toutes
  nommées (« 2 ANNONCES FORTES »), « +N » pour les moyennes seulement ; publiées, un **onglet** par
  annonce forte (nom court, 44 px, une ligne qui glisse), la plus surprenante (écart publié / prévu)
  ouverte d'abord, point cyan sur une analyse pas encore lue ; une seule analyse visible à la fois. Chiffres publiés d'une annonce : neutres (au-dessus de la
  prévision n'est ni un gain ni une perte). Variations de marché du bandeau : vert / rouge.
- **Jauges** (libellé + valeur à droite, barre 8 px radius 99, sous-ligne 12 px `--text-2`) :
  perte max du jour = part **consommée**, neutre `--text-faint` < 50 %, ambre ≥ 50 %, rouge ≥ 75 %
  (seuils `drawdownTone`, comme « Mes comptes » — pas de seuil propre) ; marge plancher = gris
  ardoise `--text-faint` ; objectif = vert. Teaser Premium : même place, même hauteur (78 px),
  une ligne, bordure pointillée, badge violet.
- **Barre SL / entrée / TP** : piste `--bg-3` 10 px, segment perte `--red` 35 %, gain `--green` 28 %,
  trait d'entrée 2×20 px `--text`, pastille 18 px (rouge en perte, verte en gain). Libellés :
  montants sous les prix jusqu'à 1100 px, sur la même ligne au-delà.
- **Typo** : actif Space Grotesk 24 px (28 PC), latent JetBrains Mono 32 px (40 PC), libellés de
  carte JetBrains Mono 11 px `.08em` majuscules `--text-2`. Texte jamais < 12 px, cibles ≥ 44 px
  en mobile (≥ 40 px en PC). **Aucun emoji** dans la vue (humeur en texte seul).
- **Clôturer la session** : rouge discret (bordure rouge 45 %, fond rouge 8 %, texte rouge éclairci),
  bien séparé de « Clôturer ce trade » (neutre `--bg-3`).

## Bandeau « Mes comptes » (#668)

`mtc-live-accounts-strip`, sous la barre live, seulement avec au moins 2 comptes suivis (actifs avec une
marge) : une pastille par compte (nom + marge la plus serrée en %, mono tabulaire), du plus exposé au
moins exposé, couleur `drawdownTone` sur le pourcentage, bordure à la couleur pour le premier ; compte
de la séance en bordure pointillée. Rangée qui glisse horizontalement (son propre défilement, jamais
celui de la page). Un tap : feuille en bas sur mobile, boîte de 440 px à partir de 768 px (`mtcDialog`) :
perte max du jour, `ddLabels.margin`, objectif (« … $ pour l'objectif »), disclaimer « Estimation
MyTradingCoach, pas le calcul officiel de ta firm. » et « Relevé il y a … ». Vue en lecture : le compte de
la séance reste verrouillé (#880), la feuille le rappelle.

