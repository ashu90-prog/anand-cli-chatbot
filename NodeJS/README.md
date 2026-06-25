# A.N.A.N.D - Node.js CLI Chatbot (with Multi-Agent Orchestration & Autocomplete)

A terminal-based chatbot built with Node.js that connects to Google Gemini, OpenAI, Anthropic, NVIDIA, Ollama, OpenRouter, Groq, Deepinfra, and over 100+ custom LLM providers. It features a custom interactive shell prompt that intercepts keypresses to offer dynamic command suggestions, multi-agent capabilities, and auto-debugging.

## Installation & Global Access

You can install the chatbot globally on your system to launch it from any directory:

1.  **Navigate to the Node.js project folder**
    ```bash
    cd NodeJS
    ```

2.  **Install dependencies and create global link**
    ```bash
    npm install
    npm link
    ```

3.  **Run the tool from anywhere**
    Now, simply type `anand` in any terminal and press Enter to launch the chatbot:
    ```bash
    anand
    ```

## Autonomous Modes & Status Sidebar (Latest Updates)

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

We rolled out a series of major stability, visual, and architectural improvements to ensure robust shell performance:

#### A. NVIDIA NIM Capability Retention (Kimi/Moonshot Integration)
*   **The Issue**: When running long multi-turn chats, instruction decay caused moonshot models (`moonshotai/kimi-k2.6` on NVIDIA NIM) to "forget" system capability prompts. This prevented them from generating `<search_web>` and `<browse_url>` tags, leading to silent failures or template compile errors.
*   **The Fix**: Modified `NvidiaProvider` inside `providers.js` to dynamically prefix the active system capabilities template to the **last user query** in the history stack rather than appending it to the initial first-turn message. This guarantees prompt instructions remain in the model's immediate context window.

#### B. Column-Restricted Terminal Rendering Engine (Zero-Tearing UI)
*   **The Issue**: Traditional line-clear codes (`readline.clearLine` or ANSI `\x1B[K`) erase the entire terminal row. In a split-screen terminal layout, updating the left pane (chat box, suggestion drop-downs, thinking animation) accidentally wiped out the right sidebar.
*   **The Fix**: Restructured the rendering handlers in `main.js`. All row deletions are now restricted by width boundaries (`W_chat`). Overwriting is done strictly through space padding up to `W_chat` rather than clear-to-end sequences. This guarantees a tear-free, permanent charcoal-gray status panel.

#### C. Decoupled Web-Searching Capability & IPC Architecture
*   **Implementation**: Added `webfetch.js` to manage background fetch actions. It implements:
    *   **DuckDuckGo HTML Scraping**: A fast scraping crawler using raw fetch requests, regex extraction, HTML entity decoding, and custom timeout protection.
    *   **Markdown Extractor**: Converts web pages to compact, clean markdown while stripping out script blocks, stylesheets, nav menus, and footers.
    *   **IPC Routing**: Registered `search_web` and `browse_url` inside `harness.js`. When a model triggers a search tag, `main.js` sends an IPC query request to the harness, which downloads the search results and returns them to the model sandbox.

#### D. Google Gemini & Anthropic Message Normalization (Role Merging)
*   **The Issue**: Frequent tool execution or multi-agent calls can create consecutive messages belonging to the same role (e.g. user, user) or system messages placed between user turns. Modern APIs like Gemini and Anthropic reject these histories with serialization errors.
*   **The Fix**: Integrated a message-normalizer inside `providers.js`. It groups consecutive turns of the same role together and converts isolated system messages into user turns prefixed with `[System Message]`, conforming to API constraints.

#### E. Decoupled Supervisor Lifecycle (Auto-Restart)
*   **Implementation**: Programmed `harness.js` to monitor the chatbot child process exit status. If the child process exits with code `42` (triggered by calling the `/restart` command), the harness supervisor catches it and immediately forks a clean chat instance, preserving terminal alternate buffer states.

