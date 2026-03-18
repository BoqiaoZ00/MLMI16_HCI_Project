from __future__ import annotations

import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re

from flask import Flask, jsonify, request, send_file, send_from_directory
import gspread
from google.oauth2.service_account import Credentials

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_RECORDED_DIR", str(APP_DIR / "Data_Recorded")))
WORD_POOL_PATH = APP_DIR / "Sentences" / "phrases2.txt"
WORD_POOL_PDF_PATH = Path("/Users/permanj/Desktop/MLMI 16 HCI/vocabulary-list.pdf")
INFO_SHEET_PDF_PATH = Path("/Users/permanj/Desktop/MLMI 16 HCI/Participant_Information_Sheet_Template.pdf")
SUGGESTIONS_PATH = APP_DIR / "Sentences" / "suggestions.json"
INCORRECT_SUGGESTIONS_PATH = APP_DIR / "Sentences" / "incorrect_suggestions_by_prefix.txt"
_SUGGESTIONS_CACHE: dict[str, object] | None = None
_SUGGESTIONS_MTIME: float | None = None
_INCORRECT_PREFIX_CACHE: dict[str, list[str]] | None = None
_INCORRECT_PREFIX_MTIME: float | None = None

SHEET_ID = os.environ.get("GOOGLE_SHEET_ID")
SHEET_NAME = os.environ.get("GOOGLE_SHEET_NAME")
SHEET_GID = os.environ.get("GOOGLE_SHEET_GID")
SERVICE_ACCOUNT_JSON = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
ENABLE_GOOGLE_EVENTS = os.environ.get("ENABLE_GOOGLE_EVENTS", "0") == "1"
GOOGLE_EVENTS_SHEET_NAME = os.environ.get("GOOGLE_EVENTS_SHEET_NAME")
GOOGLE_EVENTS_SHEET_GID = os.environ.get("GOOGLE_EVENTS_SHEET_GID")

CSV_HEADERS = {
    "participants": [
        "participant_id",
        "event_type",
        "consent_time",
        "browser_info",
        "screen_resolution",
        "device_type",
        "participation_mode",
        "browser_type",
        "screen_size",
        "experiment_start_time",
        "experiment_end_time",
    ],
    "keystrokes": [
        "participant_id",
        "block_id",
        "phrase_id",
        "word_index",
        "event_type",
        "key_pressed",
        "keypress_timestamp",
        "character_commit_timestamp",
        "target_word",
        "word_length",
        "suggestion_shown",
        "correct_suggestion_visible",
        "correct_suggestion_rank",
        "appearance_index_k",
        "enabled_savable_keystrokes",
        "current_accuracy_level",
        "current_delay_level",
        "block_type",
    ],
    "suggestion_events": [
        "participant_id",
        "block_id",
        "phrase_id",
        "word_index",
        "event_type",
        "target_word",
        "word_length",
        "suggestion_rank",
        "suggestion_word",
        "suggestion_1",
        "suggestion_2",
        "suggestion_3",
        "keypress_timestamp",
        "commit_timestamp",
        "display_timestamp",
        "typed_word",
        "completion_timestamp",
        "correct_suggestion_visible",
        "correct_suggestion_rank",
        "appearance_index_k",
        "enabled_savable_keystrokes",
        "current_accuracy_level",
        "current_delay_level",
        "block_type",
    ],
    "phrase_completion": [
        "participant_id",
        "block_id",
        "phrase_id",
        "event_type",
        "phrase_start_timestamp",
        "phrase_end_timestamp",
        "time_taken",
        "current_accuracy_level",
        "current_delay_level",
        "block_type",
    ],
    "questionnaire": [
        "participant_id",
        "block_id",
        "perceptual_effort",
        "cognitive_evaluation",
        "decision_effort",
        "timestamp",
    ],
}


