/**
 * Réponse d'API avant sa sérialisation JSON (#1156). Les contrats donnent les dates en `string` ISO
 * (ce que le front reçoit) ; l'API, elle, renvoie les `Date` de Prisma, que JSON convertit en ISO.
 * `WithDates<C>` accepte une `Date` partout où le contrat `C` attend une chaîne libre (`string`,
 * pas une union littérale comme `'month' | 'year'`) : `return {…} satisfies WithDates<C>` vérifie
 * au typecheck de l'API qu'aucun champ du contrat n'est retiré, renommé ou d'un autre type.
 */
export type WithDates<T> = T extends unknown
  ? string extends T
    ? T | Date
    : T extends readonly (infer U)[]
      ? WithDates<U>[]
      : T extends object
        ? { [K in keyof T]: WithDates<T[K]> }
        : T
  : never;
