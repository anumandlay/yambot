const goalEl = document.getElementById("goal");
const logEl = document.getElementById("log");
const statusBar = document.getElementById("status-bar");
const statusLabel = document.getElementById("status-label");
const stepLabel = document.getElementById("step-label");
const askBox = document.getElementById("ask-box");
const askQuestion = document.getElementById("ask-question");
const askInput = document.getElementById("ask-input");
const resultBox = document.getElementById("result-box");
const resultText = document.getElementById("result-text");
const viewMain = document.getElementById("view-main");
const viewSettings = document.getElementById("view-settings");
const errorBanner = document.getElementById("error-banner");
const errorBannerTitle = document.getElementById("error-banner-title");
const errorBannerDetail = document.getElementById("error-banner-detail");
const errorBannerHint = document.getElementById("error-banner-hint");

const btnStart = document.getElementById("btn-start");
const btnPause = document.getElementById("btn-pause");
const btnResume = document.getElementById("btn-resume");
const btnStop = document.getElementById("btn-stop");
const btnAnswer = document.getElementById("btn-answer");
const btnClear = document.getElementById("btn-clear");
const btnSettings = document.getElementById("btn-settings");
const btnBack = document.getElementById("btn-back");
const btnSave = document.getElementById("btn-save");
const btnTestLlm = document.getElementById("btn-test-llm");
const btnPoll = document.getElementById("btn-poll");
const btnLogin = document.getElementById("btn-login");
const btnLogout = document.getElementById("btn-logout");
const btnDismissError = document.getElementById("btn-dismiss-error");
const saveMsg = document.getElementById("save-msg");
const llmTestAlert = document.getElementById("llm-test-alert");
const llmTestTitle = document.getElementById("llm-test-title");
const llmTestDetail = document.getElementById("llm-test-detail");
const llmTestHint = document.getElementById("llm-test-hint");
const authSignedIn = document.getElementById("auth-signed-in");
const authSignedEmail = document.getElementById("auth-signed-email");
const authLoginForm = document.getElementById("auth-login-form");
const authAlert = document.getElementById("auth-alert");
const authAlertTitle = document.getElementById("auth-alert-title");
const authAlertDetail = document.getElementById("auth-alert-detail");
const authAlertHint = document.getElementById("auth-alert-hint");

let port = null;

function connect() {
  port = chrome.runtime.connect({ name: "sidepanel" });
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    appendLog("system", "Disconnected from background. Reconnecting…");
    setTimeout(connect, 500);
  });
}

function send(msg) {
  port?.postMessage(msg);
}

function formatErrorText(msg) {
  const title = msg.title || "Error";
  const detail = msg.detail || msg.error || msg.message || "Something went wrong";
  const parts = [title, detail];
  if (msg.hint) parts.push(`Hint: ${msg.hint}`);
  if (msg.status) parts.push(`HTTP ${msg.status}`);
  if (msg.url) parts.push(`URL: ${msg.url}`);
  return parts.join("\n");
}

function showErrorBanner(msg) {
  errorBanner.classList.remove("hidden");
  errorBannerTitle.textContent = msg.title || "Error";
  errorBannerDetail.textContent = msg.detail || msg.error || msg.message || "Something went wrong";
  if (msg.hint) {
    errorBannerHint.textContent = msg.hint;
    errorBannerHint.classList.remove("hidden");
  } else {
    errorBannerHint.textContent = "";
    errorBannerHint.classList.add("hidden");
  }
}

function hideErrorBanner() {
  errorBanner.classList.add("hidden");
}

function showLlmTestAlert({ kind, title, detail, hint }) {
  llmTestAlert.classList.remove("hidden", "ok", "error", "pending");
  llmTestAlert.classList.add(kind);
  llmTestTitle.textContent = title;
  llmTestDetail.textContent = detail || "";
  if (hint) {
    llmTestHint.textContent = hint;
    llmTestHint.classList.remove("hidden");
  } else {
    llmTestHint.textContent = "";
    llmTestHint.classList.add("hidden");
  }
}

