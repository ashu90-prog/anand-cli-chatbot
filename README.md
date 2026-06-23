# Multi-Provider CLI Chatbot

A simple terminal-based chatbot supporting Google Gemini, OpenAI, Anthropic, and Ollama.

## Setup Instructions

1. **Create and Activate a Virtual Environment (Recommended)**
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

2. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure API Keys (Optional)**
   You can create a `.env` file in the root directory and add your API keys:
   ```env
   GEMINI_API_KEY=your_gemini_key
   OPENAI_API_KEY=your_openai_key
   ANTHROPIC_API_KEY=your_anthropic_key
   ```
   If not provided, the CLI tool will prompt you for the key when you switch to that provider, saving it locally in `~/.cli-chatbot/config.json`.

4. **Launch the Chatbot**
   ```bash
   python main.py
   ```

## Slash Commands
Inside the chatbot, you can use these commands:
- `/provider [name]` - Switch provider (gemini, openai, anthropic, ollama)
- `/models` - List and select models for the current provider
- `/system [prompt]` - View or set system instruction prompt
- `/history [export]` - Show current session history or export it to Markdown
- `/clear` - Clear context history for active chat
- `/help` - Show command help
- `/exit` - Exit the chatbot
