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
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to record result.");
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

  try {
    await postElapsed(existingStartIso, endIso, elapsedMs);
    statusEl.textContent = `Recorded ${formatElapsed(elapsedMs)} to test_results.txt.`;
  } catch (error) {
    setError(error.message);
    return;
  } finally {
    clearStart();
  }

  updateUiForReady();
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

