/**
 * Délai maximal des appels HTTP sortants (SCA-B3-04). Sans lui, un fournisseur qui ne répond plus
 * (Yahoo, FMP, Binance, Discord) faisait attendre la requête indéfiniment, avec sa connexion et sa
 * mémoire. Au-delà du délai : `AbortError` / `TimeoutError`, à traiter comme un échec du fournisseur.
 */
export const EXTERNAL_FETCH_TIMEOUT_MS = 5_000;

export function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = EXTERNAL_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(url, { ...init, signal });
}
