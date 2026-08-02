/**
 * Whether a keyboard event is aimed at a text field the user is typing into.
 *
 * Window-level shortcuts (photo mode, throttle/brake, the live follow camera)
 * must not consume keystrokes meant for a search box or form input — 'p' and 'w'
 * are ordinary letters in a station name.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return element.isContentEditable === true;
}
