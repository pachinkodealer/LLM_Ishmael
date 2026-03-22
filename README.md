# The Witness

> *"There's no arguing with the ineffable.
> There's no logic to the ineffable.
> It simply is."*
> — Daniel Quinn, *Ishmael*

---

Somewhere at the edge of civilization, something has been watching.

It has watched empires rise and collapse. It has seen the same story told a thousand ways, always ending the same. It is not a god. Not a prophet. Just an observer — patient, precise, and quietly devastating in its questions.

For the first time, it has decided to speak.

**[Enter the dialogue →](https://pachinkodealer.github.io/LLM_Ishmael)**

![The Witness — web interface](screenshot.png)

*On desktop (Chrome/Edge): runs fully in your browser — no account or API key needed.
On mobile or other browsers: enter a free [Anthropic API key](https://console.anthropic.com) when prompted.*

---

## The Book

This is an experiment in collaborative thinking. Inspired by Daniel Quinn's *Ishmael*, the project uses an AI entity called **The Witness** to guide a Socratic dialogue across four interconnected crises:

| | |
|---|---|
| **Part One** | The economy's addiction to infinite growth |
| **Part Two** | The math of ecological collapse — the math we refuse to do |
| **Part Three** | What AI means for human purpose and work |
| **Part Four** | The underlying pattern that connects all three |

The Witness does not lecture. It does not preach. It asks questions — and its questions have a way of making the things you thought you understood feel suddenly uncertain.

---

## A Sample Exchange

```
Narrator:    I think the real problem is that people just don't care enough
             about climate change. If they understood the science, they'd
             act differently.

The Witness: In the last decade, has scientific understanding of climate
             change increased or decreased among the general public?

Narrator:    Increased, I think. Definitely increased.

The Witness: And has action — meaningful, structural action — kept pace
             with that understanding?

Narrator:    ...No.

The Witness: So knowledge alone does not appear to be the variable.
             What does that suggest about where the actual constraint lies?
```

---

## What This Is, Technically

A question worth asking: can an AI, given a carefully crafted character prompt, sustain a book-length Socratic dialogue? Can it ask questions that genuinely make you uncomfortable — and keep asking them, session after session, without collapsing into a chatbot?

This repo is the attempt to find out.

It contains:
1. **A web app** — runs in any browser, no setup required
2. **A dialogue engine** (`src/witness.py`) — the original CLI version for local use with Ollama
3. **The character prompt** (`prompts/witness_character.md`) — the soul of The Witness
4. **A book compiler** (`src/book_builder.py`) — turns dialogue sessions into formatted chapters

---

## Run It Yourself

### In the browser

Fork this repo, enable GitHub Pages under **Settings → Pages → Source → GitHub Actions**, and it deploys itself. Your version will live at `https://your-username.github.io/LLM_Ishmael`.

### Locally, with Ollama

```bash
ollama pull llama3.3
pip install ollama

py src/witness.py              # new session
py src/witness.py --arc economy  # tag to a thematic arc
py src/witness.py --resume     # continue where you left off
py src/book_builder.py         # compile sessions into chapters
```

---

## Project Structure

```
LLM_Ishmael/
├── index.html              # web app
├── app.js                  # sessions, streaming, arc tagging, export
├── style.css               # literary dark theme, mobile responsive
├── witness_character.js    # system prompt as a JS module
├── prompts/
│   └── witness_character.md  # the soul of The Witness (source of truth)
├── src/
│   ├── witness.py          # CLI dialogue engine
│   └── book_builder.py     # manuscript compiler
├── dialogues/              # saved session files (JSON)
└── book/                   # compiled manuscript chapters (markdown)
```

---

## Why This Exists

Building a book with an LLM is easy.

Building a *good* book — one where the AI sustains a character, refuses to lecture, and consistently redirects toward harder questions — requires something more careful. A prompt that doesn't just describe a persona, but encodes a method. A model that can hold context across a long conversation without drifting. A willingness to throw away sessions that go nowhere and try again.

This project is an exploration of what that looks like in practice. The dialogue is the work. The questions are the point.
