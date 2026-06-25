# A.N.A.N.D - Node.js CLI Chatbot (with Multi-Agent Orchestration & Autocomplete)

A terminal-based chatbot built with Node.js that connects to Google Gemini, OpenAI, Anthropic, NVIDIA, and Ollama. It features a custom interactive shell prompt that intercepts keypresses to offer dynamic command suggestions, multi-agent capabilities, and auto-debugging.

![A.N.A.N.D Terminal CLI Chatbot](./NodeJS/Screenshot%202026-06-24%20161949.png)

---

## 🚀 Why A.N.A.N.D is a Gamechanger

Traditional AI coding assistants operate as single-agent chatbots. The user prompts the bot, copies the code output, pastes it locally, compiles/runs it, encounters errors, copy-pastes the errors back to the chatbot, and repeats this manual loop. This is slow, error-prone, and requires constant user supervision.

A.N.A.N.D changes this paradigm entirely by implementing an automated **Commander-Coding-Debugger loop**:

1.  **Zero-Touch Coding**: You define a goal. The Commander Agent plans and spawns a **Coding Agent** to directly read and write files inside your local workspace.
2.  **Autonomous Verification**: The moment files are written, a **Debugger Agent** spawns in the background. It reads the files, runs compilation checks, checks syntax, and executes test suites.
3.  **Self-Healing**: If a compile/syntax error occurs, the Debugger Agent does not report it to you; it **automatically edits the file to fix the bug** itself. Only massive design failures or requirements contradictions are escalated back to the Commander.
4.  **No Manual Copy-Pasting**: The entire cycle of writing, compiling, debugging, and fixing occurs autonomously. You only see the final, compiled, functional result.

---

## 🎯 Autonomous Modes & Status Sidebar (Latest Updates)

### 1. Autonomous Execution & Self-Healing
*   **Goal Mode (`/goal <task description>`)**: Available only in Normal Mode. Runs the target task autonomously. If compile or runtime errors occur, the agent detects them and automatically edits files to self-heal the issues without human intervention.
*   **Loop Mode (`/loop <task description>`)**: Available in both Normal and Algo modes. 
    *   *Normal Mode*: Rechecks and retries tasks automatically if errors are encountered.
    *   *Algo Mode*: If the Debugger Agent detects an error, it passes the stack trace and diagnostic root cause back to the Commander. The Commander then turns the error into a temporary subtask (preserving the original task queue) and restores normal execution once the error-task is resolved.

### 2. Dual-Column Sidebar UI Panel
The terminal screen is dynamically split into two regions:
*   **Left Pane (Chat Output)**: Shows user prompts and assistant replies.
*   **Right Pane (A.N.A.N.D Sidebar)**: A clean, border-free charcoal grey panel (`#1e1e24`) displaying:
    *   *Active Configuration*: Current chatbot mode and API model.
    *   *Live Token Usage*: Prompt, Completion, and Total tokens parsed in the last message.
    *   *Context Window Monitor*: Percentage, fraction, and a visual progress bar indicating how much of the context window has been consumed.
    *   *Dynamic TODO Checklist*: Tracks task completion state in real time: `[ ]` Todo, `[⋯]` In-progress, `[✓]` Done.

### 3. User Interrupts & Thinking Animations
*   **Stream Cancellation**: Pressing the `Esc` key or sending standard interrupt commands during active API streaming immediately halts the response stream via an `AbortController`.
*   **Thinking Prompts**: Displays randomized thinking cues (e.g., `"analyzing..."`, `"trying my best to think like a human..."`) while waiting for the stream to start.

### 4. Recent Bug Fixes & UI Polish (Latest)
*   **WebFetch & Capability Retention**: Fixed an instruction decay issue where Kimi/Moonshot models (`moonshotai/kimi-k2.6` on NVIDIA NIM) would forget capabilities (like `<search_web>` and `<browse_url>`) in longer conversations. Prepending system prompt instructions to the *last* user query instead of the first user query keeps XML capability tags fully active without template compilation errors.
*   **Zero-Tearing Side Panel**: Restrained all terminal row-clearing sequences (`clearLine` and space padding) to only clear columns within the chat pane width. This prevents typing, suggestion boxes, model pickers, and thinking animations from corrupting or erasing the right-side charcoal panel content.
*   **Dynamic Model and Context Updates**: Wired model names of spawned subagents directly to the side panel display. Added a reset state on Debugger Agent completion, and added token limit support (`262,144` context window) for StepFun models.
*   **Gemini/Anthropic Role Merging**: Added auto-merging of consecutive turns of the same role for Google Gemini and Anthropic API requests, avoiding format validation failures.
*   **Native Web Search & Browsing**: Integrated `/search-web` and `/browse-url` commands leveraging the IPC harness and `webfetch.js` to search DuckDuckGo and extract page texts.
*   **Decoupled Harness Auto-Restart**: Enabled child-process auto-restart capability (restarts on exit code 42) in `harness.js` so running the `/restart` command reloads the session instantly.
*   **Pulsing Generating Indicators & Animations**: Added a pulsing `[ESC to interrupt]` notification on the status row under the input prompt when a response is generating, alongside smooth thinking queue animations.