function onMessage(msg) {
  if (msg.agent) syncControls(msg.agent);

  switch (msg.type) {
    case "agent:started":
      hideErrorBanner();
      appendLog("system", "Agent started");
      resultBox.classList.add("hidden");
      break;
    case "agent:thinking":
      appendLog(
        "think",
        `Observing ${msg.observation?.title || ""} (${msg.observation?.url || ""})`
      );
      break;
    case "agent:decision":
      appendLog("decision", formatAction(msg.action), msg.thought);
      break;
    case "agent:step":
      appendLog(
        "step",
        `Step ${msg.step}: ${msg.action?.type} → ${summarizeResult(msg.result)}`,
        msg.thought,
        msg.result?.error ? "error" : undefined
      );
      if (msg.result?.error) {
        showErrorBanner({
          title: `Step ${msg.step} failed`,
          detail: msg.result.error,
          hint: "The agent will keep going unless this blocks the goal.",
        });
      }
      break;
    case "agent:ask_user":
      showAsk(msg.question);
      appendLog("ask", msg.question);
      break;
    case "agent:captcha":
      appendLog("captcha", `CAPTCHA: ${msg.status}`);
      break;
    case "agent:done":
      resultBox.classList.remove("hidden");
      resultText.textContent = msg.summary || "Done";
      appendLog("done", msg.summary || "Done");
      hideAsk();
      break;
    case "agent:error":
      showErrorBanner(msg);
      appendLog("error", formatErrorText(msg));
      break;
    case "agent:stopped":
      appendLog("system", "Stopped");
      hideAsk();
      break;
    case "agent:paused":
      appendLog("system", "Paused");
      break;
    case "agent:resumed":
      appendLog("system", "Resumed");
      break;
    case "error":
      showErrorBanner(msg);
      appendLog("error", formatErrorText(msg));
      break;
    case "agent:cloud_claimed":
      appendLog("system", `Claimed cloud task: ${msg.goal}`);
      break;
    case "auth:login:result":
      btnLogin.disabled = false;
      if (msg.ok) {
        showAuthAlert({
          kind: "ok",
          title: "Signed in",
          detail: msg.user?.email || "Login successful",
        });
        syncAuthUi({ signedIn: true, email: msg.user?.email || "" });
        document.getElementById("auth-password").value = "";
      } else {
        showAuthAlert({
          kind: "error",
          title: msg.title || "Login failed",
          detail: msg.detail || msg.error || msg.message || "Could not sign in",
          hint: msg.hint || "",
        });
      }
      break;
    case "auth:logout:result":
      syncAuthUi({ signedIn: false, email: "" });
      showAuthAlert({
        kind: "ok",
        title: "Signed out",
        detail: "Extension will stop claiming cloud tasks until you sign in again.",
      });
      break;
    case "auth:state":
      syncAuthUi({ signedIn: msg.signedIn, email: msg.email || "" });
      break;
    case "llm:test:pending":
      btnTestLlm.disabled = true;
      showLlmTestAlert({
        kind: "pending",
        title: "Testing connection…",
        detail: "Sending a small request to your LLM provider.",
      });
      break;
    case "llm:test:result":
      btnTestLlm.disabled = false;
      if (msg.ok) {
        showLlmTestAlert({
          kind: "ok",
          title: "Connection successful",
          detail: `Model: ${msg.model}\nReply: ${msg.reply}`,
          hint: msg.baseUrl ? `Endpoint: ${msg.baseUrl}` : "",
        });
      } else {
        showLlmTestAlert({
          kind: "error",
          title: msg.title || "Connection failed",
          detail: msg.detail || msg.error || msg.message || "Unknown error",
          hint: [msg.hint, msg.url ? `Tried: ${msg.url}` : ""].filter(Boolean).join(" · "),
        });
      }
      break;
    default:
      break;
  }
}

