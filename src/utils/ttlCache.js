'use strict';

/**
 * Oddiy in-memory TTL kesh (bitta instansiya uchun).
 * Bir vaqtda kelgan bir xil so'rovlar bitta DB so'roviga birlashadi (in-flight dedupe).
 * TODO(5-bosqich): bir nechta instansiya bo'lsa REDIS_URL orqali umumiy keshga o'tkazish.
 */
function createTtlCache({ ttlMs, maxEntries = 200 }) {
  const store = new Map(); // key -> { value, expires }
  const inflight = new Map(); // key -> Promise

  async function wrap(key, loader) {
    if (!ttlMs) return loader();

    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);

    const p = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (store.size >= maxEntries) store.delete(store.keys().next().value);
        store.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, p);
    return p;
  }

  function clear() {
    store.clear();
  }

  return { wrap, clear };
}

module.exports = { createTtlCache };
