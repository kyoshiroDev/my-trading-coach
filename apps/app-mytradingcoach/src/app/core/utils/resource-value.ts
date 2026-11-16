/**
 * Valeur d'une resource, ou `undefined` si elle n'en a pas (chargement, erreur).
 *
 * En Angular 22, `resource.value()` LÈVE `ResourceValueError` quand la requête a échoué : un
 * `computed` qui la lit sans `hasValue()` fait planter le rendu (F1 #1047). À utiliser dans tout
 * `computed` dérivé d'une resource dont l'erreur est affichée à part (`loadError`).
 */
export function resourceValue<T>(res: { hasValue(): boolean; value(): T }): T | undefined {
  return res.hasValue() ? res.value() : undefined;
}
