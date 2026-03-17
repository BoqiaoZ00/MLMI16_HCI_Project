from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SENTENCES_PATH = ROOT / "our_sentences.txt"
INCORRECT_SUGGESTIONS_PATH = ROOT / "incorrect_suggestions_by_prefix.txt"
INCORRECT_PRACTICE_PATH = ROOT / "incorrect_suggestions_practice.txt"
OUTPUT_PATH = ROOT / "suggestions.json"

PRACTICE_PHRASES = [
    "Typing with suggestions feels natural.",
    "Practice helps prepare for the main task.",
    "Press the number keys to accept suggestions.",
]


def parse_sentences() -> list[dict]:
    blocks = []
    for line in SENTENCES_PATH.read_text(encoding="utf-8").splitlines():
        line = line.replace("\u00a0", " ").strip()
        if not line:
            continue
        match = re.match(
            r"accuracy\s*([0-9.]+)\s*\|\s*delay\s*(\d+)\s*ms\s*:\s*(.+)",
            line,
            re.IGNORECASE,
        )
        if not match:
            continue
        accuracy = float(match.group(1))
        delay_ms = int(match.group(2))
        sentence = match.group(3).strip()
        blocks.append({"accuracy": accuracy, "delay_ms": delay_ms, "sentence": sentence})
    return blocks


def hash_string(value: str) -> int:
    h = 0
    for ch in value:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def load_incorrect_suggestions() -> dict[str, dict[int, list[str]]]:
    if not INCORRECT_SUGGESTIONS_PATH.exists():
        return {}
    mapping: dict[str, dict[int, list[str]]] = {}
    for line in INCORRECT_SUGGESTIONS_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) < 6:
            continue
        sentence_id = parts[0]
        try:
            word_index = int(parts[1])
        except ValueError:
            continue
        suggestions = [parts[3].lower(), parts[4].lower(), parts[5].lower()]
        mapping.setdefault(sentence_id, {})[word_index] = suggestions
    return mapping


def load_practice_incorrect() -> dict[str, dict[str, list[str]]]:
    if not INCORRECT_PRACTICE_PATH.exists():
        return {}
    mapping: dict[str, dict[str, list[str]]] = {}
    for line in INCORRECT_PRACTICE_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) < 5:
            continue
        word = parts[0].lower()
        prefix = parts[1].lower()
        suggestions = [parts[2].lower(), parts[3].lower(), parts[4].lower()]
        mapping.setdefault(word, {})[prefix] = suggestions
    return mapping


def resolve_incorrect_suggestions(
    word_map: dict[int, object],
    word_index: int,
    prefix: str,
    default_incorrect: list[str],
) -> list[str]:
    entry = word_map.get(word_index)
    if isinstance(entry, list):
        return entry
    if isinstance(entry, dict):
        if prefix in entry:
            return entry[prefix]
        for i in range(len(prefix) - 1, 0, -1):
            candidate = prefix[:i]
            if candidate in entry:
                return entry[candidate]
    return default_incorrect


def build_default_incorrect(word_map: dict[int, object]) -> list[str]:
    for suggestions in word_map.values():
        if isinstance(suggestions, list) and suggestions:
            return suggestions
        if isinstance(suggestions, dict):
            for items in suggestions.values():
                if items:
                    return items
    return ["word", "words", "world"]


def build_rank_sequence(length: int, seed: str) -> list[int]:
    sequence = []
    cursor = hash_string(seed)
    for _ in range(length + 1):
        sequence.append((cursor % 3) + 1)
        cursor = (cursor * 1103515245 + 12345) & 0xFFFFFFFF
    return sequence