---

## 🏗️ System Architecture

A.N.A.N.D operates as a secure, decoupled orchestration system where the chatbot and its spawned agents communicate with the local file system and shell command runner through an IPC Capability Harness.

```mermaid
graph TD
    User([User]) <--> |Interactive Shell / Autocomplete| Commander[Commander Agent]
    subgraph Multi-Agent Orchestration Mode
        Commander -->|Spawns via XML tag| Coder[Coding Agent]
        Coder -->|IPC Request| JS_Harness[JS Capability Harness]
        JS_Harness -->|Prompts for approval| User
        User -->|Grants Permission| JS_Harness
        JS_Harness -->|Executes Shell / Write / Read| Workspace[(Local Workspace)]
        Workspace -->|Returns Output| Coder
        Coder -->|Write Notification| Debugger[Debugger Agent]
        Debugger -->|Analyzes Changes| Workspace
        Debugger -->|Compiles / Runs Checks| Workspace
        Debugger -->|Auto-Fixes Small Bugs| Workspace
        Debugger -->|Detailed Report| Commander
    end
```

---

## 🧠 Memory Leak & Context Bloat Prevention

Modern LLM agents frequently suffer from memory leaks and performance degradation. A.N.A.N.D is designed from the ground up to prevent these issues:

### 1. Process-Level Memory Isolation
*   **Problem**: Continuous generation and subagent spawning in a single-process application leads to Heap accumulation, memory fragmentation, and eventual process crashes.
*   **A.N.A.N.D Solution**: Coding and Debugger agents are spawned as isolated Node.js child processes via `child_process.fork()`. When their specific subtask is completed, the child process is terminated. Node.js instantly garbage-collects and releases 100% of the memory allocated for that agent's chat history, API handlers, and buffers.

### 2. Context Bloat and Token Overflow Prevention
*   **Problem**: In traditional architectures, all tool execution outputs, file reads, and logs are dumped directly into the main conversation history, causing token count to balloon, response latency to spike, and LLM reasoning to decay.
*   **A.N.A.N.D Solution**: 
    - **Short-Lived Sub-Sessions**: Coding and Debugger subagents use independent, isolated chat sessions. Only their finalized summary reports are fed back to the Commander.
    - **Active Compaction**: The `/compact` command summarizes conversation history into a single concise paragraph of context, freeing up the model's active memory and maintaining high reasoning performance.

### 3. Event Listener Leak Safeguards
*   **Problem**: Frequent stdin keypress capturing and IPC messages can build up orphan listeners, causing `MaxListenersExceededWarning` and memory bloat.
*   **A.N.A.N.D Solution**: The supervisor harness uses clean event-emitter registration. Every time an agent finishes a keypress query or capability request, the listeners are explicitly cleaned up using `.removeListener('keypress', ...)` and callback maps are fully cleared, guaranteeing a leak-free shell.

---

## 💻 Installation & Global Access

### Option 1: Install via npm (Recommended)
To download and install the CLI tool globally from the npm registry:
```bash
npm install -g anandcli
```

### Option 2: Install from Source (GitHub)
If you want to clone the repository and run it locally:

1.  **Clone the repository**
    ```bash
    git clone https://github.com/ashu90-prog/anand-cli-chatbot.git
    cd anand-cli-chatbot/NodeJS
    ```

2.  **Install dependencies and register globally**
    ```bash
    npm install
    npm link --force
    ```

---

### Launching the Tool
Once installed using either option, simply type `anand` in any terminal window and press Enter to launch the chatbot:
```bash
anand
```

---

## ⚡ Key Features & Performance

### 1. High Speed & Low-Latency UI
*   **Sub-Millisecond Keypress Interception**: Using Node's native `readline` module in raw mode, keypresses are captured instantly. Command suggestion overlays filter and render underneath your cursor on the fly, introducing absolutely zero typing lag.
*   **Rapid Live Search**: The paginated model selector filters hundreds of available API models CPU-instantly as you type characters into the `Search >` prompt.

### 2. Multi-Agent & Chatbot Modes (`/algo` & `/normal`)
*   **Autonomous Orchestration Mode (`/algo`)**: Spawns a **Commander Agent** that coordinates with autonomous **Coding** and **Debugger** subagents to automatically write code, run compiler checks, and self-heal bugs locally.
*   **Traditional Single-Agent Mode (`/normal`)**: Provides a direct, single-chat assistant (`A.N.A.N.D > `) that does not spawn subagents but can still execute local file system operations via permitted XML commands.

### 3. Autonomous Execution & Self-Healing (`/goal` & `/loop`)
*   **Autonomous Goal Mode (`/goal <task>`)**: Available in Normal mode. Runs the target task autonomously. If compile or runtime errors occur, the agent detects them and automatically edits files to self-heal the issues without human intervention.
*   **Autonomous Loop Mode (`/loop <task>`)**: Available in both Normal and Algo modes. 
    *   *Normal Mode*: Rechecks and retries tasks automatically if errors are encountered.
    *   *Algo Mode*: If the Debugger Agent detects an error, it passes the stack trace and diagnostic root cause back to the Commander. The Commander then turns the error into a temporary subtask (preserving the original task queue) and restores normal execution once the error-task is resolved.

