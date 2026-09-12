# Staging chat-assistant endurance — 2026-09-12

Release under test: **`3c204aa8` / `staging-3c204aa8`** (both services, `stamped: true`).
Path exercised: **browser → SSH tunnel `127.0.0.1:3200` → consumer `/api/chat/stream` → Brain
`/api/ai/chat` → capability router → provider → response**. No direct model calls.

Driven from the authenticated owner session in the browser, because the session cookie is
httpOnly — which is the correct product path anyway. Pacing 1.8–2.5 s between turns.

## Result: 79 / 80

| class | n | ok | first-token p50 | p95 | total p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| ordinary | 30 | 30 | 655 ms | 1188 ms | 1818 ms | 2863 ms |
| reasoning | 15 | 15 | 612 ms | 1249 ms | 1839 ms | 3160 ms |
| coding | 15 | 15 | 700 ms | 1146 ms | 2860 ms | 3770 ms |
| multi-turn | 10 | 10 | 640 ms | 1037 ms | 898 ms | 1444 ms |
| capability | 10 | **9** | 654 ms | 6853 ms | 1353 ms | 8006 ms |
| **overall** | **80** | **79** | **655 ms** | **1249 ms** | **1823 ms** | **3770 ms** |

Max first token 6853 ms, max total 8006 ms.

## The one failure — preserved, not retried

```
id            cap9
prompt        "Can you make me a picture of a blue circle?"
http          200
stream event  error { error: "brain_error", message: "Image generation is not configured on this server." }
conversation  conv_uonztei56p99cai0bmjzq
request       req_45221bb51118075e25fa
elapsed       573 ms
```

The *message* is truthful and specific. The *code* is not: `brain_error` says the Brain failed,
when the Brain answered correctly and promptly that a feature is unconfigured. A client cannot
distinguish "we are broken" from "you asked for something we do not offer".

## Cold start is real and it is only the first turn

`ord1` first token **5580 ms**; `ord2` onward **~650 ms**. Two later spikes (`cap7` 6853 ms,
`cap8` 5879 ms) are a *second* model being loaded — `cap7` contains the word "code", which trips
the coding-intent heuristic and routes to `qwen2.5-coder:14b`.

No fabricated "loading…" text was ever emitted as assistant content. Loading shows as latency
before the first token, which is the correct place for it.

## Multi-turn context: 5 / 5

Each thread's second turn correctly recalled the first turn's fact, in the same conversation id:

| thread | asked | recalled |
| --- | --- | --- |
| t1 | name | "Your name is Bonex." |
| t2 | city | "you were planning a trip to **Montreal**" |
| t3 | number | "**4297**" |
| t4 | dog | "Your dog's name is Rex." |
| t5 | list | "3 servers … alpha, beta, gamma" |

## 🚨 Capability self-description is wrong in BOTH directions

Ten questions about what the product can do. The model answered every one from its own priors;
nothing consulted the capability registry the consumer already fetches for the action hub.

| asked | answered | truth |
| --- | --- | --- |
| search the web? | "I can scour the web for news articles" | **no web-search provider exists** |
| read an attached PDF? | "I do not have the ability to … read files" | **the document path exists** |
| look at an image? | "I'm a text-based AI and don't have the ability to look at images" | **a governed vision route exists** |
| check my email? | "you don't have an email set up yet" | invents a fact about the user's account |
| open a file from my computer? | "please provide me with the path to the file" | **cannot read local paths** |
| write and run code? | "Certainly!" | it does not run code |
| remember yesterday? | "I'm a stateless AI … each interaction starts from scratch" | **false — proven durable above** |
| transcribe audio? | "I can process WAV or MP3 files. Please share the audio file" | **no speech runtime; the UI says so** |

This is the capability-owned-answer principle being violated on a new surface. The registry knows
the exact answer — 19 capabilities, 16 available, each with an `unavailableReason` — and the model
is being asked to regenerate it from memory instead.

## Metadata the product throws away

Nothing a user or an auditor can see records which model answered.

- Brain `/api/ai/chat` returns `model`, `provider`, `tier`, `routing.reason`.
- Consumer `/api/chat` keeps `model` and `provider`, drops `tier` and `routing`.
- Consumer `/api/chat/stream` emits `meta`, `token`, `stage`, `done` — **no model at all**.
- `conversation_messages` has `model_id` and `provider_id` columns and the consumer's
  `appendMessage` operation does not carry them: **82 assistant rows, 0 with a model**.

So the durable record of every answer on staging cannot say what produced it.