def build_word_plan(
    word: str,
    word_index: int,
    accuracy: float,
    block_id: str,
    incorrect_map: dict[int, object],
    default_incorrect: list[str],
) -> dict:
    clean = re.sub(r"[^a-z0-9]", "", word.lower())
    length = len(clean)
    max_savable = max(length - 2, 0)
    target_saving = round(max_savable * accuracy)
    appearance_k = length - target_saving - 1
    if length <= 1:
        appearance_k = 1
    appearance_k = max(1, min(appearance_k, max(length - 1, 1)))
    enabled_savable = max(length - (appearance_k + 1), 0)
    rank_seed = f"{block_id}-{word_index}-{clean}"
    rank_sequence = build_rank_sequence(length, rank_seed)
    suggestions_by_index: dict[str, dict] = {}
    for typed_count in range(1, max(length, 1) + 1):
        prefix = clean[:typed_count]
        correct_visible = typed_count >= appearance_k and length > 0
        correct_rank = rank_sequence[typed_count] if correct_visible else None
        incorrect = resolve_incorrect_suggestions(
            incorrect_map,
            word_index,
            prefix,
            default_incorrect,
        )
        if len(incorrect) < 3:
            incorrect = (incorrect * 3)[:3]
        suggestions = incorrect[:3]
        if correct_visible:
            idx = max(0, min((correct_rank or 1) - 1, 2))
            suggestions[idx] = clean
        suggestions_by_index[str(typed_count)] = {
            "suggestions": suggestions,
            "correct_visible": correct_visible,
            "correct_rank": correct_rank,
        }
    return {
        "target_word": word,
        "clean_word": clean,
        "word_length": length,
        "appearance_index_k": appearance_k,
        "enabled_savable_keystrokes": enabled_savable,
        "rank_sequence": rank_sequence,
        "suggestions_by_index": suggestions_by_index,
    }


def main() -> None:
    sentences = parse_sentences()
    incorrect_mapping = load_incorrect_suggestions()
    practice_incorrect = load_practice_incorrect()
    practice_blocks = []
    for idx, sentence in enumerate(PRACTICE_PHRASES, start=1):
        block_id = f"practice_{idx}"
        sentence_key = sentence.strip().lower()
        word_map = {}
        for word_index, word in enumerate(sentence.split(" ")):
            clean = re.sub(r"[^a-z0-9]", "", word.lower())
            if clean in practice_incorrect:
                word_map[word_index] = practice_incorrect[clean]
        default_incorrect = build_default_incorrect(word_map)
        words = sentence.split(" ")
        practice_blocks.append(
            {
                "accuracy": 1.0,
                "delay_ms": 0,
                "sentence": sentence,
                "words": [
                    build_word_plan(
                        word,
                        word_index,
                        1.0,
                        block_id,
                        word_map,
                        default_incorrect,
                    )
                    for word_index, word in enumerate(words)
                ],
            }
        )
    blocks = []
    for idx in range(0, len(sentences), 3):
        group = sentences[idx:idx + 3]
        if len(group) < 3:
            break
        block_id = f"block_{len(blocks) + 1}"
        block_entry = {
            "accuracy": group[0]["accuracy"],
            "delay_ms": group[0]["delay_ms"],
            "phrases": [],
        }
        for phrase_offset, sentence_entry in enumerate(group):
            sentence_id = f"S{idx + phrase_offset + 1}"
            sentence_text = sentence_entry["sentence"]
            words = sentence_text.split(" ")
            word_map = incorrect_mapping.get(sentence_id, {})
            default_incorrect = build_default_incorrect(word_map)
            phrase_words = [
                build_word_plan(
                    word,
                    word_index,
                    sentence_entry["accuracy"],
                    block_id,
                    word_map,
                    default_incorrect,
                )
                for word_index, word in enumerate(words)
            ]
            block_entry["phrases"].append(
                {"sentence": sentence_text, "words": phrase_words}
            )
        blocks.append(block_entry)

    if not blocks:
        raise SystemExit("No sentences parsed. Check our_sentences.txt format.")
    OUTPUT_PATH.write_text(
        json.dumps({"practice_blocks": practice_blocks, "blocks": blocks}, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
