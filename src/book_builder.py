"""
book_builder.py — Compile dialogue sessions into book chapters

Usage:
    py src/book_builder.py                        # compile all sessions by arc
    py src/book_builder.py --arc economy          # compile only a specific arc
    py src/book_builder.py --session 001 002 003  # compile specific sessions
    py src/book_builder.py --list                 # list all sessions and their arcs
"""

import json
import argparse
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.parent
DIALOGUES_DIR = ROOT / "dialogues"
BOOK_DIR = ROOT / "book"
BOOK_DIR.mkdir(exist_ok=True)

ARC_ORDER = ["economy", "climate", "ai", "pattern", "untagged"]

ARC_TITLES = {
    "economy":  "Part One — The Story of More",
    "climate":  "Part Two — The Math We Refuse to Do",
    "ai":       "Part Three — Machines That Think, Humans Who Wonder",
    "pattern":  "Part Four — The Pattern",
    "untagged": "Appendix — Further Dialogues",
}


def load_all_sessions() -> list[dict]:
    sessions = []
    for path in sorted(DIALOGUES_DIR.glob("session_*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        data["_path"] = str(path)
        sessions.append(data)
    return sessions


def format_dialogue(session: dict) -> str:
    """Convert a session's messages into formatted dialogue text."""
    lines = []
    for msg in session["messages"]:
        role = msg["role"]
        content = msg["content"].strip()
        if role == "user":
            lines.append(f"**Narrator:** {content}\n")
        elif role == "assistant":
            lines.append(f"**The Witness:** {content}\n")
    return "\n".join(lines)


def build_chapter(arc: str, sessions: list[dict]) -> str:
    title = ARC_TITLES.get(arc, f"Arc: {arc.title()}")
    lines = [f"# {title}\n"]

    for i, session in enumerate(sessions, 1):
        started = session.get("started_at", "")
        if started:
            try:
                dt = datetime.fromisoformat(started)
                date_str = dt.strftime("%B %d, %Y")
            except ValueError:
                date_str = started
        else:
            date_str = ""

        lines.append(f"## Session {session['id']}" + (f" — {date_str}" if date_str else "") + "\n")
        dialogue = format_dialogue(session)
        if dialogue.strip():
            lines.append(dialogue)
        else:
            lines.append("*[No dialogue recorded in this session.]*\n")
        lines.append("\n---\n")

    return "\n".join(lines)


def list_sessions(sessions: list[dict]):
    if not sessions:
        print("No sessions found in dialogues/")
        return
    print(f"\n{'ID':<8} {'Arc':<15} {'Messages':<10} {'Started'}")
    print("─" * 55)
    for s in sessions:
        msg_count = len(s.get("messages", []))
        started = s.get("started_at", "")[:10]
        print(f"{s['id']:<8} {s.get('arc', 'untagged'):<15} {msg_count:<10} {started}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Compile dialogue sessions into book chapters")
    parser.add_argument("--arc", type=str, help="Compile only sessions tagged to this arc")
    parser.add_argument("--session", nargs="+", help="Compile specific session IDs")
    parser.add_argument("--list", action="store_true", help="List all sessions")
    args = parser.parse_args()

    all_sessions = load_all_sessions()

    if args.list:
        list_sessions(all_sessions)
        return

    if not all_sessions:
        print("No sessions found. Run `py src/witness.py` to start a dialogue.")
        return

    # Filter sessions
    if args.session:
        target_ids = set(args.session)
        sessions_to_build = [s for s in all_sessions if s["id"] in target_ids]
    elif args.arc:
        sessions_to_build = [s for s in all_sessions if s.get("arc") == args.arc]
    else:
        sessions_to_build = all_sessions

    if not sessions_to_build:
        print("No matching sessions found.")
        return

    # Group by arc
    arc_groups: dict[str, list] = {}
    for session in sessions_to_build:
        arc = session.get("arc", "untagged")
        arc_groups.setdefault(arc, []).append(session)

    # Write one markdown file per arc
    written = []
    for arc in ARC_ORDER:
        if arc not in arc_groups:
            continue
        chapter_text = build_chapter(arc, arc_groups[arc])
        filename = f"chapter_{arc}.md"
        out_path = BOOK_DIR / filename
        out_path.write_text(chapter_text, encoding="utf-8")
        written.append(str(out_path))

    # Handle arcs not in ARC_ORDER
    for arc, sessions in arc_groups.items():
        if arc in ARC_ORDER:
            continue
        chapter_text = build_chapter(arc, sessions)
        filename = f"chapter_{arc}.md"
        out_path = BOOK_DIR / filename
        out_path.write_text(chapter_text, encoding="utf-8")
        written.append(str(out_path))

    print(f"\nCompiled {len(sessions_to_build)} session(s) into {len(written)} chapter(s):")
    for path in written:
        print(f"  {path}")
    print()


if __name__ == "__main__":
    main()
