(function () {
  "use strict";

  const userSelector = '[data-message-author-role="user"], [data-message-role="user"]';
  const answerClassificationAttribute = "data-answer-classification";
  const classificationTimers = new WeakMap();
  const classificationTimeouts = new WeakMap();

  function getMessageText(message) {
    const contentSelector = message.matches(userSelector)
      ? "[data-user-message-copy]"
      : "[data-assistant-markdown]";
    const content = message.querySelector(contentSelector) || message;
    const copy = content.cloneNode(true);
    copy.querySelectorAll("[data-ns-ui]")
      .forEach((element) => element.remove());
    return copy.textContent.trim();
  }

  // Option A: the held-back reply is hidden by CSS (content.css) and a card takes its place.
  const stateAttribute = "data-ns-state"; // checking | covered | shown | false | unchecked | ok
  const icons = {
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>'
  };

  function contentOf(message) {
    return message.querySelector("[data-assistant-markdown]") || message;
  }

  function el(tag, className, ...kids) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    kids.forEach((kid) => kid && element.append(kid));
    return element;
  }

  function icon(name) {
    const span = el("span", "ns-icon");
    span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
    return span;
  }

  function button(label, iconName, kind, onClick) {
    const element = el("button", `ns-btn ns-${kind}`, icon(iconName), label);
    element.type = "button";
    element.addEventListener("click", onClick);
    return element;
  }

  function setUi(content, state, ui) {
    content.querySelector(":scope > [data-ns-ui]")?.remove();
    content.setAttribute(stateAttribute, state);
    if (ui) {
      ui.setAttribute("data-ns-ui", "");
      content.prepend(ui);
    }
  }

  // Types into the host's own composer and sends, so the hint request is a normal chat message.
  function sendToChat(text) {
    const box = document.querySelector('#prompt-textarea, [contenteditable="true"][role="textbox"], textarea');
    if (!box) return;
    box.focus();
    if (box.tagName === "TEXTAREA") {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, text);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      document.execCommand("insertText", false, text);
    }
    // shortcut: ChatGPT send-button selector only; the text stays in the box if it is not found
    setTimeout(() => document.querySelector('[data-testid="send-button"], button[aria-label*="Send"]')?.click(), 150);
  }

  function renderCovered(content, note) {
    const hinted = content.dataset.nsHinted === "true";
    const card = el("section", "ns-card",
      el("div", "ns-title", icon("shield"), "This reply gives the answer"),
      el("p", "ns-sub", note || (hinted ? "Your hint is on its way below." : "Held back so you can try it yourself first. Open it whenever you like.")),
      el("div", "ns-lines", el("span"), el("span")),
      el("div", "ns-actions",
        hinted ? null : button("Hint instead", "bulb", "primary", () => {
          content.dataset.nsHinted = "true";
          sendToChat("Can you give me a hint instead of the answer? I want to work it out myself.");
          renderCovered(content);
        }),
        button("Try first", "pencil", hinted ? "primary" : "secondary", () => {
          renderCovered(content, "Take your time. Type your answer in the box below.");
          document.querySelector('#prompt-textarea, [contenteditable="true"][role="textbox"], textarea')?.focus();
        }),
        button("Show", "eye", "quiet", () => renderShown(content))));
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "No Spoilers: reply held back");
    setUi(content, "covered", card);
  }

  // "Not a spoiler" only appears once the reply is open: nobody can judge a reply they have not seen.
  function renderShown(content) {
    setUi(content, "shown", el("div", "ns-mark", icon("eye"), el("span", "ns-mark-label", "Shown"),
      button("Hide again", "undo", "quiet", () => renderCovered(content)),
      button("Not a spoiler", "flag", "quiet", () => {
        console.log("[No Spoilers] Marked not a spoiler:", content.textContent.slice(0, 120));
        setUi(content, "false", el("div", "ns-mark", icon("flag"), el("span", "ns-mark-label", "Marked not a spoiler")));
      })));
  }

  function addProvisionalBanner(message) {
    const content = contentOf(message);
    if (content.hasAttribute(stateAttribute)) return;
    setUi(content, "checking", el("div", "ns-checking", icon("shield"), "Checking this reply…"));
  }

  function addAnswerBanner(message) {
    const content = contentOf(message);
    if (["covered", "shown", "false"].includes(content.getAttribute(stateAttribute))) return;
    renderCovered(content);
  }

  function removeAnswerBanner(message, unchecked) {
    const content = contentOf(message);
    if (unchecked) {
      setUi(content, "unchecked", el("div", "ns-mark", icon("shield"), el("span", "ns-mark-label", "Not checked: No Spoilers server is offline")));
    } else {
      setUi(content, "ok", null);
    }
  }

  // The host page can re-render a message and drop our node; put it back for the current state.
  function restoreUi(message) {
    const content = contentOf(message);
    const state = content.getAttribute(stateAttribute);
    if (content.querySelector(":scope > [data-ns-ui]")) return;
    if (state === "covered") renderCovered(content);
    else if (state === "shown") renderShown(content);
    else if (state === "checking") { content.removeAttribute(stateAttribute); addProvisionalBanner(message); }
  }

  function classifyAnswer(question, answer, message) {
    message.setAttribute(answerClassificationAttribute, "pending");
    console.log("[Answer classification] Sending question and answer to the local server.");
    const controller = new AbortController();
    classificationTimeouts.set(message, setTimeout(() => controller.abort(), 15000));
    fetch("http://127.0.0.1:3000/classify", {
      body: JSON.stringify({ question, answer }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal
    })
      .then((response) => {
        return response.json().then((data) => {
          if (!response.ok) {
            throw new Error(data.error || `Classification request failed (${response.status})`);
          }
          return data;
        });
      })
      .then((data) => {
        clearTimeout(classificationTimeouts.get(message));
        classificationTimeouts.delete(message);
        message.setAttribute(answerClassificationAttribute, data.answersQuestion ? "yes" : "no");
        if (data.answersQuestion) {
          addAnswerBanner(message);
        } else {
          removeAnswerBanner(message);
        }
      })
      .catch((error) => {
        clearTimeout(classificationTimeouts.get(message));
        classificationTimeouts.delete(message);
        message.setAttribute(answerClassificationAttribute, "unavailable");
        removeAnswerBanner(message, true);
        if (error.name !== "AbortError") {
          console.info("[Answer classification] Local analysis server is unavailable; the answer was left visible.");
        }
      });
  }

  function scheduleAnswerClassification(question, message) {
    if (message.hasAttribute(answerClassificationAttribute)) {
      return;
    }

    clearTimeout(classificationTimers.get(message));
    classificationTimers.set(message, setTimeout(() => {
      classificationTimers.delete(message);
      if (!message.isConnected || message.hasAttribute(answerClassificationAttribute)) {
        return;
      }

      const answer = getMessageText(message);
      if (answer) {
        classifyAnswer(getMessageText(question), answer, message);
      }
    }, 500));
  }

  function scanCompletedAnswerPairs() {
    const turns = Array.from(document.querySelectorAll("[data-message-role]"));
    turns.forEach((message, index) => {
      if (message.getAttribute("data-message-role") !== "assistant") {
        return;
      }

      const question = turns[index - 1];
      if (!question || question.getAttribute("data-message-role") !== "user") {
        return;
      }

      addProvisionalBanner(message);
      restoreUi(message);
      scheduleAnswerClassification(question, message);
    });
  }

  scanCompletedAnswerPairs();

  const observer = new MutationObserver((mutations) => {
    scanCompletedAnswerPairs();
  });

  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true
  });
})();