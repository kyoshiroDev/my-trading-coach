-- Faux événements du seed démo injectés chaque nuit dans le calendrier PARTAGÉ (EcoEvent n'a pas
-- de userId) : « CPI US » fantôme, « Balance courante » en double, etc. Le seed ne les écrit plus
-- qu'en l'absence de FMP. Reconnaissables sans ambiguïté : FMP fournit toujours un `name` anglais,
-- le seed écrivait le libellé français dans `name` ET `nameFr`. Purement des données de démo.
DELETE FROM "EcoEvent"
WHERE "name" = "nameFr"
  AND ("name", "currency") IN (
    ('Balance courante', 'JPY'),
    ('PMI manufacturier', 'EUR'),
    ('Inflation CPI (US)', 'USD'),
    ('Discours BCE', 'EUR')
  );
