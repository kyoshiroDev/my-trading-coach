une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature

---

Ticket #1270 (colonne « Idées features », projet n° 4) : Jauge de pression automatique en séance (remplace la saisie manuelle de l'émotion).

Périmètre fixé par le relecteur (tri du 2026-11-26) : étape 1 seule. Fonction pure `pressureGauge` qui agrège les détecteurs existants (`behavior-detectors`, `behavior-baseline`), rejeu étendu (`behavior-replay`) sur le banc local avec le seed, tests sur des scénarios construits, rapport dans `docs/audit-1270.md`. Rien d'affiché, aucune migration, aucun flag. Les décisions 1 à 3 du ticket ne bloquent pas l'étape 1. Limite à écrire en tête du rapport : le seed est synthétique et ne prouve rien sur le pouvoir prédictif ; la vraie validation demande l'historique réel (lecture prod), que seul Greg autorise.