### 4. Searchable Pickers & Defaults
*   **Live Menus**: Selection menus (such as `/models`, `/coding-models`, `/debugger`, and `/provider`) render with a real-time `Search > ` filter input.
*   **Smart Defaults**: Remembers your last-used provider, model, and debugger model configurations, highlighting them automatically when selection menus are opened.

### 5. Decoupled Capability Harness (Security)
*   **Sandbox Isolation**: Chat sessions run in child processes. They cannot touch the file system or run commands directly.
*   **Interactive Prompts**: All capability requests are intercepted by `harness.js` which prompts you to confirm permissions (`Allow Once`, `Always Allow`, `Reject`) using arrow keys.
*   **Session Whitelist**: Choosing "Always Allow" whitelists that specific command, preventing future prompts during the active session.

### 6. Terminal Robustness & Alternate Screen Reliability (UI Improvements)
*   **Focus & Paste Protection**: Filters terminal focus reporting sequences (`\u001b[I` / `\u001b[O`) and key events with undefined metadata to prevent input buffer corruptions and terminal crashes.
*   **Global Raw Mode Stability**: Keeps raw mode active globally (instead of rapidly toggling it between prompt states), resolving input deadlocks in ConPTY / VS Code Integrated Terminals.
*   **Synchronous Recovery**: Utilizes synchronous standard output writing (`fs.writeSync`) on process exits, signals (`SIGINT`/`SIGTERM`), and unhandled exceptions to restore terminal alternate screen modes immediately and prevent terminal lockups.
*   **Dynamic Visual Margins**: Keeps the prompt/query box left-aligned while assistant responses are padded dynamically by 4 spaces.
*   **Persistent Input Interface**: The query box borders, outline, and status line remain fully visible and positioned during response stream generation.

---

## 🛠️ Commands & Keyboard Shortcuts

Inside the chatbot, you can use these commands or press `Ctrl + X` followed by the shortcut key:

| Command | Shortcut | Description |
| :--- | :--- | :--- |
| `/help` | `Ctrl + X h` | Show command help |
| `/editor` | `Ctrl + X e` | Open multi-line text editor |
| `/models` | `Ctrl + X m` | List and select models for the current provider (includes search bar) |
| `/coding-models` | `Ctrl + X g` | Configure a pool of models for Coding Agents (includes search bar) |
| `/debugger` | `Ctrl + X d` | Select the model for the Debugger Agent (includes search bar) |
| `/algo` | *None* | Switch to Multi-Agent Algorithm mode |
| `/normal` | *None* | Switch to Normal Chatbot mode |
| `/goal` | *None* | Run a task autonomously in Normal mode |
| `/loop` | *None* | Run a task autonomously until done (both modes) |
| `/terminal` | `Ctrl + X t` | Open interactive terminal shell |
| `/provider` | `Ctrl + X p` | Switch active provider (Gemini, OpenAI, Anthropic, NVIDIA, Ollama) |
| `/init` | `Ctrl + X i` | Initialize `AGENTS.md` rules in the workspace |
| `/compact` | `Ctrl + X c` | Compact the context history |
| `/sessions` | `Ctrl + X l` | List all saved chat sessions |
| `/system` | `Ctrl + X s` | View or update active system prompt |
| `/history` | `Ctrl + X y` | Show current session history or export it to Markdown |
| `/clear` | `Ctrl + X o` | Clear context history and reset terminal |
| `/exit` | `Ctrl + X q` | Terminate the session |

---

## 📂 Configuration Options (`config.json`)

All configuration parameters are stored globally in `~/.cli-chatbot/config.json`. Below is the schema structure:

```json
{
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "mode": "algo",
  "debugger_model": "gemini-2.5-flash",
  "system_prompt": "You are a helpful assistant.",
  "api_keys": {
    "gemini": "YOUR_GEMINI_KEY",
    "openai": "YOUR_OPENAI_KEY",
    "anthropic": "YOUR_ANTHROPIC_KEY",
    "nvidia": "YOUR_NVIDIA_KEY"
  },
  "coding_models": [
    "gemini-2.5-flash",
    "gemini-2.5-pro"
  ]
}
```

---

## 🔧 Developer Guide: Extending Providers

To add a new API provider to the CLI, extend `BaseProvider` inside `providers.js` and register it in `ProviderManager`:

1.  **Define the Provider Class**:
    ```javascript
    export class MyNewProvider extends BaseProvider {
      constructor(apiKey) {
        super();
        this.apiKey = apiKey;
      }
      
      async listModels() {
        // Return array of model IDs available for your provider
        return ['model-v1', 'model-v2'];
      }
      
      async *generateStream(systemPrompt, messages, model) {
        // Yield streamed chunks of assistant responses from the API
        yield "Response chunk";
      }
    }
    ```

2.  **Register the Provider** inside the `ProviderManager` switch block:
    ```javascript
    case 'myprovider':
      return new MyNewProvider(apiKey);
    ```
