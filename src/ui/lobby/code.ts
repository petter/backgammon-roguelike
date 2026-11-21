import { CODE_ALPHABET, CODE_LENGTH, normalizeCode } from "../../net/protocol.ts";

/**
 * What is left of typed or pasted text as a room code: upper-cased, only letters a code
 * can contain, at most a code's length. "kq-rtw" and " KQRTW " both give "KQRTW".
 */
export function cleanCode(raw: string): string {
  return normalizeCode(raw)
    .split("")
    .filter((letter) => CODE_ALPHABET.includes(letter))
    .join("")
    .slice(0, CODE_LENGTH);
}
