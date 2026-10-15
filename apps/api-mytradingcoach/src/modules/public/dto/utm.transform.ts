// trim + minuscules, chaîne vide → absent ('' en base). Même règle que les UTM d'inscription
// (RegisterDto) : « NinjaTrader » et « ninjatrader » tombent dans la même ligne.
export const normalizeUtm = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() || undefined : value;