#### F. Dynamic Prompt-Generation Visual Cues
*   **Implementation**: Added a pulsing visual animation for prompt status line rows. When generating a stream response, the status panel warns `[ESC to interrupt]` with dual-color pulsing effects (toggled between yellow and gray every 500ms) to indicate the active stream cancel hotkey is ready.

## CLI Modes

A.N.A.N.D can run in two distinct modes:

### 1. Multi-Agent Algorithm Mode (`/algo`)
*   **Orchestration**: The user interacts directly with a **Commander Agent** (`Assistant (Commander) > `).
*   **Coding Agents**: The Commander plans subtasks and spawns autonomous **Coding Agents** (colored in magenta) using `<spawn_agent model="model_name" debugger_model="model_name">`.
*   **Debugger Agents**: Once a Coding Agent modifies or writes any files, a **Debugger Agent** (colored in yellow) is automatically spawned to verify the changes.
    - **Self-Healing**: If the Debugger finds small errors (like syntax typos), it fixes them itself using `<write_file>`.
    - **Report Back**: If the error is large, the Debugger returns a detailed error report to the Commander to adjust the plan.

### 2. Single-Agent Normal Mode (`/normal`)
*   Acts as a standard single chatbot (`A.N.A.N.D > `).
*   Allows you to chat directly with one agent.
*   **Capabilities**: The agent still has direct access to the workspace and can run commands, read files, and write files directly.

## Supported Providers (100+)
A.N.A.N.D supports standard built-in providers, local servers, and custom OpenAI-compatible APIs:
* **Built-in Providers**: `gemini`, `openai`, `anthropic`, `nvidia`, `ollama`
* **Custom & Free API Providers**: `openrouter`, `groq`, `deepseek`, `together`, `mistral`, `xai`, `perplexity`, `cerebras`, `sambanova`, `deepinfra`, `fireworks`, `novita`, `lepton`, `hyperbolic`, `nebius`, `friendli`, `runpod`, `opencodezen`, `llamaapi`, `anyscale`, `monsterapi`, `openpipe`, `huggingface`, `lambdalabs`, `octoai`, `ai21`, `scale`, `gooseai`, `alibaba`, `zhipu`, `moonshot`, `minimax`, `yi`, `baichuan`, `doubao`, `stepfun`, `siliconflow`, `textsynth`, `api2d`, `linkai`, `oneapi`, `newapi`, `opencode`, `openchat`, `cloudl`, `deepgpt`, `llamacloud`, `aimlapi`, `glider`, `openlayer`, `databricks`, `workersai`, `portkey`, `openrouterfree`, `openrouterbeta`, `router`, `feather`, `sensenova`, `hunyuan`, `spark`, `baiduqianfan`, `copilot`, `cursor`, `ghostcoder`, `codegpt`, `codeium`, `supermaven`, `sourcegraphcody`, `blackbox`, `phind`, `you`, `duckduckgo`, `brave`, `kling`, `luma`, `runway`, `sora`, `midjourneycompatible`, `stablediffusioncompatible`, `elevenlabscompatible`, `voci`, `assemblyai`, `deepgram`, `whispercompatible`, `glhf`, `hyperbolicfree`, `openrouterfreetier`, `cohere`, `writer`, `groqfree`
* **Local Provider Endpoints**: `lmstudio`, `localai`, `vllm`, `koboldcpp`, `llamacpp`, `textgenwebui`, `gpt4all`, `mlflow`, `langchainlocal`, `ollamaremote`, `runpodserverless`, `awsbedrockcompatible`, `azureopenaicompatible`, `tabby`, `continue`

