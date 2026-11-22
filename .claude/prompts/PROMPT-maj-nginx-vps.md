j'ai lu sur internet que nginx avait une grosse faille de securité je veut que tu verifie ms deux vps et qe tu fassent la maintenance complete dessus et les mise a jours necessaire tu a carte blanche pour cette fois afin que tous soit a jours fonctionnel et surtout securiser

---

## Compléments (session)

- Faille : « nginx2root », bulletin F5 du 18/11/2026 (CVE-2026-123007 HTTP/2 et 9 autres), corrigée en nginx 1.31.9 (mainline) / 1.30.7 (stable).
- Carte blanche « pour cette fois » : commandes docker lancées par la session sur les 2 VPS ; les commandes root (apt, reboot) restent tapées par Greg (sudo demande son mot de passe).
- Fait le 22/11 : ancien VPS (nginx:alpine → 1.31.9, traefik:v2.11 → 2.11.63, conteneurs recréés) ; VPS prod (nginx 1.31.7 → 1.31.9-alpine, traefik v3.7.14 → v3.7.19, compose sauvegardés en .bak-20261122-1150). Ce dépôt reporte les versions de la prod (`infra/prod/`).
