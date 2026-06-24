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
| `/terminal` | `Ctrl + X t` | Open interactive terminal shell |
| `/provider` | `Ctrl + X p` | Switch active provider (Gemini, OpenAI, Anthropic, NVIDIA, Ollama, OpenRouter, and 100+ custom providers) |
| `/init` | `Ctrl + X i` | Initialize `AGENTS.md` rules in the workspace |
| `/compact` | `Ctrl + X c` | Compact the context history |
| `/sessions` | `Ctrl + X l` | List all saved chat sessions |
| `/system` | `Ctrl + X s` | View or update active system prompt |
| `/history` | `Ctrl + X y` | Show current session history or export it to Markdown |
| `/clear` | `Ctrl + X o` | Clear context history and reset terminal |
| `/exit` | `Ctrl + X q` | Terminate the session |

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
