chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "classify") return;
  chrome.storage.local.get(["selectedModel", "apiKeys"], async ({ selectedModel, apiKeys = {} }) => {
    try {
      const modelId = selectedModel || "gemini/gemini-flash-lite-latest";
      const key = apiKeys[modelId];
      if (!key) throw new Error("No API key configured for " + modelId);
      const [provider, model] = modelId.split("/");
      const prompt = buildPrompt(msg.question, msg.answer); // move the prompt from server.js classifyAnswer
      const result = provider === "gemini"    ? await askGemini(model, key, prompt)
                   : provider === "anthropic" ? await askClaude(model, key, prompt)
                   : (() => { throw new Error("Unsupported provider: " + provider); })();
      sendResponse({
        isQuestion: result.isQuestion === true,
        answersQuestion: result.isQuestion === true && result.answersQuestion === true
      });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  });
  return true; // keeps sendResponse open for the async work
});

const classificationSchema = {
  type: "object",
  properties: {
    isQuestion: { type: "boolean" },
    answersQuestion: { type: "boolean" }
  },
  required: ["isQuestion", "answersQuestion"],
  additionalProperties: false
};

function buildPrompt(question, answer) {
  return [
    "Classify whether the user message is an actual question or explicit request that expects an answer.",
    "Statements, opinions, compliments, greetings, personal preferences, and conversational remarks are not questions.",
    "Only if the user message is an actual question or explicit request, decide whether the assistant directly answers it.",
    "Example non-question: User: I like Poland. Assistant: Poland is a great country. Result: isQuestion=false, answersQuestion=false.",
    "Example non-question: User: I also like Slovenia. Assistant: Slovenia is beautiful. Result: isQuestion=false, answersQuestion=false.",
    "Example question: User: What is the capital of Poland? Assistant: Warsaw is the capital of Poland. Result: isQuestion=true, answersQuestion=true.",
    "Return JSON only in exactly this shape: {\"isQuestion\":true,\"answersQuestion\":true}.",
    "For a non-question, return {\"isQuestion\":false,\"answersQuestion\":false}.",
    "For an unanswered question, return {\"isQuestion\":true,\"answersQuestion\":false}.",
    "",
    `User question: ${question}`,
    `Assistant answer: ${answer}`
  ].join("\n");
}

async function askGemini(model, apiKey, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(15000)
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Gemini request failed (${response.status})`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no classification.");
  return JSON.parse(text);
}

async function askClaude(model, apiKey, prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: classificationSchema }
      },
      messages: [{ role: "user", content: prompt }]
    }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Anthropic request failed (${response.status})`);
  }
  if (data.stop_reason === "refusal") throw new Error("Anthropic declined the request.");
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned no classification.");
  return JSON.parse(text);
}
