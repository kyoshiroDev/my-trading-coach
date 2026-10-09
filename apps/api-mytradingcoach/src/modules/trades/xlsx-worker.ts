import { Worker } from 'node:worker_threads';
import { createLimiter } from '../../common/utils/concurrency.util';

/**
 * Lecture d'un classeur Excel HORS de la boucle d'événements (SCA-B5-05). `XLSX.read` décompresse
 * un zip de façon synchrone : un fichier piégé (bombe zip, feuille géante) bloquait tout le process
 * (toutes les requêtes du worker HTTP). Ici : un worker_thread à la demande, mémoire plafonnée,
 * tué au-delà de XLSX_TIMEOUT_MS ; un seul à la fois par process.
 */
export const XLSX_TIMEOUT_MS = 20_000;
const XLSX_MAX_HEAP_MB = 256;

// Source du worker, en ligne (eval) : l'API est livrée en un seul bundle webpack, sans fichier
// séparé à lancer. `xlsx` reste externe (node_modules, NODE_PATH) et se résout comme au démarrage.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const XLSX = require('xlsx');
try {
  const wb = XLSX.read(workerData.buffer, { type: 'buffer', sheetRows: workerData.sheetRows });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  parentPort.postMessage({ ok: true, csv: sheet ? XLSX.utils.sheet_to_csv(sheet).trim() : '' });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String((e && e.message) || e) });
}`;

const oneAtATime = createLimiter(1);

/**
 * Première feuille du classeur en CSV, sur `sheetRows` lignes au plus (en-tête comprise). Rejette
 * si le fichier est illisible, trop lourd en mémoire ou trop long à lire.
 */
export function xlsxToCsv(buffer: Buffer, sheetRows: number, timeoutMs = XLSX_TIMEOUT_MS): Promise<string> {
  return oneAtATime(
    () =>
      new Promise<string>((resolve, reject) => {
        const worker = new Worker(WORKER_SOURCE, {
          eval: true,
          workerData: { buffer, sheetRows },
          resourceLimits: { maxOldGenerationSizeMb: XLSX_MAX_HEAP_MB },
        });
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          void worker.terminate();
          fn();
        };
        const timer = setTimeout(
          () => finish(() => reject(new Error(`lecture Excel interrompue après ${timeoutMs / 1000} s`))),
          timeoutMs,
        );
        worker.once('message', (m: { ok: boolean; csv?: string; error?: string }) =>
          finish(() => (m.ok ? resolve(m.csv ?? '') : reject(new Error(m.error)))),
        );
        // Plafond mémoire atteint → ERR_WORKER_OUT_OF_MEMORY ; autre plantage du worker.
        worker.once('error', (err) => finish(() => reject(err)));
        worker.once('exit', (code) => finish(() => reject(new Error(`lecture Excel arrêtée (code ${code})`))));
      }),
  );
}
