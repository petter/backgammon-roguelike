import "./privacy.css";

/**
 * The words of the privacy note on the start screen. Plain text only: set with `textContent`,
 * never parsed as HTML.
 */

export const PRIVACY_TITLE = "Privacy";

export const PRIVACY_INTRO: readonly string[] = [
  "We collect anonymous usage statistics with PostHog (hosted in the US) and Vercel Web Analytics to understand how the game is played and improve it (legitimate interest).",
  "There are no cookies, nothing is stored on your device for analytics, and IP addresses are not stored. Each visit is anonymous, so we cannot recognise you across visits.",
];

export interface PrivacyPoint {
  label: string;
  text: string;
}

export const PRIVACY_POINTS: readonly PrivacyPoint[] = [
  {
    label: "What is recorded:",
    text: "pages visited, which menu option you choose, whether you join by code or invite link, matchmaking wait time, characters and cards picked or played, game results, and that chat was used.",
  },
  {
    label: "Never recorded for analytics:",
    text: "your name, chat messages, or game codes.",
  },
  {
    label: "On your device:",
    text: "your name, chosen character and settings stay in your browser's storage. In an online game, your name and character are shown to your opponent.",
  },
  {
    label: "On the game server:",
    text: "online games and their chat pass through our server to run the match. Rooms and their chat (up to the last 50 messages) expire automatically 24 hours after their last activity.",
  },
];

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

/**
 * A short, plain-language privacy note in a lobby plaque. Built once; the lobby shows and
 * hides it like its other views.
 */
export function privacyPage(onBack: () => void): {
  element: HTMLElement;
  back: HTMLElement;
} {
  const page = node("article", "plaque privacy");
  page.setAttribute("aria-labelledby", "privacy-title");
  const back = node("button", "link back", "‹ Back");
  back.type = "button";
  const header = node("header");
  const title = node("h2", "lobby-heading", PRIVACY_TITLE);
  title.id = "privacy-title";
  header.append(title);

  const list = node("ul", "privacy-points");
  for (const point of PRIVACY_POINTS) {
    const item = node("li");
    item.append(node("strong", "", `${point.label} `), point.text);
    list.append(item);
  }

  page.append(back, header, ...PRIVACY_INTRO.map((line) => node("p", "", line)), list);
  back.addEventListener("click", onBack);
  return { element: page, back };
}
