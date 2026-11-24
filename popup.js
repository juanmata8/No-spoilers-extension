"use strict";

const models = [
  { id: "typesafe/jev-latest", name: "Our optimised Jev", provider: "Typesafe · V5, threshold 0.695", accuracy: 95.7, free: true, description: "Bring your Typesafe API key." },
  { id: "gemini/gemini-flash-lite-latest", name: "Our optimised Gemini", provider: "Google Gemini · V5", accuracy: 96.7, free: true, description: "Bring your Google AI API key." },
  { id: "gemini/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", provider: "Google Gemini · V5", accuracy: 97, free: true },
  { id: "anthropic/claude-haiku-5-5", name: "Claude Haiku 5.5", provider: "Anthropic · Baseline", accuracy: 95.3, free: true, description: "Bring your Anthropic API key." },
  { id: "proprietary", name: "Our proprietary model", provider: "Conversation Guard Premium", accuracy: 99.6, free: false, description: "Our highest-performing detection model. $1 per 100 answers.", premium: true }
];
let selected;
let keys = {};
const cards = document.getElementById("cards");
const config = document.getElementById("config");
const key = document.getElementById("api-key");

function showError(text) {
  const error = document.getElementById("startup-error");
  error.textContent = text;
  error.style.display = "block";
}

function save(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => chrome.runtime.lastError
      ? reject(chrome.runtime.lastError)
      : resolve());
  });
}

function buildCards() {
  cards.innerHTML = models.map(model => `<article class="card${model.premium ? " premium" : ""}" data-id="${model.id}" role="radio" tabindex="0" aria-checked="false"><div class="card-top"><div><div class="name">${model.name}</div><div class="provider">${model.provider}</div><div class="identifier">${model.id}</div></div><div class="accuracy">${model.accuracy}%</div></div>${model.description ? `<div class="description">${model.description}</div>` : ""}<span class="badge">${model.free ? "FREE · own key" : "PREMIUM · $1 / 100 answers"}</span><div class="bar"><div class="fill" style="width:${model.accuracy}%"></div></div></article>`).join("");
}

function render() {
  cards.querySelectorAll(".card").forEach(card => {
    const isSelected = card.dataset.id === selected;
    card.classList.toggle("selected", isSelected);
    card.setAttribute("aria-checked", String(isSelected));
  });
  const current = models.find(model => model.id === selected) || models[1];
  document.getElementById("active-model").textContent = current.name;
  if (current.free) {
    config.classList.add("visible");
    document.getElementById("key-label").textContent = `${current.provider.split(" · ")[0]} API key`;
    document.getElementById("configured").textContent = keys[current.id] ? "✓ API key configured" : "No API key configured";
    key.value = "";
  } else {
    config.classList.remove("visible");
  }
}

async function select(id) {
  selected = id;
  document.getElementById("message").textContent = "";
  try {
    await save({ selectedModel: id });
    render();
  } catch (error) {
    showError("Could not save your model selection.");
  }
}

document.getElementById("toggle-key").addEventListener("click", () => {
  key.type = key.type === "password" ? "text" : "password";
  document.getElementById("toggle-key").textContent = key.type === "password" ? "Show" : "Hide";
});

// Click a card to select it
cards.addEventListener("click", e => {
  const card = e.target.closest(".card");
  if (card) select(card.dataset.id);
});

// Enter or Space selects a card that has keyboard focus
cards.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".card");
  if (!card) return;
  e.preventDefault();
  select(card.dataset.id);
});

// Make the glow follow the mouse
cards.addEventListener("pointermove", e => {
  const card = e.target.closest(".card");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--x", `${e.clientX - r.left}px`);
  card.style.setProperty("--y", `${e.clientY - r.top}px`);
});

document.getElementById("save-key").addEventListener("click", async () => {
  const value = key.value.trim();
  const message = document.getElementById("message");
  if (!value) {
    message.textContent = "Enter an API key before saving.";
    message.className = "message error";
    return;
  }
  keys[selected] = value;
  try {
    await save({ apiKeys: keys });
    message.textContent = "API key saved securely in extension storage.";
    message.className = "message success";
    render();
  } catch (error) {
    message.textContent = "Could not save the API key.";
    message.className = "message error";
  }
});

document.getElementById("remove-key").addEventListener("click", async () => {
  delete keys[selected];
  const message = document.getElementById("message");
  try {
    await save({ apiKeys: keys });
    message.textContent = "API key removed.";
    message.className = "message success";
    render();
  } catch (error) {
    message.textContent = "Could not remove the API key.";
    message.className = "message error";
  }
});

chrome.storage.local.get(["selectedModel", "apiKeys"], settings => {
  if (chrome.runtime.lastError) {
    showError("Storage is unavailable. Reload the extension and try again.");
    return;
  }
  selected = settings.selectedModel || "gemini/gemini-flash-lite-latest";
  if (!models.some(m => m.id === selected)) selected = models[1].id;
  keys = settings.apiKeys || {};
  buildCards();
  render();
});
