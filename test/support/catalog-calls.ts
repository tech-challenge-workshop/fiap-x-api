/**
 * Spies on every method of a Catalog client instance and returns a function
 * giving the total number of calls made through it.
 */
export function countCatalogCalls(client: object): () => number {
  const prototype = Object.getPrototypeOf(client) as Record<string, unknown>;
  const spies = Object.getOwnPropertyNames(prototype)
    .filter(
      (name) => name !== 'constructor' && typeof prototype[name] === 'function',
    )
    .map((name) => jest.spyOn(client as Record<string, () => unknown>, name));
  return () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
}
