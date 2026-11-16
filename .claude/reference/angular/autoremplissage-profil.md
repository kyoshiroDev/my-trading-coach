# Autoremplissage navigateur et Profil

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Autoremplissage navigateur (2026-10-18) · 2026-10-18 -->
> **Origine** : `angular.md` · « Autoremplissage navigateur (2026-10-18) » · 2026-10-18

## Autoremplissage navigateur (2026-10-18)

- Règle globale dans **`src/styles.css`** (`input/textarea/select:-webkit-autofill`) : ombre interne
  `var(--autofill-bg, var(--bg-2))`, `-webkit-text-fill-color: var(--text)`, `background-clip:
  padding-box !important` (sinon le fond clair imposé passe sous la bordure semi-transparente : le
  raccourci `background:` des champs de composant remet `border-box`). Champ sur un autre fond →
  poser `--autofill-bg`.
- `box-shadow` et `transition` en **`!important`** (2026-10-24) : `input:focus { box-shadow }` d'un composant
  a la même spécificité et passe après la feuille globale ; au focus il effaçait l'ombre, le fond clair
  de Chrome revenait sous un texte clair (contraste 1,06:1, texte invisible). Anneau du composant →
  `--field-ring` (`auth-form.css`, `card-page*.css`), ajouté par la règle globale après l'ombre.
- Connexion : `autocomplete="username"` sur l'email + `current-password` ; inscription : `email` +
  `new-password` (×2). Le navigateur ne livre la valeur autoremplie au JS qu'après un geste de
  l'utilisateur : un `blur()` programmé sur un champ autorempli affiche « requis ».
- ⚠️ `src/styles/global.css` n'est **importé nulle part** (seul `styles/theme.css` l'est) : une
  règle globale va dans `styles.css`, pas là.

<!-- Origine : angular.md · Profil : e-mail en lecture seule (#1020, 2026-11-15) · 2026-11-15 -->
> **Origine** : `angular.md` · « Profil : e-mail en lecture seule (#1020, 2026-11-15) » · 2026-11-15

## Profil : e-mail en lecture seule (#1020, 2026-11-15)

L'e-mail du Profil s'affiche sans bouton « Modifier ». Avant, il envoyait `{ email }` à `PATCH /users/me`,
dont le DTO API n'accepte que `name` (`forbidNonWhitelisted` → 400 à chaque essai). `UpdateMeDto` du front
= `name` seul, comme l'API. Changer d'adresse = fonctionnalité à part (lien de confirmation sur la
nouvelle adresse, `emailTransform` / `emailEquals` côté API, 409 si l'adresse est prise), pas un champ
à remettre ici. Test : `profile-email-lecture-seule.spec.ts`.
