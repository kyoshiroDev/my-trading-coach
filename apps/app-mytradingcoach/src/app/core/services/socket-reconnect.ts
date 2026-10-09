import type { ManagerOptions } from 'socket.io-client';

/**
 * Reconnexion des sockets du front (SCA-B4-07). Après un redémarrage de l'API, tous les onglets
 * ouverts perdaient leur socket au même instant et revenaient ensemble (1 s, 2 s, 4 s…) : une
 * tempête de connexions. socket.io-client : délai = reconnectionDelay × 2^essai, ± le facteur
 * aléatoire, plafonné. Ici : 1er essai entre 1 et 9 s, puis ~10 s, ~20 s, ~40 s, jamais plus de 60 s.
 */
export const SOCKET_RECONNECT_OPTIONS: Pick<
  ManagerOptions,
  'reconnectionDelay' | 'reconnectionDelayMax' | 'randomizationFactor'
> = {
  reconnectionDelay: 5_000,
  randomizationFactor: 0.8,
  reconnectionDelayMax: 60_000,
};
