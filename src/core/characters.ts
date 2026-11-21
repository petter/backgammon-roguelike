/**
 * Who a player appears as. Chosen in the lobby and shown next to their name; it changes
 * nothing about the rules.
 */
export const CHARACTERS = {
  gambler: { name: "The Gambler", motto: "Luck is a skill." },
  sentinel: { name: "The Sentinel", motto: "Nothing gets past." },
  seer: { name: "The Seer", motto: "Three moves ahead." },
  corsair: { name: "The Corsair", motto: "Take what is left open." },
} as const;

export type CharacterId = keyof typeof CHARACTERS;

export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

export const DEFAULT_CHARACTER: CharacterId = "gambler";

/** The character named by untrusted input, or the default if it names none. */
export function characterOf(raw: unknown): CharacterId {
  return typeof raw === "string" && Object.hasOwn(CHARACTERS, raw)
    ? (raw as CharacterId)
    : DEFAULT_CHARACTER;
}
