from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
import gspread
from google.oauth2.service_account import Credentials

APP_DIR = Path(__file__).resolve().parent
def _default_results_path() -> Path:
    if os.environ.get("VERCEL") or os.environ.get("VERCEL_ENV"):
        return Path("/tmp/test_results.txt")
    return APP_DIR / "test_results.txt"


RESULTS_PATH = Path(os.environ.get("RESULTS_PATH", str(_default_results_path())))
SHEET_ID = os.environ.get("GOOGLE_SHEET_ID")
SHEET_NAME = os.environ.get("GOOGLE_SHEET_NAME", "Sheet1")
SERVICE_ACCOUNT_JSON = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")


def _append_to_google_sheet(row: list[str]) -> None:
    if not SHEET_ID or not SERVICE_ACCOUNT_JSON:
        raise RuntimeError("Missing GOOGLE_SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON.")

    creds_info = json.loads(SERVICE_ACCOUNT_JSON)
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    credentials = Credentials.from_service_account_info(creds_info, scopes=scopes)
    client = gspread.authorize(credentials)
    worksheet = client.open_by_key(SHEET_ID).worksheet(SHEET_NAME)
    worksheet.append_row(row, value_input_option="RAW")

app = Flask(__name__, static_folder=str(APP_DIR / "static"), template_folder=str(APP_DIR / "templates"))


@app.get("/")
def index() -> object:
    return send_from_directory(app.template_folder, "index.html")


@app.post("/record")
def record() -> object:
    payload = request.get_json(silent=True) or {}
    start_iso = payload.get("start_iso")
    end_iso = payload.get("end_iso")
    elapsed_ms = payload.get("elapsed_ms")

    if not start_iso or not end_iso or elapsed_ms is None:
        return jsonify({"error": "Missing required fields."}), 400

    try:
        elapsed_ms = float(elapsed_ms)
    except (TypeError, ValueError):
        return jsonify({"error": "elapsed_ms must be a number."}), 400

    now_iso = datetime.now(timezone.utc).isoformat()
    row = [now_iso, start_iso, end_iso, f"{elapsed_ms:.0f}"]
    try:
        if SHEET_ID and SERVICE_ACCOUNT_JSON:
            _append_to_google_sheet(row)
        else:
            line = (
                f"{now_iso}\tstart={start_iso}\tend={end_iso}\telapsed_ms={elapsed_ms:.0f}\n"
            )
            RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
            with RESULTS_PATH.open("a", encoding="utf-8") as handle:
                handle.write(line)
    except (OSError, RuntimeError, ValueError, gspread.exceptions.GSpreadException) as exc:
        return jsonify({"error": f"Failed to record results: {exc}"}), 500

    return jsonify({"status": "ok"})


@app.get("/static/<path:filename>")
def static_files(filename: str) -> object:
    return send_from_directory(app.static_folder, filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)

