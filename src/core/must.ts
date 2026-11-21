/** A value the caller knows is there, such as an element at an index in range. Throws if not. */
export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Missing ${what}`);
  return value;
}