def _append_to_google_sheet(row: list[str]) -> None:
    if not SHEET_ID or not SERVICE_ACCOUNT_JSON:
        raise RuntimeError("Missing GOOGLE_SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON.")

    creds_info = json.loads(SERVICE_ACCOUNT_JSON)
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    credentials = Credentials.from_service_account_info(creds_info, scopes=scopes)
    client = gspread.authorize(credentials)
    spreadsheet = client.open_by_key(SHEET_ID)
    if SHEET_GID:
        worksheet = spreadsheet.get_worksheet_by_id(int(SHEET_GID))
    elif SHEET_NAME:
        worksheet = spreadsheet.worksheet(SHEET_NAME)
    else:
        worksheet = spreadsheet.get_worksheet(0)
    worksheet.append_row(row, value_input_option="RAW")


def _extract_words_from_pdf(path: Path) -> list[str]:
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        return []
    if not path.exists():
        return []
    try:
        reader = PdfReader(str(path))
    except Exception:
        return []
    text_chunks = []
    for page in reader.pages:
        try:
            text_chunks.append(page.extract_text() or "")
        except Exception:
            continue
    text = " ".join(text_chunks)
    return re.findall(r"[A-Za-z]+", text)


def _append_google_event(dataset: str, row: dict[str, object]) -> None:
    if not ENABLE_GOOGLE_EVENTS:
        return

    if not SHEET_ID or not SERVICE_ACCOUNT_JSON:
        raise RuntimeError("Missing GOOGLE_SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON.")

    creds_info = json.loads(SERVICE_ACCOUNT_JSON)
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    credentials = Credentials.from_service_account_info(creds_info, scopes=scopes)
    client = gspread.authorize(credentials)
    spreadsheet = client.open_by_key(SHEET_ID)
    if GOOGLE_EVENTS_SHEET_GID:
        worksheet = spreadsheet.get_worksheet_by_id(int(GOOGLE_EVENTS_SHEET_GID))
    elif GOOGLE_EVENTS_SHEET_NAME:
        worksheet = spreadsheet.worksheet(GOOGLE_EVENTS_SHEET_NAME)
    else:
        worksheet = spreadsheet.get_worksheet(0)
    worksheet.append_row([dataset, json.dumps(row, ensure_ascii=True)], value_input_option="RAW")


def _append_csv(participant_id: str, dataset: str, row: dict[str, object]) -> None:
    headers = CSV_HEADERS[dataset]
    participant_dir = DATA_DIR / participant_id
    participant_dir.mkdir(parents=True, exist_ok=True)
    path = participant_dir / f"{dataset}.csv"
    is_new = not path.exists() or path.stat().st_size == 0
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        if is_new:
            writer.writeheader()
        normalized = {name: row.get(name, "") for name in headers}
        writer.writerow(normalized)


app = Flask(__name__, static_folder=str(APP_DIR / "static"), template_folder=str(APP_DIR / "templates"))


