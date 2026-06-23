# NodeJS Task Matrix: 3-Agent Collaborative Workflow

This matrix breaks down tasks for 3 independent NodeJS developers to implement the CLI chatbot with dynamic command autocompletes and selection utilities.

---

## Agent 1: CLI Shell, Raw Stdin Listeners, and Routing Loop

**Objective**: Create the core executable interface that captures single key strokes, handles autocomplete menus below the prompt line, and implements selection prompts for settings.

### Action Item List
1.  **Main REPL Loop & Commands Router** (`main.js`):
    *   Initialize command router checking slash inputs.
2.  **Raw Input & Suggestions Engine**:
    *   Set `process.stdin.setRawMode(true)` to listen to `keypress` events.
    *   Identify when input starts with `/`, filter the command array (`/provider`, `/models`, etc.), and display highlighted choices in a selection block below the input line.
    *   Listen to `up`, `down`, `backspace`, and `return` events.
    *   Erase suggestions blocks cleanly from stdout using `readline.moveCursor` and `readline.clearLine` to prevent rendering artifacts.
3.  **Reusable Option Selector**:
    *   Implement an interactive `askSelection(promptText, choices)` function that renders list choices, lets users cycle them with Up/Down arrow keys, selects with Enter, and cleans up the selection prompt UI completely upon selection.
    *   Integrate this picker into `/provider` command (shows providers list) and `/models` command (shows model list dynamically fetched from the provider).
4.  **Visual Styling**:
    *   Use `chalk` to color user inputs, helper prompts, lists, and assistant stream blocks.

---

## Agent 2: Native API Fetch & Streaming Gateway

**Objective**: Build a clean provider router that makes stream queries using NodeJS's native `fetch` client, parsing responses chunk-by-chunk.

### Action Item List
1.  **Gateway Adapters** (`providers.js`):
    *   Create adapters for Google Gemini, OpenAI, Anthropic, and Ollama.
2.  **Async Iterator Interface**:
    *   Expose `async *generateStream(systemPrompt, messages, model)` returning text tokens on-the-fly.
3.  **Native Stream Parsing**:
    *   Fetch stream responses (`response.body.getReader()`) and decode chunks with `TextDecoder`.
    *   Implement line-by-line parsing for OpenAI (`data: ` SSE lines), Gemini (text segments inside chunks), Anthropic, and Ollama.

---

## Agent 3: JSON Config & Markdown Log Manager

**Objective**: Configure persistent configurations and handle export directories.

### Action Item List
1.  **JSON State Storage** (`config.js`):
    *   Persist configuration objects inside `~/.cli-chatbot/config.json`.
    *   Maintain active provider, selected model, and custom system prompt.
    *   Provide methods to write and load API keys safely.
2.  **Conversation Logger** (`history.js`):
    *   Maintain active conversation log buffer.
    *   Implement an export method to write the chat history into a cleanly formatted markdown file within the `exports/` folder.

---

## Shared Interfaces

```javascript
// config.js
export function getConfig() { ... }
export function updateConfig(key, value) { ... }
export function getApiKey(provider) { ... }
export function saveApiKey(provider, apiKey) { ... }

// history.js
export class ChatSession {
  addMessage(role, content) { ... }
  getMessages() { ... }
  clear() { ... }
  exportToMarkdown(filename) { ... }
}

// providers.js
export class ProviderManager {
  static getProvider(name, apiKey) { ... } // returns BaseProvider implementation
}
```
