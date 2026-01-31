from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

APP_DIR = Path(__file__).resolve().parent
RESULTS_PATH = Path("/Users/permanj/Desktop/MLMI 16 HCI/project/test_results.txt")

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
    line = f"{now_iso}\tstart={start_iso}\tend={end_iso}\telapsed_ms={elapsed_ms:.0f}\n"
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(
        RESULTS_PATH.read_text(encoding="utf-8") + line if RESULTS_PATH.exists() else line,
        encoding="utf-8",
    )

    return jsonify({"status": "ok"})


@app.get("/static/<path:filename>")
def static_files(filename: str) -> object:
    return send_from_directory(app.static_folder, filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)

