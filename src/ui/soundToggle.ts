import { isMuted, onMuteChange, setMuted } from "../audio/engine.ts";

const SPEAKER = '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none"/>';
const WAVES = '<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>';
const CROSS = '<path d="M16 9.5l5 5M21 9.5l-5 5"/>';

function icon(muted: boolean): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" aria-hidden="true">${SPEAKER}${muted ? CROSS : WAVES}</svg>`;
}

/**
 * The sound on/off button, and the M key that does the same from anywhere a letter is not
 * being typed. The choice is remembered for the next visit.
 */
export function createSoundToggle(button: HTMLButtonElement): void {
  const show = (muted: boolean) => {
    button.innerHTML = `${icon(muted)}<kbd>M</kbd>`;
    button.setAttribute("aria-pressed", String(muted));
    const label = muted ? "Sound off" : "Sound on";
    button.setAttribute("aria-label", `${label} (M)`);
    button.title = `${label} (M)`;
  };
  show(isMuted());
  onMuteChange(show);
  button.addEventListener("click", () => setMuted(!isMuted()));
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.code !== "KeyM" || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    setMuted(!isMuted());
  });
}
