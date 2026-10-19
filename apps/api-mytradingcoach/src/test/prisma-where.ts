/**
 * Évaluateur EN MÉMOIRE d'un `where` Prisma, limité aux opérateurs des segments de campagnes
 * (AND / OR / NOT, égalité, null, gte / lte / not / in / notIn, relations none / some / is).
 * Sert aux tests qui font tourner les vraies règles de ciblage sur des utilisateurs fictifs.
 */
type Row = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);

const comparable = (v: unknown) => (v instanceof Date ? v.getTime() : v);

function matchField(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (!isPlainObject(cond)) return comparable(value) === comparable(cond);

  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case 'none':
        if (!(value as Row[]).every((item) => !matchWhere(item, arg as Row))) return false;
        break;
      case 'some':
        if (!(value as Row[]).some((item) => matchWhere(item, arg as Row))) return false;
        break;
      case 'is':
        if (arg === null ? value != null : value == null || !matchWhere(value as Row, arg as Row)) return false;
        break;
      case 'gte':
        if (value == null || (comparable(value) as number) < (comparable(arg) as number)) return false;
        break;
      case 'lte':
        if (value == null || (comparable(value) as number) > (comparable(arg) as number)) return false;
        break;
      case 'not':
        if (matchField(value, arg)) return false;
        break;
      case 'in':
        if (!(arg as unknown[]).includes(value)) return false;
        break;
      case 'notIn':
        // Comme SQL (NOT IN) : une valeur NULL ne passe pas.
        if (value == null || (arg as unknown[]).includes(value)) return false;
        break;
      default:
        throw new Error(`Opérateur non géré par l'évaluateur de test : ${op}`);
    }
  }
  return true;
}

export function matchWhere(row: Row, where: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      const all = Array.isArray(cond) ? cond : [cond];
      if (!all.every((w) => matchWhere(row, w as Row))) return false;
    } else if (key === 'OR') {
      if (!(cond as Row[]).some((w) => matchWhere(row, w))) return false;
    } else if (key === 'NOT') {
      const all = Array.isArray(cond) ? cond : [cond];
      if (all.some((w) => matchWhere(row, w as Row))) return false;
    } else if (!matchField(row[key], cond)) {
      return false;
    }
  }
  return true;
}
