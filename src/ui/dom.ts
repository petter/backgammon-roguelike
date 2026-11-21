/** The element with this id, checked to be of the expected type. */
export function el(id: string): HTMLElement;
export function el<T extends HTMLElement>(id: string, type: new () => T): T;
export function el(id: string, type: new () => HTMLElement = HTMLElement): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  if (!(found instanceof type)) throw new Error(`#${id} is not a ${type.name}`);
  return found;
}
