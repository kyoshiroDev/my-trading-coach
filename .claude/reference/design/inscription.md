# Inscription / connexion en deux colonnes

> Contenu déplacé à l'identique depuis `.claude/agents/design.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : design.md · Inscription / connexion en deux colonnes (`/register`, `/login`) · 2026-10-22 -->
> **Origine** : `design.md` · « Inscription / connexion en deux colonnes (`/register`, `/login`) » · 2026-10-22

### Inscription / connexion en deux colonnes (`/register`, `/login`)

Maquette : `maquettes/maquette-register-split.html`. Seuils : **< 1024 px** formulaire seul (aucune
colonne de présentation ; téléphone : carte en haut, logo au-dessus du titre, titres centrés ;
600–1023 px : carte centrée verticalement) · **1024–1279 px** deux colonnes compactes (titre 38 px,
aperçu 90 px de haut, marges réduites) · **≥ 1280 px** version complète (titre 50 px).
- Grille `1.1fr 1fr` : présentation à gauche (`--bg` + deux halos bleu/violet en `color-mix` et
  quadrillage `--border` estompé), formulaire à droite sur `--bg-2`, séparés par `1px --border`.
- Présentation : logo, pastille mono majuscules `--blue-bright` sur `--blue-glow` (point cyan), titre
  Space Grotesk 700 (« prop firm. » en `--blue-bright`), phrase `--text-2`, six points à coche
  `--blue-bright`, étiquette **PREMIUM** violette (`--purple-bright` sur `--purple-dim`), aperçu
  « Éval Apex 50K · En séance » (3 indicateurs mono, courbe drawdown rouge, limite en pointillé
  rouge, mention « Données de démonstration » `--text-faint`), pied mono « LECTURE SEULE · HÉBERGÉ EN
  FRANCE · SANS PUBLICITÉ ».
- Colonne de présentation : logo, contenu et pied dans une même colonne de **560 px au plus, centrée**
  dans la moitié gauche (texte aligné à gauche) ; marge basse 44 px pour que le pied reste au-dessus du
  badge « interne » (fixé à 8 px du bas). Vérifié à 1024, 1280, 1440, 1920 et 2560 px.
- Carte : `--bg-card`, radius 16, titres alignés à gauche à partir de 1024 px ; champs sur `--bg`,
  44 px, radius 10 ; bouton principal 48 px, `--primary` + texte blanc (5,2:1 ; `--text` y fait 4,3:1).
  Séparateurs à libellé mono 10 px `--text-faint` (« ou », « Pas encore sûr ? »). Ligne de confiance
  mono 9,5 px `--text-faint` / `--text-3` (≥ 5:1 sur `--bg-card`), un élément par ligne quand la
  carte est trop étroite.
- Champs autoremplis par le navigateur : règle globale de `styles.css` (fond repeint, texte `--text`).
  Un anneau de focus ou d'erreur se déclare dans **`--field-ring`** (`box-shadow: var(--field-ring)`),
  jamais en `box-shadow` seul : la règle globale le garde à côté de l'ombre qui masque le fond clair.
