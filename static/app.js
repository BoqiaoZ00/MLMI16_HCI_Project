const button = document.getElementById("timerButton");
const statusEl = document.getElementById("status");

const storageKey = "timerStartIso";

const updateUiForReady = () => {
  button.textContent = "Start timer";
  statusEl.textContent = "Ready. Click the button to start.";
};

const updateUiForRunning = (startIso) => {
  button.textContent = "Stop + record";
  statusEl.textContent = `Started at ${startIso}. Click again to record.`;
};

const setError = (message) => {
  statusEl.textContent = message;
};

const postElapsed = async (startIso, endIso, elapsedMs) => {
  const response = await fetch("/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      start_iso: startIso,
      end_iso: endIso,
      elapsed_ms: elapsedMs,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = "Failed to record result.";
    if (text) {
      try {
        const data = JSON.parse(text);
        message = data.error || text;
      } catch {
        message = text;
      }
    }
    throw new Error(message);
  }
};

const clearStart = () => {
  localStorage.removeItem(storageKey);
};

const getStartIso = () => localStorage.getItem(storageKey);

const setStartIso = (value) => {
  localStorage.setItem(storageKey, value);
};

const formatElapsed = (elapsedMs) => {
  const seconds = Math.round(elapsedMs / 1000);
  return `${seconds}s`;
};

const handleClick = async () => {
  const existingStartIso = getStartIso();

  if (!existingStartIso) {
    const startIso = new Date().toISOString();
    setStartIso(startIso);
    updateUiForRunning(startIso);
    return;
  }

  const endIso = new Date().toISOString();
  const elapsedMs = Date.parse(endIso) - Date.parse(existingStartIso);

  // Optimistic UI: reset immediately, then report outcome when the write completes.
  clearStart();
  updateUiForReady();
  statusEl.textContent = `Saving ${formatElapsed(elapsedMs)}...`;

  postElapsed(existingStartIso, endIso, elapsedMs)
    .then(() => {
      statusEl.textContent = `Saved ${formatElapsed(elapsedMs)}.`;
    })
    .catch((error) => {
      setError(error.message);
    });
};

button.addEventListener("click", () => {
  handleClick().catch((error) => setError(error.message));
});

const existingStartIso = getStartIso();
if (existingStartIso) {
  updateUiForRunning(existingStartIso);
} else {
  updateUiForReady();
}

