# Attachment behaviour — intended model

Written after the attachment BACKEND passed and the attachment EXPERIENCE did not. Verified
against `chat.migrateck.com` (release `1fedb65`), not inferred.

## What actually happens today

| # | Behaviour | Verified |
|---|---|---|
| 1 | Upload goes to the user's **global Files library**, not to the conversation | `/api/files` is user-scoped |
| 2 | The chip **disappears on send** — nothing visibly ties the file to the conversation afterwards | `clear()` in Composer |
| 3 | Grounding is a per-conversation flag in **client memory** (`useRef`), never persisted | `ChatProvider:173` |
| 4 | Within one page session, follow-ups ground correctly **without reattaching** | ✅ live: "What is the backupPhrase?" → KREYOL STAR 918, cited |
| 5 | **After a reload, grounding is silently lost** | 🚨 live: "What is the documentTitle?" → *"I don't have access to external documents or prior conversation history"* |
| 6 | Every question in a grounded conversation grounds, related or not | the flag is per conversation, not per question |
| 7 | Removing the chip **deletes the file from the library**; after send there is no chip, so no way to detach | `remove()` calls DELETE |

## What is wrong with it

**A. Reload changes the answer.** The same question, in the same conversation, answers from
the file before a reload and refuses after it. Nothing tells the user why. This is the
sharpest defect and it is invisible until someone refreshes.

**B. The claim in that refusal is also wrong.** It says it has no access to prior
conversation history while two earlier turns are on screen. Either history is not being
supplied on that path, or the model is inventing a reason — both need tracing.

**C. Nothing shows which file a conversation is using.** After send there is no chip, no
badge, no list. The user cannot tell whether the next answer will use the file.

**D. "Attach" and "upload to library" are conflated.** The paperclip reads as *attach to this
message*; it actually means *add to my library and ground this conversation*. Deleting the
chip deletes the file everywhere, which is not what "remove attachment" implies.

**E. Unrelated questions ground silently.** Once grounded, a question about something else is
still forced to answer from documents or refuse.

## Proposed intended model

1. **A conversation has an explicit, visible set of grounding files.** Shown in the thread,
   not only in the composer, and it survives reload because it is stored where the
   conversation is stored — not in a React ref.
2. **Attaching adds the file to the library AND to that conversation's set.** Two effects,
   both stated.
3. **Removing from a conversation is not deleting from the library.** Separate actions,
   separate wording. Deletion stays on the Files page.
4. **Grounding is per conversation and persists** across reload, new tabs, and returning days
   later. If it cannot persist yet, the UI must say the conversation is grounded only for
   this session — an honest limit beats a silent one.
5. **A new conversation starts ungrounded** unless the user attaches or arrives from Files.
6. **A non-searchable file is never in the grounding set.** It is stored and visible, and the
   conversation says it cannot be used.
7. **Consistency is the acceptance bar**: the same sequence, run in several conversations,
   produces the same behaviour.

## The open decision

Item 5 in the current build is fine, but items 1-4 fork on one question: **is an attachment
scoped to the conversation, or is it a library upload that a conversation happens to use?**
The answer decides whether grounding state belongs on the conversation record in the Brain,
or whether the consumer keeps its own per-conversation set. Everything else follows from it.
