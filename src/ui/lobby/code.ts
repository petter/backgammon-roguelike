import { CODE_ALPHABET, CODE_LENGTH, normalizeCode } from "../../net/protocol.ts";

/**
 * What is left of typed or pasted text as a room code: upper-cased, only letters a code
 * can contain, at most a code's length. "kq-rtw" and " KQRTW " both give "KQRTW", and so
 * does a whole invite link, "https://example.com/g/kqrtw", pasted where the code goes.
 */
export function cleanCode(raw: string): string {
  const link = /\/g\/([A-Za-z]+)/.exec(raw);
  return normalizeCode(link?.[1] ?? raw)
    .split("")
    .filter((letter) => CODE_ALPHABET.includes(letter))
    .join("")
    .slice(0, CODE_LENGTH);
}
