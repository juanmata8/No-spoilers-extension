# ChatGPT conversation analysis

## Run the backend

Node.js 18 or newer is required.

In PowerShell, set the API key for the current terminal and start the server:

```powershell
$env:GEMINI_API_KEY = "your-api-key"
npm start
```

The backend listens on `http://127.0.0.1:3000` and keeps the API key on the server.

## Load the extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Refresh the ChatGPT tab.
5. Ask a question in ChatGPT and wait for the response to finish.

The extension automatically sends each completed user question and following assistant answer to the local backend. Gemini decides whether the answer addresses the question. When it does, the answer is covered until **Yes** is pressed.
