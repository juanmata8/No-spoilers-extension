(function () {
  "use strict";

  const userSelector = '[data-message-author-role="user"], [data-message-role="user"]';
  const answerClassificationAttribute = "data-answer-classification";
  const answerRevealedAttribute = "data-answer-revealed";
  const answerBannerAttribute = "data-answer-banner";
  const provisionalBannerAttribute = "data-provisional-answer-banner";
  const classificationTimers = new WeakMap();
  const classificationTimeouts = new WeakMap();

  function getMessageText(message) {
    const contentSelector = message.matches(userSelector)
      ? "[data-user-message-copy]"
      : "[data-assistant-markdown]";
    const content = message.querySelector(contentSelector) || message;
    const copy = content.cloneNode(true);
    copy.querySelectorAll(`[role="alertdialog"]`)
      .forEach((element) => element.remove());
    return copy.textContent.trim();
  }

  function revealAnswer(message, banner) {
    message.setAttribute(answerRevealedAttribute, "true");
    banner.remove();
    message.style.position = "";
  }

  function removeAnswerBanner(message) {
    const content = message.querySelector("[data-assistant-markdown]") || message;
    content.querySelector(`[${answerBannerAttribute}]`)?.remove();
    content.querySelector(`[${provisionalBannerAttribute}]`)?.remove();
    content.style.position = "";
  }

  function addProvisionalBanner(message) {
    const content = message.querySelector("[data-assistant-markdown]") || message;
    if (content.hasAttribute(answerRevealedAttribute) || content.querySelector(`[${answerBannerAttribute}], [${provisionalBannerAttribute}]`)) {
      return;
    }

    const banner = document.createElement("div");
    banner.setAttribute(provisionalBannerAttribute, "true");
    banner.style.cssText = "align-items:center;background:linear-gradient(135deg,#eef4ff,#f7faff);border:1px solid #8eacff;border-radius:12px;box-shadow:0 8px 24px rgba(48,83,170,.2);color:#243b72;display:flex;font:600 13px system-ui;gap:10px;justify-content:center;inset:8px;padding:16px;position:absolute;text-align:center;z-index:20;";
    banner.innerHTML = '<span style="font-size:20px">✦</span><span>Checking this response to support your learning…</span>';
    content.style.position = "relative";
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
    banner.style.cssText = "align-items:center;background:linear-gradient(135deg,#fff8e6,#fffdf7);border:1px solid #e6b84d;border-radius:12px;box-shadow:0 8px 24px rgba(170,119,24,.2);color:#624916;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;inset:8px;padding:16px;position:absolute;text-align:center;z-index:20;";

    const text = document.createElement("span");
    text.textContent = "The answer is being provided: do you want to see it?";

    const yesButton = document.createElement("button");
    yesButton.type = "button";
    yesButton.textContent = "Yes";
    yesButton.addEventListener("click", () => revealAnswer(content, banner));

    const noButton = document.createElement("button");
    noButton.type = "button";
    noButton.textContent = "No";
    noButton.addEventListener("click", () => {
      text.textContent = "Else prompt something else and continue learning.";
      yesButton.remove();
      noButton.remove();
    });

    banner.append(text, yesButton, noButton);
    content.style.position = "relative";
    content.append(banner);
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
        removeAnswerBanner(message);
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
      if (message.getAttribute("data-message-role") !== "assistant" ||
          message.hasAttribute(answerRevealedAttribute)) {
        return;
      }

      const question = turns[index - 1];
      if (!question || question.getAttribute("data-message-role") !== "user") {
        return;
      }

      addProvisionalBanner(message);
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