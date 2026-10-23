/**
 * Libellé lisible d'un appareil (« Chrome · Android », « Safari · iPhone »), déduit du User-Agent
 * envoyé à l'abonnement. Fonction PURE. Sert seulement à reconnaître l'appareil dans la liste du
 * profil : une erreur de détection ne change rien à l'envoi.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const system =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  // Ordre important : Edge, Opera et Samsung Internet se déclarent aussi « Chrome », Chrome se
  // déclare aussi « Safari ».
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null;
  if (browser && system) return `${browser} · ${system}`;
  return browser ?? system ?? 'Appareil inconnu';
}
