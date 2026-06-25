# A.N.A.N.D CLI Chatbot Project Specification (Interactive Autocomplete)

A terminal-based chatbot built with Node.js (ES Modules) that integrates Google Gemini, OpenAI, Anthropic, NVIDIA, Ollama, OpenRouter, Groq, Deepinfra, and over 100+ custom OpenAI-compatible providers. It features a custom interactive shell prompt that intercepts keypresses to offer dynamic command suggestions when typing `/` and filters command suggestions (e.g., `/mo` -> `/models`) that are selectable via arrow keys and Enter. It also supports physical keyboard shortcuts (`ctrl+x` combos) for instant command execution.

---

## 1. System Architecture

The Node.js chatbot is modularized into:
1. **Interactive Shell Loop** (`main.js`): Intercepts raw keypresses, filters and highlights command suggestions, formats outputs, handles hotkeys, and routes slash commands.
2. **Provider Gateway** (`providers.js`): Communicates with LLM streaming API endpoints using Node's native `fetch` client and stream reader.
3. **Session & Configuration Manager** (`config.js` & `history.js`): Persists local configuration preferences (API keys, settings) in a secure JSON file, maintains chat log state, and handles exports.

```
                  +-----------------------------------+
                  |             main.js               |
                  |     (Raw Keypress REPL Loop)      |
                  +-----------------+-----------------+
                                    |
            +-----------------------+-----------------------+
            |                                               |
            v                                               v
+-----------------------+                       +-----------------------+
|      providers.js     |                       |       config.js       |
|  (100+ API Adapters)  |                       |    (API Keys/Prefs)   |
|   Native Stream Fetch)|                       +-----------+-----------+
+-----------------------+                                   |
                                                            v
                                                +-----------------------+
                                                |       history.js      |
                                                |   (Chat Session Log)  |
                                                +-----------------------+
```

---

## 2. Directory Structure

```
cli-chatbot/NodeJS/
│
├── package.json                # Project description and dependencies (chalk, dotenv)
├── main.js                     # Main executable REPL loop with raw TTY key listeners and UI renderer
├── config.js                   # Configuration and secret storage
├── providers.js                # LLM API stream adapters using native fetch
├── history.js                  # Conversation log session state
├── README.md                   # Installation and launch instructions
└── exports/                    # Saved conversation markdown files
```

---

## 3. Keyboard Shortcuts & Command Mappings

The CLI REPL loop captures `ctrl+x` key sequences. Pressing `ctrl+x` followed by a single hotkey character instantly triggers and routes the mapped command:

| Command | Keyboard Shortcut | Action Description |
|:---|:---|:---|
| `/help` | `ctrl+x h` | Displays commands and shortcut directory |
| `/editor` | `ctrl+x e` | Launches multi-line notepad entry mode |
| `/models` | `ctrl+x m` | Fetches active provider models and displays selection |
| `/coding-models` | `ctrl+x g` | Selects models pool for Coding Agents |
| `/debugger` | `ctrl+x d` | Pick model for Debugger Agent |
| `/init` | `ctrl+x i` | Initializes rules file `AGENTS.md` in workspace |
| `/compact` | `ctrl+x c` | Triggers context summarization to clear token history |
| `/sessions` | `ctrl+x l` | Reads and lists exported markdown log files |
| `/provider` | `ctrl+x p` | Switches API provider dynamically |
| `/system` | `ctrl+x s` | Configures system prompting instructions |
| `/history` | `ctrl+x y` | Renders chat log / exports active log |
| `/clear` | `ctrl+x o` | Resets terminal UI and clears conversation memory |
| `/terminal` | `ctrl+x t` | Opens interactive shell mode |
| `/exit` | `ctrl+x q` | Terminates the terminal process cleanly |

### Workspace & Productivity Commands
In addition to standard shortcuts, the REPL features categorized slash commands:
1. **File & Project**: `/new` (create), `/open` (read/view), `/save` (edit), `/rename` (rename), `/delete` (remove), `/close` (deselect file).
2. **Navigation**: `/goto` (jump to file/symbol), `/search` (grep query), `/explorer` (workspace directory tree explorer).
3. **Code Assistance**: `/run` (execute active file/command), `/build` (npm/cargo/make builder), `/format` (prettier/black code format), `/fix` (Coding Agent fix request), `/debug` (Debugger Agent test verify).
4. **AI/Agent Orchestrator**: `/ask` (chat focus file), `/explain` (code comprehension), `/generate` (agent code generation), `/test` (agent test writer), `/doc` (agent documenter).
5. **Git Version Control**: `/status` (git status), `/branch` (git checkout/branch), `/commit` (git commit), `/push` (git push), `/pull` (git pull), `/clone` (git clone), `/stash` (git stash).
6. **Environment & UI Customization**: `/settings` (view preferences), `/theme` (dynamic color schemes: Classic, Fire, Forest, Sunset, Hacker), `/extensions` (active modules list), `/restart` (restarts harness session).
7. **Utilities**: `/snippet` (templates inserter), `/cmd` (custom CLI execute), `/log` (recent debugger output).
8. **Web Search & Browsing**: `/search-web` (query DuckDuckGo search), `/browse-url` (fetch page and render stripped text).


---

## 4. UI Layout Specifications

*   **Header Logo**: Block text logo centering "A.N.A.N.D" (or OpenCode) and version suffix `v0.1.156`.
*   **Prompt Box**: A 3-line ASCII border box (`┌──┐`, `│ │`, `└──┘`) spanning terminal width containing prompt `You > ` and active user inputs with a highlighted background container.
*   **Bottom Status Bar**: Left-aligned indicator `enter send` and right-aligned indicator `PROVIDER / Active Model` dynamically reflecting configurations.
*   **Side Panel**: Dual-pane status tracker dynamically matching the layout theme styling (e.g. classic blue, hacking green, etc.) showing Token Usage, Context Window tracker, and Todo list.
