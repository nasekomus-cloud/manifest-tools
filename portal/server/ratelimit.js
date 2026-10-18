// Ограничение числа неудачных попыток входа: не больше `max` неудач за окно
// `windowMs` на ключ (почта, IP). Когда неудач набралось max, следующая попытка
// блокируется (blocked → true). Состояние в памяти: при перезапуске счётчики
// обнуляются — это допустимо.

const SWEEP_AT = 5000; // столько ключей в памяти — пора вычистить устаревшие

export function createLimiter({ max = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  /** @type {Map<string, number[]>} ключ → моменты неудач внутри окна */
  const hits = new Map();

  function fresh(key) {
    const list = hits.get(key);
    if (!list) return null;
    const from = now() - windowMs;
    const kept = list.filter((t) => t > from);
    if (kept.length === 0) { hits.delete(key); return null; }
    if (kept.length !== list.length) hits.set(key, kept);
    return kept;
  }

  return {
    /** Записывает неудачную попытку. */
    hit(key) {
      if (hits.size >= SWEEP_AT) for (const k of [...hits.keys()]) fresh(k);
      const list = fresh(key) ?? [];
      list.push(now());
      hits.set(key, list);
    },
    blocked(key) {
      return (fresh(key)?.length ?? 0) >= max;
    },
    reset(key) {
      hits.delete(key);
    },
    /** Снимает последнюю неудачу: попытку записали заранее, а она оказалась удачной. */
    forgive(key) {
      const list = fresh(key);
      if (!list) return;
      list.pop();
      if (list.length === 0) hits.delete(key);
    },
  };
}
