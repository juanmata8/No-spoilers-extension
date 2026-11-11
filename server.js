const http = require("node:http");

const port = Number(process.env.PORT || 3000);
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "Antigravity";
const allowedOrigins = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com"
]);

function writeJson(response, statusCode, body, origin) {
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function formatMessages(messages) {
  return messages
    .map((message, index) => `${index + 1}. ${message.role}: ${message.content}`)
    .join("\n\n");
}

async function askGemini(prompt, responseMimeType) {
  console.log(`Sending request to Gemini model ${model}.`);
  console.log("--- Message sent to Gemini ---");
  console.log(prompt);
  console.log("--- End message sent to Gemini ---");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: responseMimeType ? { responseMimeType } : undefined
    }),
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    method: "POST"
    }
  );

  const data = await response.json();
  if (!response.ok) {
    console.error("Gemini API error:", data);
    throw new Error(data.error?.message || "The Gemini API request failed.");
  }

  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("") || "No analysis was returned.";
}

async function classifyAnswer(question, answer) {
  const prompt = [
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
  const responseText = await askGemini(prompt, "application/json");
  const result = JSON.parse(responseText);
  return {
    answersQuestion: result.isQuestion === true && result.answersQuestion === true,
    isQuestion: result.isQuestion === true
  };
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  console.log(`${request.method} ${request.url} from ${origin || "unknown origin"}`);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (request.method === "OPTIONS") {
    writeJson(response, 204, {}, origin);
    return;
  }

  if (request.method !== "POST" || !["/analyze", "/classify"].includes(request.url)) {
    writeJson(response, 404, { error: "Not found." }, origin);
    return;
  }

  if (!apiKey) {
    console.error("Cannot analyse request: GEMINI_API_KEY is not set in this server process.");
    writeJson(response, 500, { error: "GEMINI_API_KEY is not configured on the server." }, origin);
    return;
  }

  try {
    const payload = JSON.parse(await readRequestBody(request));
    if (request.url === "/classify") {
      if (typeof payload.question !== "string" || !payload.question.trim() ||
          typeof payload.answer !== "string" || !payload.answer.trim()) {
        writeJson(response, 400, { error: "Provide a question and an answer." }, origin);
        return;
      }

      const classification = await classifyAnswer(payload.question, payload.answer);
      console.log(`Gemini classification result: isQuestion=${classification.isQuestion}, answersQuestion=${classification.answersQuestion}.`);
      writeJson(response, 200, classification, origin);
      return;
    }

    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) {
      console.error("Rejected analysis request: invalid message count.");
      writeJson(response, 400, { error: "Provide between 1 and 200 messages." }, origin);
      return;
    }

    const validMessages = messages.every((message) => (
      message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.length > 0 &&
      message.content.length <= 100_000
    ));
    if (!validMessages) {
      console.error("Rejected analysis request: invalid message content.");
      writeJson(response, 400, { error: "Each message must have a valid role and content." }, origin);
      return;
    }

    const analysis = await analyseConversation(messages);
    console.log("Gemini analysis completed successfully.");
    writeJson(response, 200, { analysis }, origin);
  } catch (error) {
    console.error("Analysis request failed:", error);
    writeJson(response, 500, { error: error.message || "Unexpected server error." }, origin);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Conversation analysis server listening on http://127.0.0.1:${port}`);
  console.log(`Gemini API key configured: ${Boolean(apiKey)}; model: ${model}`);
});
