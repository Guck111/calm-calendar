/** Counts changes of each setting. Answers to writes come back in any order: an earlier change that failed late
 *  can tell it was overtaken and must not roll back the newer one, and the first read can tell what the person
 *  already changed */
export const createChangeTracker = <K extends string>() => {
  const counts = new Map<K, number>();
  return {
    /** a change starts; the result tells later whether it is still the latest one of this setting */
    start(key: K): () => boolean {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return () => counts.get(key) === n;
    },
    /** the person hasn't changed this setting yet: a value read from disk may be shown */
    untouched(key: K): boolean {
      return !counts.has(key);
    },
  };
};
