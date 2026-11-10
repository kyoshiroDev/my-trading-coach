La visite vidéo n'est pas présentable : à corriger avant tout commit de la section vidéo.
Deux branches séparées depuis dev : fix(app) pour l'app/la démo, puis on réenregistre.

## A. App et données de démo (fix(app):, enrichir le seed démo, cf. CLAUDE.md)
1. Dashboard : la carte « Coach IA · retours » n'apparaît plus (au moins en démo) → la grille
   .mtc-grid laisse une case vide. Trouve pourquoi. Bug → rétablis-la. Voulu → règles
   :last-child pour qu'aucune case ne reste vide en 3 et en 2 colonnes.
2. Séance du jour démo : elle doit être « vivante » quel que soit le jour où on ouvre la démo
   (dates relatives à maintenant, pas figées) : marché ouvert, 3–4 trades clôturés (mix gains /
   pertes), 1 trade ouvert depuis quelques minutes, débrief du jour rempli (P&L, win rate,
   meilleur trade, trade à revoir). Jamais « ouvert depuis 40 h » ni « marché fermé » en démo.
3. Calendrier éco démo : au moins un jour récent avec des annonces PUBLIÉES et leur analyse IA
   visible (ex. NFP du vendredi). Si l'analyse n'existe pas dans le seed, ajoute-la.
4. Vérifie l'affichage démo de chaque écran avec Playwright avant de passer à B.

## B. Réenregistrement (scripts dans ~/Bureau/videos-instagram/_scripts-visite-11/)
- Ordinateur : viewport 1440×900, DPR 2 (sortie 2880×1800 → encode 1920×1200). Plus d'espaces
  vides en bas d'écran.
- Mobile : inchangé (390×844, DPR 2, 720×1280).
- Statistiques : sélectionne le compte prop firm en évaluation avant l'écran, pour montrer
  drawdown max, marge avant plancher et objectif.
- Calendrier : va sur le jour passé avec annonces publiées + analyse IA.
- AUCUNE incrustation dans les exports « -landing » (ni titre, ni « Données fictives » : la
  légende de la landing la porte). Les exports « -titre » gardent titre + mention.
- Planche-contact une image / 2 s : zéro case vide, zéro grand vide en bas, zéro « - » dans
  la colonne IA, zéro « marché fermé ». Montre-la-moi.

## C. Landing
- Mets à jour public/demo/ et DemoVideo.astro (dimensions, aspect-ratio 1920/1200).
- Barre de navigation : le texte de la page se voit derrière les liens quand la section passe
  dessous → fond plus opaque (même valeur que dans l'app : rgba(8,12,20,.97) + blur).
- Section aussi sur /prop-firm après « Compatible avec », ancre #visite.
