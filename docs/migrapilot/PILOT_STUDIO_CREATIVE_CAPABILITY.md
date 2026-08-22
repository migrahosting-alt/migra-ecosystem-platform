# Pilot ↔ Studio — creative generation capability

**System-level requirement, recorded 2026-08-22. Not scheduled ahead of the active Abbie
character-lock slice.** Its purpose is to constrain how that slice is built, so the pieces
come out shared rather than trapped.

> MigraPilot must take a user's natural-language creative request, reason about the desired
> visual outcome, produce the prompt/direction, generate the graphic through MigraAI Studio,
> **inspect the result**, and refine it until it meets the requested quality bar.

## Pilot is not a prompt forwarder

The value is the reasoning layer, not the text box. Three phases, and the third is the one
usually missing:

**1 — Pilot, creative director.** Understands what is being made. Asks only when genuinely
necessary. Expands the request into structured direction: characters, branding, culture,
layout, audience, destination. Decides whether the job needs generation, deterministic
graphics, editing or compositing. Emits a plan.

**2 — Studio, production engine.** Selects the style pipeline, binds character references,
composes, generates, renders deterministic graphics where diffusion is unreliable, validates
the artifact, repairs localized failures, and returns the result **with provenance and
quality evidence**.

**3 — Pilot, reviewer.** Looks at the ACTUAL result, compares it against the request and the
references, names what is wrong, sends targeted corrections, and presents the finished asset.

## The contract belongs to the shared Brain

🚨 **Studio must not invent one version of the plan and Pilot another.** A plan each side
defines privately is two plans, and the reviewer phase becomes guesswork about what the
generator actually did.

```
CreativeGenerationRequest
  intent · destination · subject bindings · character preservation · cultural context
  style domain · action · wardrobe · scene · composition · aspect ratio
  deterministic elements · quality requirements · reference assets

CreativeGenerationResult
  creationId · artifact · generation plan used · identity binding · models/workflows
  validation results · recoverable failures · provenance
```

Pilot creates and edits the plan. Studio executes it. The result comes back describing what
was done, so Pilot can **reason over it** rather than infer.

## Generate / render / composite

Deciding this is Pilot's job, and it is what separates a polished asset from a hopeful one:

| kind | examples |
|---|---|
| **Generate** | character, environment, photographic or stylized imagery |
| **Render deterministically** | text, logos, the numeral 4, an exact count of objects, brand marks, titles, borders, layout |
| **Composite** | generated image + deterministic graphics + branding |

Diffusion models are unreliable at spelling words and counting objects. A teaching graphic
whose whole point is the number four cannot depend on the model drawing a four — that element
is rendered, then composited.

## Worked example

> "Make me a graphic of Abbie teaching the number four in a beautiful preschool classroom for
> YouTube."

Pilot should infer, without being told: Abbie specifically rather than a generic child; her
locked character design; the stylized 3D domain; canonical skin tone, hair, bows and outfit;
YouTube implying 16:9; an educational, kids-safe composition; Abbie prominent; a classroom
environment; **the numeral 4 actually being a 4**; exactly four counting objects if counting
objects are shown; a readable layout; no malformed pseudo-text; production polish.

## Cultural grounding

"Make Manmi Solange sitting in a lakou" needs Haitian context. Pilot must keep two things
apart: **who she is** (character identity) and **where she is** (cultural grounding). Cultural
knowledge belongs in the shared Brain as grounded context, never as stereotypes stuffed into a
prompt string.

## Where this is heading

> "Make this prettier."

Pilot understands the existing artifact, sees what is wrong, knows the character and the
project, edits the generation plan, invokes Studio, reviews the replacement, and iterates.

> "I need a Facebook ad for MigraHosting about domain names."

Pilot knows the branding, writes the copy, chooses the composition, generates or sources the
imagery, renders the text correctly, and returns a finished asset.

## Constraint on current work

Abbie character-lock stays the active slice and is the first visual qualification case.
Nothing here reorders it. What it does require: **style routing, the generation plan,
deterministic graphics, cultural grounding and quality evaluation must be shared and callable
by MigraPilot** — not implemented as Studio internals. Once Studio can generate Abbie
reliably, Pilot must be able to direct that capability conversationally without a second
implementation being written to do it.
