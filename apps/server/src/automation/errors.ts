/** Lançado por um job quando não há o que fazer (ex.: fonte indisponível). Registrado como "skipped", não como erro. */
export class SkipJob extends Error {}
