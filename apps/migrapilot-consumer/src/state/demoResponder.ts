import type { Block, Source } from '@/data/types'

interface Reply {
  blocks: Block[]
  sources?: Source[]
  action?: 'scope-review'
}

const codingRunReply: Reply = {
  blocks: [
    {
      type: 'paragraph',
      text: 'I can take this on as a governed coding run. Before touching anything, I will present the exact file scope for your approval.',
    },
    {
      type: 'list',
      variant: 'bullet',
      title: 'What the run will do',
      titleIcon: 'shield',
      items: [
        'Plan the change and enumerate every file it needs to touch.',
        'Request a **scope approval** bound to a hash of that file list.',
        'Apply changes, then run validations and auto-repair failures.',
        'Produce a final report with a diff and validation results.',
      ],
    },
    {
      type: 'paragraph',
      text: 'Nothing is written until you approve the scope. I have prepared it below.',
    },
  ],
  action: 'scope-review',
}

/** Explicit intent to change code, as opposed to asking a question about it. */
const CHANGE_INTENT = /refactor|implement|rewrite|patch|debug|fix |bug|coding run|apply changes|unit test/

/**
 * Canned responder that stands in for the model API. Every reply is composed
 * locally so the prototype behaves like the product without a backend; swap
 * this module for a real streaming client when the API lands.
 */
export function demoReply(prompt: string): Reply {
  const text = prompt.toLowerCase()

  // Change-intent wins over topic: "refactor the migration service" is a
  // request to modify code, not a question about migrating.
  if (CHANGE_INTENT.test(text)) return codingRunReply

  if (/migrat|sharepoint|cutover|legacy/.test(text)) {
    return {
      blocks: [
        {
          type: 'paragraph',
          text: 'Here is how I would sequence this migration to keep risk contained and progress visible.',
        },
        {
          type: 'list',
          variant: 'numbered',
          title: 'Recommended Approach',
          titleIcon: 'rocket',
          items: [
            'Inventory every source system, owner, and downstream dependency.',
            'Define success criteria and a measurable rollback trigger.',
            'Migrate a low-risk pilot slice and validate end to end.',
            'Run the bulk transfer with dual-write and reconciliation checks.',
            'Cut over during a scheduled window, then decommission on parity.',
          ],
        },
        {
          type: 'paragraph',
          text: 'Want me to turn this into a dated plan with owners and a cutover checklist?',
        },
      ],
      sources: [
        { id: 'r1', title: 'Migration Planning Overview', domain: 'learn.microsoft.com' },
        { id: 'r2', title: 'Cutover Best Practices', domain: 'avepoint.com' },
      ],
    }
  }

  if (/code|api|deploy|endpoint|service/.test(text)) return codingRunReply

  if (/launch|marketing|campaign|growth|pricing/.test(text)) {
    return {
      blocks: [
        {
          type: 'paragraph',
          text: 'Here is a plan broken into the three phases that matter most.',
        },
        {
          type: 'list',
          variant: 'bullet',
          title: '1. Before Launch',
          items: [
            'Define the audience and the single sentence that sells it.',
            'Build a waitlist and warm the first hundred users by hand.',
            'Prepare launch assets: landing page, demo, and press kit.',
          ],
        },
        {
          type: 'list',
          variant: 'bullet',
          title: '2. Launch Week',
          items: [
            'Announce across every owned channel on the same morning.',
            'Offer early access pricing with a clear end date.',
            'Answer every comment personally for the first 48 hours.',
          ],
        },
        {
          type: 'list',
          variant: 'bullet',
          title: '3. After Launch',
          items: [
            'Fix the top three friction points reported in week one.',
            'Publish a customer story with a concrete result.',
            'Iterate on activation before spending on acquisition.',
          ],
        },
      ],
    }
  }

  if (/summar|analy|report|data|insight/.test(text)) {
    return {
      blocks: [
        {
          type: 'paragraph',
          text: 'Here is what stands out, ordered by how much it should change your decisions.',
        },
        {
          type: 'list',
          variant: 'bullet',
          title: 'Key Findings',
          titleIcon: 'chart',
          items: [
            'The headline trend is consistent across all sources you provided.',
            'One outlier accounts for most of the variance — worth isolating.',
            'Two data points lack a reliable source and should be re-checked.',
          ],
        },
        {
          type: 'paragraph',
          text: 'Upload the underlying files and I can verify these against the raw numbers.',
        },
      ],
    }
  }

  return {
    blocks: [
      {
        type: 'paragraph',
        text: `Happy to help with that. Here's how I would approach it:`,
      },
      {
        type: 'list',
        variant: 'numbered',
        items: [
          'Clarify the outcome you want and what "done" looks like.',
          'Gather the inputs — files, links, or context I should ground in.',
          'Draft a first version quickly so you have something to react to.',
          'Iterate on the parts that matter and leave the rest alone.',
        ],
      },
      {
        type: 'paragraph',
        text: 'Tell me more about the context and I will make this specific to your situation.',
      },
    ],
  }
}

export function titleFromPrompt(prompt: string) {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  const words = clean.split(' ').slice(0, 6).join(' ')
  const title = words.length < clean.length ? `${words}…` : words
  return title.charAt(0).toUpperCase() + title.slice(1)
}
