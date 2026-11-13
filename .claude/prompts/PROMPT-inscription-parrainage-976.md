traite le ticket #976 et fait relire a l'agent de relecture temps qu'il valide pas a 100% tu applique ses correction et lui renvoie une fois ok a 100% push et ouvre la PR vers dev

---

Contexte (ajouté par Claude) : ticket #976, suite de #970 / PR #971. Avec un lien de parrainage (`/register?ref=CODE`), l'encadré « 🎉 Invitation de CODE : 14 jours de Premium offerts » ajoute ~68 px et la page d'inscription défile de nouveau sur desktop (~1007 px pour 960 de haut). Critères du ticket : `document.scrollHeight` ≤ fenêtre avec `?ref=` de 960 à 1080 px de haut ; page sans `?ref=`, /login et mobile inchangés ; texte de l'encadré inchangé ; mention légale visible avant le clic Google ; captures avant/après sans donnée personnelle. Push et PR vers dev autorisés par Greg après validation à 100 % de l'agent relecteur.
