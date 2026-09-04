/**
 * The sentences a blocked user reads. One place, so wording is reviewed once.
 *
 * Each says three things on purpose: what is happening, that the request has NOT
 * started, and that nothing was lost. "Please wait" is deliberately absent — it
 * would imply progress that is not occurring.
 *
 * © MigraTeck LLC.
 */

export const BUSY_MESSAGE =
  'The AI vision engine is busy with another task on the graphics card, so your request has not '
  + 'started yet. Nothing was lost — send it again in a moment and it will run.';

/**
 * The card would not produce a token in time, and NO competing render was confirmed.
 *
 * 🚨 SEPARATE FROM {@link BUSY_MESSAGE} BECAUSE IT CLAIMS LESS. That one asserts
 * another task holds the graphics card. When ComfyUI is unreachable — which is also
 * what a stopped ComfyUI looks like — we have no such evidence, only that a token
 * did not arrive in time. Saying "busy with another task" there sends someone
 * hunting for a workload that may not exist; observed doing exactly that.
 */
export const UNRESPONSIVE_MESSAGE =
  'The graphics card did not respond in time, so your request has not started. Nothing was lost — '
  + 'send it again in a moment.';

export const UNAVAILABLE_MESSAGE =
  'The AI engine is not reachable right now, so your request has not started. Nothing was lost.';
