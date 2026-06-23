# A.N.A.N.D - Node.js CLI Chatbot (with Multi-Agent Orchestration & Autocomplete)

A terminal-based chatbot built with Node.js that connects to Google Gemini, OpenAI, Anthropic, NVIDIA, and Ollama. It features a custom interactive shell prompt that intercepts keypresses to offer dynamic command suggestions, multi-agent capabilities, and auto-debugging.

## Installation & Global Access

### Option 1: Install via npm (Once Published)
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
    npm link
    ```

---

### Launching the Tool
Once installed using either option, simply type `anand` in any terminal window and press Enter to launch the chatbot:
```bash
anand
```

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
| `/provider` | `Ctrl + X p` | Switch active provider (Gemini, OpenAI, Anthropic, NVIDIA, Ollama) |
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
