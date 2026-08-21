/**
 * Title derivation for a new conversation.
 *
 * This file used to hold `demoReply` — canned assistant answers with fabricated sources
 * and a fake "scope approval is waiting" action. Nothing imported it any more (chat has
 * gone through the Brain for some time), and a dormant fake-answer generator sitting next
 * to the live chat provider is exactly the kind of thing that gets wired back in as a
 * convenient offline fallback. Removed so it cannot be.
 */

export function titleFromPrompt(prompt: string) {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  const words = clean.split(' ').slice(0, 6).join(' ')
  const title = words.length < clean.length ? `${words}…` : words
  return title.charAt(0).toUpperCase() + title.slice(1)
}
