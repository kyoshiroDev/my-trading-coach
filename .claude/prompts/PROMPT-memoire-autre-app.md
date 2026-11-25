fait en sorte que l'autre app puissent avoir 4Go de memoire disponible pour elle

Contexte (ajouté par la session) : VPS prod partagé avec un autre projet hébergé (#1273). Greg : « sur le vps de prod MTC prend combien de giga de memoire car l'autre app a besoin de 4 GO », puis « j'ai 9Go de memoire disponible pour une autre app ». Relevé du 2026-11-25 18:06 : RAM 11 671 Mio, swap 4 Gio, utilisé 2 282 Mio, disponible 9 388 Mio ; conteneurs MTC ~0,75 Gio utilisés pour ~4,75 Gio de plafonds (~6,25 Gio pendant la bascule blue/green) ; build de l'image API sur le serveur sans plafond.
