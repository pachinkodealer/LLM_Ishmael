"""
witness.py — Dialogue engine for The Witness

Usage:
    py src/witness.py                  # start a new session
    py src/witness.py --resume         # resume the most recent session
    py src/witness.py --session 003    # resume a specific session by number
    py src/witness.py --arc economy    # tag this session to an arc
"""

import json
import sys
import argparse
from datetime import datetime
from pathlib import Path

import ollama

# --- Paths ---
ROOT = Path(__file__).parent.parent
PROMPTS_DIR = ROOT / "prompts"
DIALOGUES_DIR = ROOT / "dialogues"
DIALOGUES_DIR.mkdir(exist_ok=True)

MODEL = "phi4:latest"


# --- Load system prompt ---
def load_system_prompt() -> str:
    prompt_file = PROMPTS_DIR / "witness_character.md"
    raw = prompt_file.read_text(encoding="utf-8")
    start = raw.find("```\n") + 4
    end = raw.rfind("\n```")
    return raw[start:end].strip()


# --- Preflight check ---
def check_ollama():
    """Verify Ollama is running and the model is available before starting."""
    try:
        result = ollama.list()
        names = [m["model"] for m in result.get("models", [])]
        if MODEL not in names:
            print(f"\n[!] Model '{MODEL}' not found in Ollama.")
            print(f"    Re-pull it with:")
            print(f"    ollama pull llama3.3")
            print(f"    Then re-run this script.\n")
            sys.exit(1)
    except Exception:
        print("\n[!] Cannot connect to Ollama.")
        print("    Open a separate terminal and run:")
        print("    ollama serve")
        print("    Then re-run: py src/witness.py --arc economy\n")
        sys.exit(1)


# --- Llama 3 instruct prompt format (fallback for models without chat template) ---
def format_llama3_prompt(system_prompt: str, history: list[dict]) -> str:
    parts = ["<|begin_of_text|>"]
    parts.append(f"<|start_header_id|>system<|end_header_id|>\n\n{system_prompt}<|eot_id|>")
    for msg in history:
        role = msg["role"]
        content = msg["content"]
        parts.append(f"<|start_header_id|>{role}<|end_header_id|>\n\n{content}<|eot_id|>")
    parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
    return "".join(parts)


# --- Streaming response with chat → generate fallback ---
def stream_response(system_prompt: str, history: list[dict]):
    """Yield response tokens. Tries chat API first; falls back to generate."""
    try:
        stream = ollama.chat(
            model=MODEL,
            messages=[{"role": "system", "content": system_prompt}] + history,
            stream=True,
        )
        for chunk in stream:
            yield chunk["message"]["content"]
        return
    except Exception as e:
        if "does not support chat" not in str(e):
            raise

    # Fallback: generate with Llama 3 instruct format
    prompt = format_llama3_prompt(system_prompt, history)
    for chunk in ollama.generate(model=MODEL, prompt=prompt, stream=True):
        yield chunk["response"]


# --- Session management ---
def get_next_session_number() -> str:
    existing = sorted(DIALOGUES_DIR.glob("session_*.json"))
    if not existing:
        return "001"
    last = existing[-1].stem
    num = int(last.split("_")[1]) + 1
    return f"{num:03d}"


def load_session(session_id: str) -> dict:
    path = DIALOGUES_DIR / f"session_{session_id}.json"
    if not path.exists():
        print(f"[witness] No session found: {path}")
        sys.exit(1)
    return json.loads(path.read_text(encoding="utf-8"))


def save_session(session: dict):
    path = DIALOGUES_DIR / f"session_{session['id']}.json"
    path.write_text(json.dumps(session, indent=2, ensure_ascii=False), encoding="utf-8")


def new_session(arc: str | None) -> dict:
    session_id = get_next_session_number()
    return {
        "id": session_id,
        "arc": arc or "untagged",
        "started_at": datetime.now().isoformat(),
        "messages": [],
    }


def get_latest_session_id() -> str | None:
    existing = sorted(DIALOGUES_DIR.glob("session_*.json"))
    if not existing:
        return None
    return existing[-1].stem.split("_")[1]


# --- Display helpers ---
def print_divider():
    print("\n" + "─" * 60 + "\n")


def print_witness(text: str):
    print(f"\033[96mThe Witness:\033[0m  {text}\n")


def print_narrator(text: str):
    print(f"\033[93mNarrator:\033[0m      {text}\n")


# --- Core dialogue loop ---
def run_dialogue(session: dict, system_prompt: str):
    history = session["messages"]

    print_divider()
    print(f"  Session {session['id']}  |  Arc: {session['arc']}")
    print(f"  Model: {MODEL}")
    print(f"  Type your message. Commands: /quit  /save  /arc <name>")
    print_divider()

    if history:
        print("[Resuming session — last exchange:]\n")
        last_human = next((m for m in reversed(history) if m["role"] == "user"), None)
        last_witness = next((m for m in reversed(history) if m["role"] == "assistant"), None)
        if last_human:
            print_narrator(last_human["content"])
        if last_witness:
            print_witness(last_witness["content"])
        print_divider()

    while True:
        try:
            user_input = input("\033[93mYou:\033[0m  ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\n[Session saved on exit]")
            save_session(session)
            break

        if not user_input:
            continue

        if user_input == "/quit":
            save_session(session)
            print(f"\n[Session {session['id']} saved to dialogues/]")
            break
        elif user_input == "/save":
            save_session(session)
            print(f"[Saved: session_{session['id']}.json]")
            continue
        elif user_input.startswith("/arc "):
            session["arc"] = user_input[5:].strip()
            print(f"[Arc set to: {session['arc']}]")
            continue

        history.append({"role": "user", "content": user_input})

        print(f"\n\033[96mThe Witness:\033[0m  ", end="", flush=True)
        full_response = ""
        try:
            for token in stream_response(system_prompt, history):
                print(token, end="", flush=True)
                full_response += token
        except Exception as e:
            print(f"\n[Error: {e}]")
            history.pop()
            continue

        print("\n")
        history.append({"role": "assistant", "content": full_response})
        save_session(session)


# --- Entry point ---
def main():
    parser = argparse.ArgumentParser(description="Dialogue engine for The Witness")
    parser.add_argument("--resume", action="store_true", help="Resume the most recent session")
    parser.add_argument("--session", type=str, help="Resume a specific session by number (e.g. 003)")
    parser.add_argument("--arc", type=str, help="Tag this session to a book arc (e.g. economy, climate, ai)")
    args = parser.parse_args()

    check_ollama()

    system_prompt = load_system_prompt()

    if args.session:
        session = load_session(args.session)
        print(f"[Resuming session {args.session}]")
    elif args.resume:
        latest = get_latest_session_id()
        if latest is None:
            print("[No previous sessions found. Starting a new one.]")
            session = new_session(args.arc)
        else:
            session = load_session(latest)
            print(f"[Resuming session {latest}]")
    else:
        session = new_session(args.arc)
        print(f"[Starting new session {session['id']}]")

    run_dialogue(session, system_prompt)


if __name__ == "__main__":
    main()
