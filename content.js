(function () {
  "use strict";

  const userSelector = '[data-message-author-role="user"], [data-message-role="user"]';
  const answerClassificationAttribute = "data-answer-classification";
  const answerRevealedAttribute = "data-answer-revealed";
  const answerBannerAttribute = "data-answer-banner";
  const provisionalBannerAttribute = "data-provisional-answer-banner";
  const classificationTimers = new WeakMap();
  // const classificationTimeouts = new WeakMap();

  function injectStyles() {
  if (document.getElementById("ns-styles")) return;
  const style = document.createElement("style");
  style.id = "ns-styles";
  style.textContent = `
    @property --ns-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }

    /* ---- shared layout ---- */
    .ns-loading, .ns-prompt {
      position: absolute; inset: 0; z-index: 20;
      display: flex; align-items: center; justify-content: center;
      padding: 16px; border-radius: 14px;
      font: 600 14px system-ui; color: #1d2b4f; text-align: center;
    }
    .ns-loading { gap: 2px; }
    .ns-prompt  {
      gap: 10px; padding: 20px;
      flex-direction: column;          /* stack vertically */
      justify-content: space-between;  /* header at top, buttons at bottom */
    }
    .ns-header { display: flex; flex-direction: column; gap: 4px;
             flex: 1; justify-content: center; }
    .ns-title    { font: 700 17px system-ui; }
    .ns-subtitle { font: 400 13px system-ui; opacity: .7; }
    .ns-actions  { display: flex; gap: 10px; justify-content: flex-start; }
    .ns-prompt.ns-hint { justify-content: center; }

    /* ---- shared frosted glass ---- */
    .ns-loading::after, .ns-prompt::after {
      content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
      background: rgba(255, 255, 255, 0.8);
      backdrop-filter: blur(14px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.45);
      box-shadow: 0 8px 32px rgba(31, 38, 135, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.5);
      pointer-events: none;
    }

    /* ---- loading: moving backlight ---- */
    .ns-loading::before {
      content: ""; position: absolute; inset: -4px; z-index: -2; border-radius: 18px;
      background: conic-gradient(from var(--ns-angle),
        transparent 0deg, #6f95ff 50deg, #8f6bff 90deg, transparent 140deg, transparent 360deg);
      filter: blur(12px); opacity: .45;
      animation: ns-spin 4s linear infinite;
      pointer-events: none;
    }
    @keyframes ns-spin { to { --ns-angle: 360deg; } }

    /* ---- prompt: static edge glow ---- */
    .ns-prompt::before {
      content: ""; position: absolute; inset: 0; border-radius: inherit;
      padding: 2px;                                   /* ring thickness */
      background: conic-gradient(from var(--ns-angle),
        transparent 0deg, #ffd36b 40deg, #ff9f43 80deg, transparent 120deg, transparent 360deg);
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;                        /* keep only the ring */
      animation: ns-spin 3s linear infinite;
      pointer-events: none;
    }
    /* .ns-prompt::after {
      border-color: rgba(255, 196, 92, 0.75);
      box-shadow:
        0 0 0 1px rgba(255, 196, 92, 0.35),        thin halo on the border
        0 0 18px 3px rgba(255, 180, 70, 0.35),     soft glow outside
        inset 0 0 14px rgba(255, 196, 92, 0.22),   soft glow just inside
        0 8px 32px rgba(31, 38, 135, 0.18);        original depth shadow
    } */

    /* ---- loading dots ---- */
    .ns-dot { display: inline-block; animation: ns-bounce 1.2s infinite ease-in-out; }
    .ns-dot:nth-child(3) { animation-delay: .15s; }
    .ns-dot:nth-child(4) { animation-delay: .3s; }
    @keyframes ns-bounce {
      0%, 80%, 100% { opacity: .25; transform: translateY(0); }
      40%           { opacity: 1;   transform: translateY(-4px); }
    }

    /* ---- buttons ---- */
    .ns-btn {
      border: 1px solid rgba(255, 255, 255, 0.6); border-radius: 999px;
      padding: 6px 16px; font: 600 13px system-ui; color: #1d2b4f; cursor: pointer;
      background: rgba(255, 255, 255, 0.35); backdrop-filter: blur(6px);
      transition: background .15s;
    }
    .ns-btn:hover { background: rgba(255, 255, 255, 0.6); }
    .ns-btn { display: inline-flex; align-items: center; gap: 6px; }
    .ns-icon {
      width: 16px; height: 16px;
      fill: none; stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round;
    }

    /* ---- dark mode ---- */
    @media (prefers-color-scheme: dark) {
      .ns-loading, .ns-prompt, .ns-btn { color: #e8ecf7; }
      .ns-loading::after, .ns-prompt::after { background: rgba(30, 32, 40, 0.5); }
      .ns-loading::after { border-color: rgba(255, 255, 255, 0.12); }
      .ns-btn { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.2); }
    }

    /* ---- reduced motion ---- */
    @media (prefers-reduced-motion: reduce) {
      .ns-loading::before, .ns-dot, .ns-prompt::before, .ns-prompt::after { animation: none; }
    }
    `;
  document.head.append(style);
}


  function getMessageText(message) {
    const contentSelector = message.matches(userSelector)
      ? "[data-user-message-copy]"
      : "[data-assistant-markdown]";
    const content = message.querySelector(contentSelector) || message;
    const copy = content.cloneNode(true);
    copy.querySelectorAll(`[role="alertdialog"], [${answerBannerAttribute}], [${provisionalBannerAttribute}]`)
      .forEach((element) => element.remove());
    return copy.textContent.trim();
  }

  function revealAnswer(message, banner) {
    message.setAttribute(answerRevealedAttribute, "true");
    banner.remove();
    message.style.position = "";
    message.style.minHeight = "";
  }

  function removeAnswerBanner(message) {
    const content = message.querySelector("[data-assistant-markdown]") || message;
    content.querySelector(`[${answerBannerAttribute}]`)?.remove();
    content.querySelector(`[${provisionalBannerAttribute}]`)?.remove();
    content.style.position = "";
    content.style.minHeight = "";
  }

  function addProvisionalBanner(message) {
    const content = message.querySelector("[data-assistant-markdown]") || message;
    if (content.hasAttribute(answerRevealedAttribute) || content.querySelector(`[${answerBannerAttribute}], [${provisionalBannerAttribute}]`)) {
      return;
    }

    const banner = document.createElement("div");
    banner.setAttribute(provisionalBannerAttribute, "true");
    banner.className = "ns-loading";
    banner.innerHTML = '<span>Analyzing response</span>' +
    '<span class="ns-dot">.</span><span class="ns-dot">.</span><span class="ns-dot">.</span>';
    content.style.position = "relative";
    content.style.minHeight = "140px";
    content.append(banner);
  }

  function addAnswerBanner(message) {
    const content = message.querySelector("[data-assistant-markdown]") || message;
    if (content.hasAttribute(answerRevealedAttribute) || content.querySelector(`[${answerBannerAttribute}]`)) {
      return;
    }

    content.querySelector(`[${provisionalBannerAttribute}]`)?.remove();

    const banner = document.createElement("div");
    banner.setAttribute("role", "alertdialog");
    banner.setAttribute(answerBannerAttribute, "true");
    banner.className = "ns-prompt";

    const text = document.createElement("span");
    text.className = "ns-title";
    text.textContent = "This reply may give the answer";

    const text2 = document.createElement("span");
    text2.className = "ns-subtitle";
    text2.textContent = "Take some time to try and solve it yourself.";

    const yesButton = document.createElement("button");
    yesButton.type = "button";
    yesButton.innerHTML =
      '<svg class="ns-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>' +
        '<circle cx="12" cy="12" r="3"/>' +
      '</svg>' +
      '<span>Show</span>';
    yesButton.className = "ns-btn";
    yesButton.addEventListener("click", () => revealAnswer(content, banner));

    const noButton = document.createElement("button");
    noButton.type = "button";
    noButton.innerHTML =
      '<svg class="ns-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M9 18h6"/>' +
        '<path d="M10 22h4"/>' +
        '<path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>' +
      '</svg>' +
      '<span>Re-prompt for hint</span>';
    noButton.className = "ns-btn";
    noButton.addEventListener("click", () => {
      text.textContent = "Prompt in a new way and continue learning.";
      actions.remove();
      banner.classList.add("ns-hint");   // switch to vertical centering
    });

    const header = document.createElement("div");
    header.className = "ns-header";
    header.append(text, text2);

    const actions = document.createElement("div");
    actions.className = "ns-actions";
    actions.append(yesButton, noButton);

    banner.append(header, actions);
    content.style.position = "relative";
    content.append(banner);
  }

  // function classifyAnswer(question, answer, message) {
  //   message.setAttribute(answerClassificationAttribute, "pending");
  //   console.log("[Answer classification] Sending question and answer to the local server.");
  //   const controller = new AbortController();
  //   classificationTimeouts.set(message, setTimeout(() => controller.abort(), 15000));
  //   fetch("http://127.0.0.1:3000/classify", {
  //     body: JSON.stringify({ question, answer }),
  //     headers: { "Content-Type": "application/json" },
  //     method: "POST",
  //     signal: controller.signal
  //   })
  //     .then((response) => {
  //       return response.json().then((data) => {
  //         if (!response.ok) {
  //           throw new Error(data.error || `Classification request failed (${response.status})`);
  //         }
  //         return data;
  //       });
  //     })
  //     .then((data) => {
  //       clearTimeout(classificationTimeouts.get(message));
  //       classificationTimeouts.delete(message);
  //       message.setAttribute(answerClassificationAttribute, data.answersQuestion ? "yes" : "no");
  //       if (data.answersQuestion) {
  //         addAnswerBanner(message);
  //       } else {
  //         removeAnswerBanner(message);
  //       }
  //     })
  //     .catch((error) => {
  //       clearTimeout(classificationTimeouts.get(message));
  //       classificationTimeouts.delete(message);
  //       message.setAttribute(answerClassificationAttribute, "unavailable");
  //       removeAnswerBanner(message);
  //       if (error.name !== "AbortError") {
  //         console.info("[Answer classification] Local analysis server is unavailable; the answer was left visible.");
  //       }
  //     });
  // }
  function classifyAnswer(question, answer, message) {
  message.setAttribute(answerClassificationAttribute, "pending");
  chrome.runtime.sendMessage({ type: "classify", question, answer }, (data) => {
    if (chrome.runtime.lastError || !data || data.error) {
      message.setAttribute(answerClassificationAttribute, "unavailable");
      removeAnswerBanner(message);
      console.info("[Answer classification] Unavailable:", chrome.runtime.lastError?.message || data?.error);
      return;
    }
    message.setAttribute(answerClassificationAttribute, data.answersQuestion ? "yes" : "no");
    if (data.answersQuestion) addAnswerBanner(message);
    else removeAnswerBanner(message);
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
      if (message.getAttribute("data-message-role") !== "assistant" ||
          message.hasAttribute(answerRevealedAttribute)) {
        return;
      }

      const question = turns[index - 1];
      if (!question || question.getAttribute("data-message-role") !== "user") {
        return;
      }

      const status = message.getAttribute(answerClassificationAttribute);
      if (status && status !== "pending") {
        return; // already classified as "yes", "no" or "unavailable": leave it alone
      }

      addProvisionalBanner(message);
      scheduleAnswerClassification(question, message);
    });
  }

  injectStyles();
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