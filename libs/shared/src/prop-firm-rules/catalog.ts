/**
 * Fichiers du catalogue des règles prop firm, tels quels (un par firm, cf. README.md).
 *
 * Typés `unknown` à dessein : le JSON est validé par `pnpm prop-firms:validate` (ajv, en CI)
 * et revalidé par Zod côté API avant d'aller en base. Le typer ici en le castant donnerait une
 * fausse garantie, et `@mtc/shared` n'embarque aucune lib de validation.
 *
 * Ajouter une firm = ajouter son fichier ici, puis redéployer l'API (synchro au démarrage).
 */
import apex from './apex.json';
import blusky from './blusky.json';
import earn2trade from './earn2trade.json';
import fundedfuturesfamily from './fundedfuturesfamily.json';
import lucid from './lucid.json';
import myfundedfutures from './myfundedfutures.json';
import oneuptrader from './oneuptrader.json';
import phidias from './phidias.json';
import takeprofittrader from './takeprofittrader.json';
import toponefutures from './toponefutures.json';
import topstep from './topstep.json';
import tradeday from './tradeday.json';
import tradeify from './tradeify.json';
import uprofit from './uprofit.json';

export const PROP_FIRM_CATALOG_FILES: readonly unknown[] = [lucid, apex, topstep, tradeify, myfundedfutures, tradeday, takeprofittrader, phidias, earn2trade, toponefutures, blusky, fundedfuturesfamily, oneuptrader, uprofit];