function formatAction(action) {
  if (!action) return "(no action)";
  const { type, ...rest } = action;
  return `${type} ${JSON.stringify(rest)}`;
}

function summarizeResult(result) {
  if (!result) return "";
  if (result.error) return `error: ${result.error}`;
  if (result.finished) return "finished";
  if (result.navigated) return `navigated ${result.navigated}`;
  if (result.userAnswer) return `user: ${result.userAnswer}`;
  if (result.ok) return "ok";
  return JSON.stringify(result).slice(0, 120);
}

function appendLog(kind, text, thought, forceClass) {
  const li = document.createElement("li");
  if (kind === "error" || forceClass === "error") li.classList.add("is-error");
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${new Date().toLocaleTimeString()} · ${kind}`;
  li.appendChild(meta);
  if (thought) {
    const t = document.createElement("div");
    t.className = "thought";
    t.textContent = thought;
    li.appendChild(t);
  }
  const body = document.createElement("div");
  body.textContent = text;
  li.appendChild(body);
  logEl.appendChild(li);
  logEl.scrollTop = logEl.scrollHeight;
}

function syncControls(agent) {
  const status = agent.status || "idle";
  statusBar.className = `status ${status}`;
  statusLabel.textContent = status.replaceAll("_", " ");
  stepLabel.textContent = agent.step ? `Step ${agent.step}/${agent.maxSteps}` : "";

  const busy = agent.running || status === "running" || status === "waiting_user";
  btnStart.disabled = busy;
  btnPause.disabled = !agent.running || status === "paused" || status === "waiting_user";
  btnResume.disabled = status !== "paused";
  btnStop.disabled = !agent.running && status !== "waiting_user" && status !== "paused";

  if (agent.waitingForUser?.question) showAsk(agent.waitingForUser.question);
  else if (status !== "waiting_user") hideAsk();
}

function showAsk(question) {
  askBox.classList.remove("hidden");
  askQuestion.textContent = question || "Agent needs your input";
  askInput.focus();
}

function hideAsk() {
  askBox.classList.add("hidden");
  askInput.value = "";
}

btnStart.addEventListener("click", async () => {
  const goal = goalEl.value.trim();
  if (!goal) {
    showErrorBanner({
      title: "Task required",
      detail: "Enter a task before starting the agent.",
      hint: "Example: Research X on Google and summarize the top 3 links.",
    });
    appendLog("error", "Enter a task first");
    return;
  }
  hideErrorBanner();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  send({ type: "START", goal, tabId: tab?.id });
});

btnPause.addEventListener("click", () => send({ type: "PAUSE" }));
btnResume.addEventListener("click", () => send({ type: "RESUME" }));
btnStop.addEventListener("click", () => send({ type: "STOP" }));
btnAnswer.addEventListener("click", () => {
  send({ type: "USER_ANSWER", text: askInput.value });
  hideAsk();
});
askInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    send({ type: "USER_ANSWER", text: askInput.value });
    hideAsk();
  }
});
btnClear.addEventListener("click", () => {
  logEl.innerHTML = "";
  resultBox.classList.add("hidden");
  hideErrorBanner();
});
btnDismissError.addEventListener("click", hideErrorBanner);

btnSettings.addEventListener("click", async () => {
  viewMain.classList.add("hidden");
  viewSettings.classList.remove("hidden");
  await loadSettings();
});
btnBack.addEventListener("click", () => {
  viewSettings.classList.add("hidden");
  viewMain.classList.remove("hidden");
});

function showAuthAlert({ kind, title, detail, hint }) {
  authAlert.classList.remove("hidden", "ok", "error", "pending");
  authAlert.classList.add(kind);
  authAlertTitle.textContent = title;
  authAlertDetail.textContent = detail || "";
  if (hint) {
    authAlertHint.textContent = hint;
    authAlertHint.classList.remove("hidden");
  } else {
    authAlertHint.textContent = "";
    authAlertHint.classList.add("hidden");
  }
}

/**
 * Toggles signed-in vs login form visibility.
 * @param {{ signedIn: boolean, email?: string }} state
 */
function syncAuthUi({ signedIn, email }) {
  if (signedIn) {
    authSignedIn.classList.remove("hidden");
    authSignedEmail.textContent = email || "Account connected";
    authLoginForm.classList.add("hidden");
    btnLogout.classList.remove("hidden");
  } else {
    authSignedIn.classList.add("hidden");
    authLoginForm.classList.remove("hidden");
    btnLogout.classList.add("hidden");
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    "apiBaseUrl",
    "authToken",
    "authEmail",
    "llmApiKey",
    "llmBaseUrl",
    "llmModel",
    "dbcUsername",
    "dbcPassword",
    "maxSteps",
    "confirmBeforeSubmit",
  ]);
  document.getElementById("api-base").value = data.apiBaseUrl || "https://bot.vughy.com";
  document.getElementById("auth-email").value = data.authEmail || "";
  document.getElementById("llm-key").value = data.llmApiKey || "";
  document.getElementById("llm-base").value = data.llmBaseUrl || "https://api.minimax.io/v1";
  document.getElementById("llm-model").value = data.llmModel || "MiniMax-M2.7";
  document.getElementById("dbc-user").value = data.dbcUsername || "";
  document.getElementById("dbc-pass").value = data.dbcPassword || "";
  document.getElementById("max-steps").value = data.maxSteps || 25;
  document.getElementById("confirm-submit").checked = data.confirmBeforeSubmit === true;
  syncAuthUi({ signedIn: Boolean(data.authToken), email: data.authEmail || "" });
}

btnSave.addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiBaseUrl: document.getElementById("api-base").value.trim() || "https://bot.vughy.com",
    llmApiKey: document.getElementById("llm-key").value.trim(),
    llmBaseUrl: document.getElementById("llm-base").value.trim() || "https://api.minimax.io/v1",
    llmModel: document.getElementById("llm-model").value.trim() || "MiniMax-M2.7",
    dbcUsername: document.getElementById("dbc-user").value.trim(),
    dbcPassword: document.getElementById("dbc-pass").value,
    maxSteps: Number(document.getElementById("max-steps").value) || 25,
    confirmBeforeSubmit: document.getElementById("confirm-submit").checked,
  });
  saveMsg.textContent = "Saved";
  setTimeout(() => {
    saveMsg.textContent = "";
  }, 1500);
});

btnLogin?.addEventListener("click", () => {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!email || !password) {
    showAuthAlert({
      kind: "error",
      title: "Missing credentials",
      detail: "Enter both email and password.",
    });
    return;
  }
  btnLogin.disabled = true;
  showAuthAlert({
    kind: "pending",
    title: "Signing in…",
    detail: "Contacting YamBot API",
  });
  send({
    type: "LOGIN",
    apiBaseUrl: document.getElementById("api-base").value.trim() || "https://bot.vughy.com",
    email,
    password,
  });
});

btnLogout?.addEventListener("click", () => send({ type: "LOGOUT" }));

btnPoll?.addEventListener("click", () => send({ type: "POLL_NOW" }));

btnTestLlm.addEventListener("click", () => {
  btnTestLlm.disabled = true;
  showLlmTestAlert({
    kind: "pending",
    title: "Testing connection…",
    detail: "Sending a small request to your LLM provider.",
  });
  send({
    type: "TEST_LLM",
    config: {
      apiKey: document.getElementById("llm-key").value.trim(),
      baseUrl: document.getElementById("llm-base").value.trim() || "https://api.openai.com/v1",
      model: document.getElementById("llm-model").value.trim() || "gpt-4o-mini",
    },
  });
});

connect();
send({ type: "GET_STATE" });
send({ type: "GET_AUTH" });