## Commands & Keyboard Shortcuts

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
| `/provider` | `Ctrl + X p` | Switch active provider (Gemini, OpenAI, Anthropic, NVIDIA, Ollama, OpenRouter, and 100+ custom providers) |
| `/init` | `Ctrl + X i` | Initialize `AGENTS.md` rules in the workspace |
| `/compact` | `Ctrl + X c` | Compact the context history |
| `/sessions` | `Ctrl + X l` | List all saved chat sessions |
| `/system` | `Ctrl + X s` | View or update active system prompt |
| `/history` | `Ctrl + X y` | Show current session history or export it to Markdown |
| `/clear` | `Ctrl + X o` | Clear context history and reset terminal |
| `/exit` | `Ctrl + X q` | Terminate the session |

### Workspace & Productivity Commands

The interactive shell features categorized slash commands for workspace operations, web searching, and multi-agent coordination:

| Category | Commands & Usage | Action Description |
| :--- | :--- | :--- |
| **File & Project** | `/new`, `/open`, `/save`, `/rename`, `/delete`, `/close` | Create, read/view, edit/save, rename, remove, or close files in active context |
| **Navigation** | `/goto <symbol>`, `/search <query>`, `/explorer` | Search file symbols, run grep search across codebase, and browse directory tree |
| **Code Execution & Verification** | `/run [cmd]`, `/build`, `/format`, `/fix`, `/debug` | Execute active file, build target, format syntax, run coding-agent auto-fix, or debugger-agent verify |
| **AI Agent Tasks** | `/ask`, `/explain`, `/generate`, `/test`, `/doc` | Chat focused on specific files, explain code segments, write tests, auto-generate code or documentation |
| **Git Version Control** | `/status`, `/branch`, `/commit`, `/push`, `/pull`, `/clone`, `/stash` | Run standard Git operations inside workspace |
| **Web Integration** | `/search-web <query>`, `/browse-url <url>` | Execute native DuckDuckGo search and extract clean web content via the capability harness (`webfetch.js`) |
| **Theme & UI** | `/settings`, `/theme [name]`, `/extensions`, `/restart` | View configuration preferences, toggle color schemes (Classic, Fire, Forest, Sunset, Hacker), reload modules, or reload the harness session |
| **Utilities** | `/snippet`, `/cmd <command>`, `/log` | Insert snippets, run raw commands with interactive capability permission approval, or read runtime logs |

## Searchable Pickers & Defaults
*   **Interactive Search**: Selection menus (such as `/models`, `/coding-models`, `/debugger`, and `/provider`) now feature a real-time `Search > ` filter input. Type letters to narrow down options dynamically.
*   **Smart Defaults**: Pickers remember and automatically highlight the last used provider or model when opened, so you don't have to scroll from the top every time.

## Capability Harness
A.N.A.N.D is supervised by a Node.js capability harness (`harness.js`):
*   **Prompted Approvals**: When the chatbot triggers a command execution, file read, or file write, the harness intercepts the request and prompts you to select `Allow Once`, `Always Allow`, or `Reject` using arrow keys.
*   **Whitelisting**: Selecting "Always Allow" whitelists that specific command for the rest of the session.

## Terminal Robustness & UI Reliability
To provide a smooth, crash-free interface in advanced terminal emulators (like VS Code ConPTY, Windows Terminal, and traditional shells), the following features are integrated:
*   **Focus-Reporting Filtration**: Focus-reporting command sequences (`\u001b[I` / `\u001b[O`) sent when switching windows or tabs are filtered out early to avoid polluting the prompt buffer.
*   **Global Raw Mode Strategy**: The keyboard raw mode state is maintained globally across prompt cycles instead of rapid toggling. This prevents desynchronization and deadlocks of input events on Windows-based shell streams.
*   **Synchronous State Recovery**: The terminal's alternate screen buffer, cursor states, and mouse reporting settings are synchronously restored (`fs.writeSync` to stdout) during process exit, standard interruption signals (`SIGINT`/`SIGTERM`), and unhandled exceptions or promise rejections.
*   **Layout Consistency**: Suggestion list scroll boxes and response frames render cleanly alongside left-aligned prompts with dynamic column alignment. The prompt box outline remains fully intact and visible during response generation wait times.