@app.after_request
def _disable_api_cache(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


@app.get("/")
def index() -> object:
    return send_from_directory(app.template_folder, "index.html")


@app.get("/api/word-pool")
def word_pool() -> object:
    words = _extract_words_from_pdf(WORD_POOL_PDF_PATH)
    if not words:
        if not WORD_POOL_PATH.exists():
            return jsonify({"words": []})
        text = WORD_POOL_PATH.read_text(encoding="utf-8", errors="ignore")
        words = re.findall(r"[A-Za-z]+", text)
    seen: set[str] = set()
    unique = []
    for word in words:
        lower = word.lower()
        if lower in seen:
            continue
        seen.add(lower)
        unique.append(lower)
    return jsonify({"words": unique})


@app.get("/assets/participant-info.pdf")
def participant_info_pdf() -> object:
    if INFO_SHEET_PDF_PATH.exists():
        return send_file(INFO_SHEET_PDF_PATH, mimetype="application/pdf")
    return jsonify({"error": "Participant information sheet not found."}), 404


@app.get("/api/suggestions")
def suggestion_data() -> object:
    if not SUGGESTIONS_PATH.exists():
        return jsonify({"error": "Suggestion data not found."}), 404
    return send_file(SUGGESTIONS_PATH, mimetype="application/json")


def _load_suggestions() -> dict[str, object]:
    global _SUGGESTIONS_CACHE, _SUGGESTIONS_MTIME
    mtime = SUGGESTIONS_PATH.stat().st_mtime
    if _SUGGESTIONS_CACHE is None or _SUGGESTIONS_MTIME != mtime:
        _SUGGESTIONS_CACHE = json.loads(SUGGESTIONS_PATH.read_text(encoding="utf-8"))
        _SUGGESTIONS_MTIME = mtime
    return _SUGGESTIONS_CACHE


def _load_incorrect_prefixes() -> dict[str, list[str]]:
    global _INCORRECT_PREFIX_CACHE, _INCORRECT_PREFIX_MTIME
    if not INCORRECT_SUGGESTIONS_PATH.exists():
        return {}
    mtime = INCORRECT_SUGGESTIONS_PATH.stat().st_mtime
    if _INCORRECT_PREFIX_CACHE is not None and _INCORRECT_PREFIX_MTIME == mtime:
        return _INCORRECT_PREFIX_CACHE
    prefix_map: dict[str, list[str]] = {}
    lines = INCORRECT_SUGGESTIONS_PATH.read_text(encoding="utf-8", errors="ignore").splitlines()
    for line in lines:
        line = line.strip()
        match = re.match(r"prefix='([^']+)'\s*->\s*(.+)", line)
        if not match:
            continue
        prefix = match.group(1).lower()
        suggestions = [w.strip().lower() for w in match.group(2).split(",") if w.strip()]
        if prefix and suggestions and prefix not in prefix_map:
            prefix_map[prefix] = suggestions
    _INCORRECT_PREFIX_CACHE = prefix_map
    _INCORRECT_PREFIX_MTIME = mtime
    return prefix_map


@app.get("/api/suggestions/<int:block_index>")
def suggestion_block(block_index: int) -> object:
    if not SUGGESTIONS_PATH.exists():
        return jsonify({"error": "Suggestion data not found."}), 404
    data = _load_suggestions()
    blocks = data.get("blocks", [])
    if block_index < 1 or block_index > len(blocks):
        return jsonify({"error": "Block index out of range."}), 404
    return jsonify({"block": blocks[block_index - 1]})


@app.get("/api/suggestions/practice")
def suggestion_practice() -> object:
    if not SUGGESTIONS_PATH.exists():
        return jsonify({"error": "Suggestion data not found."}), 404
    data = _load_suggestions()
    practice_blocks = data.get("practice_blocks", [])
    return jsonify({"practice_blocks": practice_blocks})


@app.get("/api/incorrect-prefixes")
def incorrect_prefixes() -> object:
    return jsonify({"prefixes": _load_incorrect_prefixes()})


@app.post("/api/participant")
def save_participant() -> object:
    payload = request.get_json(silent=True) or {}
    participant_id = payload.get("participant_id")
    if not participant_id:
        return jsonify({"error": "Missing participant_id."}), 400

    if "event_type" not in payload:
        payload["event_type"] = "consent"

    try:
        _append_csv(str(participant_id), "participants", payload)
        _append_google_event("participants", payload)
    except (OSError, RuntimeError, ValueError, gspread.exceptions.GSpreadException) as exc:
        error_type = type(exc).__name__
        message = f"Failed to save participant ({error_type}): {exc}"
        return jsonify({"error": message}), 500

    return jsonify({"status": "ok"})


@app.post("/api/events")
def save_events() -> object:
    payload = request.get_json(silent=True) or {}
    participant_id = payload.get("participant_id")
    events = payload.get("events")
    if not participant_id or not isinstance(events, list):
        return jsonify({"error": "Missing participant_id or events."}), 400

    saved = 0
    try:
        for event in events:
            dataset = event.get("dataset")
            row = event.get("row")
            if dataset not in CSV_HEADERS or not isinstance(row, dict):
                continue
            if "participant_id" not in row:
                row["participant_id"] = participant_id
            _append_csv(str(participant_id), dataset, row)
            _append_google_event(dataset, row)
            saved += 1
    except (OSError, RuntimeError, ValueError, gspread.exceptions.GSpreadException) as exc:
        error_type = type(exc).__name__
        message = f"Failed to save events ({error_type}): {exc}"
        return jsonify({"error": message, "saved": saved}), 500

    return jsonify({"status": "ok", "saved": saved})


@app.get("/static/<path:filename>")
def static_files(filename: str) -> object:
    return send_from_directory(app.static_folder, filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)

