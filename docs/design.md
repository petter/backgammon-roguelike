# Design notes

How screens in this game should look and behave, and how to check that they do. Learned
while redesigning the start screen (`src/ui/lobby/`), which went through ten rounds of
review by three models against screenshots. Read this before building or changing any
screen that sits outside the board: menus, overlays, dialogs, the result screen.

## The look: one material language

The board, the cards and the result screen set the standard. Everything else has to look
like it belongs on the same table.

- **Type.** Cinzel in tracked capitals for headings, labels and buttons; an old-style serif
  (Iowan Old Style, Palatino, Georgia) in italic for ledes, hints and mottos. No system-ui
  on a screen meant to be looked at. No monospace, not even for a URL.
- **Materials.** Walnut plaques (dark wood gradient plus `--grain`) with a fine gold inlay
  (an inset ring in `--metal`). Gold metal (`--metal-light`, `--metal`, `--metal-dark`) for
  the title and the primary action. Ivory, like the checkers, for things the player is
  handed: a room code shown to them, a letter they typed.
- **Meaning in materials.** Keep each material for one meaning and use it everywhere:
  - ivory tile: a settled code, or a letter you placed;
  - dark recessed well: something to fill in;
  - sunk, dimmed tile: a code that leads nowhere;
  - gold plate: the one action this view is for.
- **One gold action per view.** Everything else is a plain plaque, an outlined button or a
  quiet text link. Two glowing buttons is a bug.
- **The board stays behind.** Menus sit over the live 3D board, blurred and dimmed by a
  scrim, never over a flat colour. Give it the opening checkers so it reads as a table
  waiting for players. On tall screens crop the board to fill the height (`setBackdrop` in
  `src/render/stage.ts`) instead of letting it shrink to a band in a black field.
- **Legibility over the board.** Text that sits on the board needs a pool of shadow behind
  it: a radial scrim behind the title, a text shadow on the tagline. Check it where the
  title lands on checkers and on the cream points, not only on the felt.
- **Tokens, not literals.** Colours live as custom properties on the screen's root
  (`#lobby`). Reuse them; add a token before adding a one-off hex.

## Behaviour: what made the start screen work

- **Ask what the player wants before asking for anything.** The old screen put a name field
  above "Start a game", so joiners started games. A menu of choices first, each opening a
  short form of its own, removes the trap: a joiner never stands next to a host button.
- **Say what each choice does, in the player's words.** "Join a friend / I have a game
  code" beats "Join". A subtitle on every choice.
- **The shared link is the main entrance.** Someone opening `/g/CODE` skips the menu and
  lands on one form with one button ("Take your seat"). Check the room as they arrive, so a
  dead or full link says so before they fill anything in.
- **Be truthful in copy.** If a blank name becomes "Guest" on the server, the field says
  "Leave blank to play as Guest". If the emblem changes nothing, say "just for looks".
  Placeholders must not look like typed values.
- **Errors sit next to what is wrong.** A bad code turns the code tiles red with the reason
  right under them, not at the bottom of the form. Then make the fix easy: typing over the
  rejected code starts a new one, and Join will not resend the same code until it changes.
- **Every dead end has a way on.** Expired invite, full table, wrong code: each says what
  happened and puts the likeliest next step on the primary button.
- **Touch and mouse are different.** On phones never focus a field whose keyboard would
  cover the button; drop the keyboard once a code is complete; use the share sheet. With a
  mouse, copy to the clipboard and focus the first field.
- **Accept what people paste.** A whole invite link pasted into the code field should
  yield the code.
- **Don't move what the player is looking at.** Views that share a layout share an anchor
  (forms are pinned to one top position and grow downward), so an error line appearing does
  not shift the code row. Moves between views glide with a view transition rather than
  jumping.

## Layout rules

- Design from 360×740 up to 1920×1080. Check a 360 phone, a 390 phone, an 820 tablet, a
  1280×800 laptop and a 1920×1080 desktop. Phones are not an afterthought: the lower half of
  a portrait screen must not be an empty black field.
- No horizontal overflow at 360. Long button labels and tile rows are the usual culprits.
- Wide screens get wider forms (two columns for name and emblem), not just bigger margins.
- Keep tap targets at least 44px, labels at 12–14px or more, body copy at 15–16px.
- Respect `prefers-reduced-motion` for every animation and transition.

## Process: how to get there

- **Look at it.** Take screenshots of every state (first visit, invite link, each form,
  waiting, each error) at all five sizes, plus contact sheets that put the sizes side by
  side. Most of the real problems (an overflowing tile row, a label wrapping to an orphan,
  a void under a form, the board shrinking to a strip) only show up in pictures.
- **Re-shoot everything after a change.** A partial re-shoot left stale screenshots once,
  and the reviewers rightly flagged a bug that was already fixed.
- **Try several directions before polishing one.** Three different layouts, judged side by
  side, found a structure (choice first, then a form) that iterating on one layout would not
  have reached.
- **Use independent reviewers, and keep score.** Ask for a design score and a UX score with
  reasons, and for concrete issues tied to a state and a size. Don't tell them the target.
- **Hold the line on scope and on settled decisions.** Reviewers drift: they ask for new
  features, and sometimes reverse each other between rounds (tiles too wide, then too much
  empty space). Fix bugs and real problems at once; when two reviewers disagree, follow the
  majority; when one keeps re-asking for something the others endorse keeping (here: making
  Join and Host equal on the menu), say no and move on.
- **Verify behaviour in a real browser**, not only in screenshots: no double submit, paste
  handling, invite checks.
