import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import * as config from './config.js';
import { ChatSession } from './history.js';
import { ProviderManager } from './providers.js';

// Load .env file
dotenv.config();

const COMMANDS = [
  '/help',
  '/editor',
  '/models',
  '/coding-models',
  '/debugger',
  '/algo',
  '/normal',
  '/init',
  '/compact',
  '/sessions',
  '/provider',
  '/system',
  '/history',
  '/clear',
  '/run',
  '/read',
  '/write',
  '/terminal',
  '/exit'
];

let firstMessageSent = false;
const HAS_HARNESS = process.env.ANAND_HARNESS === 'true';

// Harness request counter and responder mapping
let harnessRequestId = 0;
const harnessCallbacks = new Map();
const whitelist = new Set();

let cachedModelsList = null;
let lastCachedProvider = null;

async function getModelsForProvider(provider, providerName) {
  if (cachedModelsList && lastCachedProvider === providerName) {
    return cachedModelsList;
  }
  try {
    cachedModelsList = await provider.listModels();
    lastCachedProvider = providerName;
  } catch (e) {
    cachedModelsList = ['gemini-2.5-flash', 'gemini-2.5-pro']; // fallback
    lastCachedProvider = providerName;
  }
  return cachedModelsList;
}

if (HAS_HARNESS) {
  process.on('message', (res) => {
    if (res && res.id) {
      const cb = harnessCallbacks.get(res.id);
      if (cb) {
        harnessCallbacks.delete(res.id);
        if (res.status === 'success') {
          cb.resolve(res.output);
        } else {
          cb.reject(new Error(res.error || 'Unknown harness error'));
        }
      }
    }
  });
}

function promptUserPermission(action, payload) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    
    const choices = ['Allow Once', 'Always Allow', 'Reject'];
    let selectedIdx = 0;
    
    function draw() {
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      
      stdout.write(`\n${chalk.yellow.bold('⚠️  A.N.A.N.D Capability Request:')}\n`);
      readline.clearLine(stdout, 0);
      
      if (action === 'run_command') {
        stdout.write(`   Action:  ${chalk.cyan('Run Shell Command')}\n`);
        readline.clearLine(stdout, 0);
        stdout.write(`   Command: ${chalk.white.bold(payload.command)}\n`);
      } else if (action === 'read_file') {
        stdout.write(`   Action:  ${chalk.cyan('Read File')}\n`);
        readline.clearLine(stdout, 0);
        stdout.write(`   Path:    ${chalk.white.bold(payload.path)}\n`);
      } else if (action === 'write_file') {
        stdout.write(`   Action:  ${chalk.cyan('Write File')}\n`);
        readline.clearLine(stdout, 0);
        stdout.write(`   Path:    ${chalk.white.bold(payload.path)}\n`);
      }
      
      readline.clearLine(stdout, 0);
      stdout.write(`   Choices: `);
      choices.forEach((choice, idx) => {
        if (idx === selectedIdx) {
          const color = idx === 2 ? chalk.black.bgRed : chalk.black.bgGreen;
          stdout.write(color(` > ${choice} `) + '   ');
        } else {
          stdout.write(chalk.cyan(`   ${choice}`) + '   ');
        }
      });
      stdout.write('\n');
      
      readline.clearLine(stdout, 0);
      stdout.write(chalk.gray(`   (Use Left/Right or Up/Down arrows to select, Enter to confirm)\n`));
      
      // Move cursor back up 6 lines
      readline.moveCursor(stdout, 0, -6);
    }
    
    function cleanup() {
      // Clear the drawn 6 lines
      readline.cursorTo(stdout, 0);
      for (let i = 0; i < 6; i++) {
        readline.clearLine(stdout, 0);
        stdout.write('\n');
      }
      // Move back up
      readline.moveCursor(stdout, 0, -6);
      readline.cursorTo(stdout, 0);
      
      stdin.removeListener('keypress', keypressHandler);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
    }
    
    function keypressHandler(str, key) {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }
      
      if (key.name === 'return') {
        cleanup();
        const choiceValue = (selectedIdx + 1).toString();
        resolve(choiceValue);
        return;
      }
      
      if (key.name === 'left' || key.name === 'up') {
        selectedIdx = (selectedIdx - 1 + choices.length) % choices.length;
        draw();
        return;
      }
      
      if (key.name === 'right' || key.name === 'down') {
        selectedIdx = (selectedIdx + 1) % choices.length;
        draw();
        return;
      }
    }
    
    stdin.on('keypress', keypressHandler);
    draw();
  });
}

function makeHarnessRequest(action, payload = {}) {
  return new Promise(async (resolve, reject) => {
    if (!HAS_HARNESS) {
      reject(new Error("Harness not detected. Launch via node harness.js."));
      return;
    }
    
    const isAllowed = action === 'run_command' && whitelist.has(payload.command);
    if (!isAllowed) {
      try {
        const choice = await promptUserPermission(action, payload);
        if (choice === '1' || choice === '2') {
          if (choice === '2' && action === 'run_command') {
            whitelist.add(payload.command);
          }
        } else {
          reject(new Error("Permission Denied by user"));
          return;
        }
      } catch (e) {
        reject(e);
        return;
      }
    }
    
    const id = (++harnessRequestId).toString();
    const req = { id, action, ...payload };
    
    harnessCallbacks.set(id, { resolve, reject });
    process.send(req);
  });
}

function drawWelcomeScreen() {
  console.clear();
  
  const width = process.stdout.columns || 80;
  
  // Render centered block logo "A.N.A.N.D"
  const logo = [
    " █████     ███    ██    █████     ███    ██  ██████  ",
    "██   ██    ████   ██   ██   ██    ████   ██  ██   ██ ",
    "███████ ▀  ██ ██  ██   ███████ ▀  ██ ██  ██  ██   ██ ",
    "██   ██    ██  ██ ██   ██   ██    ██  ██ ██  ██   ██ ",
    "██   ██ ▄  ██   ████   ██   ██ ▄  ██   ████  ██████  "
  ];
  
  console.log('\n');
  logo.forEach(line => {
    const padding = Math.max(0, Math.floor((width - line.length) / 2));
    console.log(' '.repeat(padding) + chalk.cyan.bold(line));
  });
  
  const version = "v0.1.156";
  const vPadding = Math.max(0, Math.floor((width - version.length) / 2));
  console.log(' '.repeat(vPadding) + chalk.gray(version) + '\n\n');
  
  // Render centered menu
  const menuLines = [
    { cmd: "/help", desc: "show help", key: "ctrl+x h" },
    { cmd: "/editor", desc: "open editor", key: "ctrl+x e" },
    { cmd: "/models", desc: "list models", key: "ctrl+x m" },
    { cmd: "/coding-models", desc: "coding agent models", key: "ctrl+x g" },
    { cmd: "/debugger", desc: "debugger agent model", key: "ctrl+x d" },
    { cmd: "/terminal", desc: "open terminal", key: "ctrl+x t" },
    { cmd: "/compact", desc: "compact the session", key: "ctrl+x c" },
    { cmd: "/sessions", desc: "list sessions", key: "ctrl+x l" }
  ];
  
  const maxCmdLen = Math.max(...menuLines.map(l => l.cmd.length));
  const maxDescLen = Math.max(...menuLines.map(l => l.desc.length));
  
  menuLines.forEach(line => {
    const formattedCmd = line.cmd.padEnd(maxCmdLen + 6);
    const formattedDesc = line.desc.padEnd(maxDescLen + 6);
    const contentLine = `${formattedCmd}${formattedDesc}${line.key}`;
    const padding = Math.max(0, Math.floor((width - contentLine.length) / 2));
    
    console.log(
      ' '.repeat(padding) + 
      chalk.cyan(line.cmd.padEnd(maxCmdLen + 6)) + 
      chalk.white(line.desc.padEnd(maxDescLen + 6)) + 
      chalk.gray(line.key)
    );
  });
  console.log('\n');
}

function showHelp() {
  console.log(chalk.magenta.bold('\n--- Command Directory & Shortcuts ---'));
  const commandsHelp = [
    { cmd: "/help", desc: "Show this help screen", shortcut: "ctrl+x h" },
    { cmd: "/editor", desc: "Open multi-line text editor", shortcut: "ctrl+x e" },
    { cmd: "/models", desc: "List and pick active provider model", shortcut: "ctrl+x m" },
    { cmd: "/coding-models", desc: "Select models pool for Coding Agents", shortcut: "ctrl+x g" },
    { cmd: "/debugger", desc: "Pick model for Debugger Agent", shortcut: "ctrl+x d" },
    { cmd: "/algo", desc: "Switch to Multi-Agent Algorithm mode", shortcut: "None" },
    { cmd: "/normal", desc: "Switch to Normal Chatbot mode", shortcut: "None" },
    { cmd: "/terminal", desc: "Open interactive terminal shell", shortcut: "ctrl+x t" },
    { cmd: "/init", desc: "Initialize workspace AGENTS.md rules file", shortcut: "ctrl+x i" },
    { cmd: "/compact", desc: "Request LLM summarization to compact context", shortcut: "ctrl+x c" },
    { cmd: "/sessions", desc: "List all exported chat logs", shortcut: "ctrl+x l" },
    { cmd: "/provider", desc: "Switch LLM API provider", shortcut: "ctrl+x p" },
    { cmd: "/system", desc: "Set or view system prompts", shortcut: "ctrl+x s" },
    { cmd: "/history", desc: "Show chat session history / export", shortcut: "ctrl+x y" },
    { cmd: "/clear", desc: "Clear chat memory and reset workspace UI", shortcut: "ctrl+x o" },
    { cmd: "/run", desc: "Execute shell commands (requires harness)", shortcut: "None" },
    { cmd: "/read", desc: "Read workspace files (requires harness)", shortcut: "None" },
    { cmd: "/write", desc: "Write files to workspace (requires harness)", shortcut: "None" },
    { cmd: "/exit", desc: "Safely terminate chatbot session", shortcut: "ctrl+x q" }
  ];

  commandsHelp.forEach(c => {
    console.log(
      chalk.cyan(c.cmd.padEnd(12)) + 
      chalk.white(c.desc.padEnd(45)) + 
      chalk.gray(c.shortcut)
    );
  });
  console.log('');
}

// Reusable Paginated Selection UI matching design spec & supporting large API model lists
export function askSelection(promptText, choices, defaultSelection = null) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    
    let selectedIdx = 0;
    if (defaultSelection) {
      const idx = choices.findIndex(c => c.toLowerCase() === defaultSelection.toLowerCase());
      if (idx !== -1) {
        selectedIdx = idx;
      }
    }
    
    const maxVisible = 10;
    let filterQuery = '';
    let lastVisibleCount = 0;
    
    function cleanAndDraw() {
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      for (let i = 0; i < lastVisibleCount + 4; i++) {
        readline.moveCursor(stdout, 0, 1);
        readline.clearLine(stdout, 0);
      }
      readline.moveCursor(stdout, 0, -(lastVisibleCount + 4));
      readline.cursorTo(stdout, 0);
      
      readline.clearLine(stdout, 0);
      stdout.write(promptText + '\n');
      
      readline.clearLine(stdout, 0);
      stdout.write(chalk.yellow(`Search > ${filterQuery}_`) + '\n');
      
      const filtered = choices.filter(c => c.toLowerCase().includes(filterQuery.toLowerCase()));
      if (selectedIdx >= filtered.length) {
        selectedIdx = Math.max(0, filtered.length - 1);
      }
      
      let startIdx = 0;
      if (selectedIdx >= maxVisible) {
        startIdx = selectedIdx - maxVisible + 1;
      }
      
      const endIdx = Math.min(filtered.length, startIdx + maxVisible);
      const visibleChoices = filtered.slice(startIdx, endIdx);
      lastVisibleCount = visibleChoices.length;
      
      if (startIdx > 0) {
        stdout.write(chalk.gray('   ▲ (more options above)\n'));
      } else {
        stdout.write('\n');
      }
      
      visibleChoices.forEach((choice, idx) => {
        const actualIdx = startIdx + idx;
        if (actualIdx === selectedIdx) {
          stdout.write(chalk.black.bgCyan(` > ${choice} `) + '\n');
        } else {
          stdout.write(chalk.cyan(`   ${choice}`) + '\n');
        }
      });
      
      if (endIdx < filtered.length) {
        stdout.write(chalk.gray('   ▼ (more options below)\n'));
      } else {
        stdout.write('\n');
      }
      
      readline.moveCursor(stdout, 0, -(visibleChoices.length + 4));
    }
    
    function cleanup() {
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      for (let i = 0; i < lastVisibleCount + 4; i++) {
        readline.moveCursor(stdout, 0, 1);
        readline.clearLine(stdout, 0);
      }
      readline.moveCursor(stdout, 0, -(lastVisibleCount + 4));
      readline.cursorTo(stdout, 0);
      
      stdin.removeListener('keypress', keypressHandler);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
    }
    
    function keypressHandler(str, key) {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }
      
      const filtered = choices.filter(c => c.toLowerCase().includes(filterQuery.toLowerCase()));
      
      if (key.name === 'return') {
        cleanup();
        resolve(filtered[selectedIdx] || null);
        return;
      }
      
      if (key.name === 'up') {
        if (filtered.length > 0) {
          selectedIdx = (selectedIdx - 1 + filtered.length) % filtered.length;
        }
        cleanAndDraw();
        return;
      }
      
      if (key.name === 'down') {
        if (filtered.length > 0) {
          selectedIdx = (selectedIdx + 1) % filtered.length;
        }
        cleanAndDraw();
        return;
      }
      
      if (key.name === 'backspace') {
        filterQuery = filterQuery.slice(0, -1);
        selectedIdx = 0;
        cleanAndDraw();
        return;
      }
      
      if (str && str.length === 1 && !key.ctrl && !key.meta) {
        filterQuery += str;
        selectedIdx = 0;
        cleanAndDraw();
        return;
      }
    }
    
    stdin.on('keypress', keypressHandler);
    cleanAndDraw();
  });
}

// Reusable Paginated Multi-Selection UI for selecting a pool of models
export function askMultiSelection(promptText, choices, initialSelection = []) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    
    const selectedSet = new Set(initialSelection);
    let selectedIdx = 0;
    const maxVisible = 10;
    let filterQuery = '';
    let lastVisibleCount = 0;
    
    function cleanAndDraw() {
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      for (let i = 0; i < lastVisibleCount + 4; i++) {
        readline.moveCursor(stdout, 0, 1);
        readline.clearLine(stdout, 0);
      }
      readline.moveCursor(stdout, 0, -(lastVisibleCount + 4));
      readline.cursorTo(stdout, 0);
      
      readline.clearLine(stdout, 0);
      stdout.write(promptText + chalk.gray(' (Press Space to toggle selection, Enter to confirm)') + '\n');
      
      readline.clearLine(stdout, 0);
      stdout.write(chalk.yellow(`Search > ${filterQuery}_`) + '\n');
      
      const filtered = choices.filter(c => c.toLowerCase().includes(filterQuery.toLowerCase()));
      if (selectedIdx >= filtered.length) {
        selectedIdx = Math.max(0, filtered.length - 1);
      }
      
      let startIdx = 0;
      if (selectedIdx >= maxVisible) {
        startIdx = selectedIdx - maxVisible + 1;
      }
      
      const endIdx = Math.min(filtered.length, startIdx + maxVisible);
      const visibleChoices = filtered.slice(startIdx, endIdx);
      lastVisibleCount = visibleChoices.length;
      
      if (startIdx > 0) {
        stdout.write(chalk.gray('   ▲ (more options above)\n'));
      } else {
        stdout.write('\n');
      }
      
      visibleChoices.forEach((choice, idx) => {
        const actualIdx = startIdx + idx;
        const isSelected = selectedSet.has(choice);
        const prefix = isSelected ? `[${chalk.green('✔')}]` : '[ ]';
        
        if (actualIdx === selectedIdx) {
          stdout.write(chalk.black.bgCyan(` > ${prefix} ${choice} `) + '\n');
        } else {
          stdout.write(chalk.cyan(`   ${prefix} ${choice}`) + '\n');
        }
      });
      
      if (endIdx < filtered.length) {
        stdout.write(chalk.gray('   ▼ (more options below)\n'));
      } else {
        stdout.write('\n');
      }
      
      readline.moveCursor(stdout, 0, -(visibleChoices.length + 4));
    }
    
    function cleanup() {
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      for (let i = 0; i < lastVisibleCount + 4; i++) {
        readline.moveCursor(stdout, 0, 1);
        readline.clearLine(stdout, 0);
      }
      readline.moveCursor(stdout, 0, -(lastVisibleCount + 4));
      readline.cursorTo(stdout, 0);
      
      stdin.removeListener('keypress', keypressHandler);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
    }
    
    function keypressHandler(str, key) {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }
      
      const filtered = choices.filter(c => c.toLowerCase().includes(filterQuery.toLowerCase()));
      
      if (key.name === 'return') {
        cleanup();
        resolve(Array.from(selectedSet));
        return;
      }
      
      if (key.name === 'space') {
        if (filtered.length > 0) {
          const choice = filtered[selectedIdx];
          if (selectedSet.has(choice)) {
            selectedSet.delete(choice);
          } else {
            selectedSet.add(choice);
          }
        }
        cleanAndDraw();
        return;
      }
      
      if (key.name === 'up') {
        if (filtered.length > 0) {
          selectedIdx = (selectedIdx - 1 + filtered.length) % filtered.length;
        }
        cleanAndDraw();
        return;
      }
      
      if (key.name === 'down') {
        if (filtered.length > 0) {
          selectedIdx = (selectedIdx + 1) % filtered.length;
        }
        cleanAndDraw();
        return;
      }
      
      if (key.name === 'backspace') {
        filterQuery = filterQuery.slice(0, -1);
        selectedIdx = 0;
        cleanAndDraw();
        return;
      }
      
      if (str && str.length === 1 && !key.ctrl && !key.meta && key.name !== 'space') {
        filterQuery += str;
        selectedIdx = 0;
        cleanAndDraw();
        return;
      }
    }
    
    stdin.on('keypress', keypressHandler);
    cleanAndDraw();
  });
}

// Simple text prompt
function askRawInput(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Autocomplete prompt with box borders & bottom status bar aligned with mockup
export async function askQuestion(promptText) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    
    let input = '';
    let suggestions = [];
    let selectedIdx = 0;
    let showingSuggestions = false;
    let ctrlXActive = false;
    
    const cfg = config.getConfig();
    const providerName = cfg.provider || 'gemini';
    const modelName = cfg.model || 'gemini-2.5-flash';
    
    const width = process.stdout.columns || 80;
    
    // Draw the box ONCE initially
    stdout.write(chalk.gray('┌' + '─'.repeat(width - 2) + '┐') + '\n');
    stdout.write(chalk.gray('│ ') + ' '.repeat(width - 4) + chalk.gray(' │') + '\n');
    stdout.write(chalk.gray('└' + '─'.repeat(width - 2) + '┘') + '\n');
    
    // Draw status line once
    const statusLine = getStatusLine();
    stdout.write(statusLine + '\n');
    
    // Reserve 12 lines for suggestions
    for (let i = 0; i < 12; i++) {
      stdout.write('\n');
    }
    
    // Move cursor back up: 12 (suggestions) + 1 (status line) + 2 (bottom border + input line) = 15 lines up!
    readline.moveCursor(stdout, 0, -15);
    readline.cursorTo(stdout, 2);
    
    function getStatusLine() {
      const ctrlText = ctrlXActive ? chalk.yellow('  [CTRL+X Active]') : '';
      const mode = (cfg.mode || 'algo').toUpperCase();
      const leftStatus = `enter send  [Mode: ${mode}]${ctrlText}`;
      const rightStatus = `${providerName.toUpperCase()} / ${modelName}`;
      const spacesCount = Math.max(1, width - leftStatus.length - rightStatus.length);
      return chalk.gray(leftStatus) + ' '.repeat(spacesCount) + chalk.gray(rightStatus);
    }
    
    function drawPromptText() {
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      
      const promptLine = `> ${input}`;
      const paddingSpaces = Math.max(0, width - 4 - promptLine.length);
      stdout.write(
        chalk.gray('│ ') + 
        chalk.white(promptLine) + 
        ' '.repeat(paddingSpaces) + 
        chalk.gray(' │')
      );
      
      readline.cursorTo(stdout, 2 + input.length);
    }
    
    function drawSuggestions() {
      if (showingSuggestions && suggestions.length > 0) {
        // Move down from Line 2 (prompt line) to Line 4 (status line)
        readline.moveCursor(stdout, 0, 2);
        
        // Write newline to move to Line 5 (first reserved line)
        stdout.write('\n');
        readline.clearLine(stdout, 0);
        stdout.write(chalk.blue('--- Suggestions (Press Up/Down/Enter to select) ---'));
        
        // Write each suggestion
        suggestions.forEach((cmd, idx) => {
          stdout.write('\n');
          readline.clearLine(stdout, 0);
          if (idx === selectedIdx) {
            stdout.write(chalk.black.bgCyan(` > ${cmd} `));
          } else {
            stdout.write(chalk.cyan(`   ${cmd}`));
          }
        });
        
        // Move cursor back up to prompt line Line 2
        readline.moveCursor(stdout, 0, -(suggestions.length + 3));
        readline.cursorTo(stdout, 2 + input.length);
      }
    }
    
    function cleanSuggestions() {
      if (showingSuggestions && suggestions.length > 0) {
        // Move down 2 lines (Line 2 to Line 4)
        readline.moveCursor(stdout, 0, 2);
        
        // Move down and clear header (Line 5)
        readline.moveCursor(stdout, 0, 1);
        readline.clearLine(stdout, 0);
        
        // Clear each suggestion line
        for (let i = 0; i < suggestions.length; i++) {
          readline.moveCursor(stdout, 0, 1);
          readline.clearLine(stdout, 0);
        }
        
        // Move back up to Line 2
        readline.moveCursor(stdout, 0, -(suggestions.length + 3));
        readline.cursorTo(stdout, 2 + input.length);
        showingSuggestions = false;
      }
    }
    
    function updateStatusLine() {
      // Move down 2 lines (from prompt line Line 2 to status line Line 4)
      readline.moveCursor(stdout, 0, 2);
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(getStatusLine());
      
      // Move back up 2 lines to prompt line Line 2
      readline.moveCursor(stdout, 0, -2);
      readline.cursorTo(stdout, 2 + input.length);
    }
    
    function cleanEverythingBeforeExit() {
      cleanSuggestions();
      
      // Clear current promptLine (line 2)
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      
      // Move up to topBorder (line 1) and clear it
      readline.moveCursor(stdout, 0, -1);
      readline.clearLine(stdout, 0);
      
      // Move down to promptLine (line 2) and clear it
      readline.moveCursor(stdout, 0, 1);
      readline.clearLine(stdout, 0);
      
      // Move down to bottomBorder (line 3) and clear it
      readline.moveCursor(stdout, 0, 1);
      readline.clearLine(stdout, 0);
      
      // Move down to statusLine (line 4) and clear it
      readline.moveCursor(stdout, 0, 1);
      readline.clearLine(stdout, 0);
      
      // Move down and clear the 12 reserved lines
      for (let i = 0; i < 12; i++) {
        readline.moveCursor(stdout, 0, 1);
        readline.clearLine(stdout, 0);
      }
      
      // Move back up to the top border position Line 1
      readline.moveCursor(stdout, 0, -15);
      readline.cursorTo(stdout, 0);
    }
    
    function keypressHandler(str, key) {
      if (key.ctrl && key.name === 'c') {
        cleanEverythingBeforeExit();
        cleanup();
        process.exit(0);
      }
      
      if (key.ctrl && key.name === 'x') {
        ctrlXActive = true;
        updateStatusLine();
        return;
      }
      
      if (ctrlXActive) {
        ctrlXActive = false;
        cleanEverythingBeforeExit();
        cleanup();
        
        const shortcutMap = {
          'h': '/help',
          'e': '/editor',
          'm': '/models',
          'g': '/coding-models',
          'd': '/debugger',
          'i': '/init',
          'c': '/compact',
          'l': '/sessions',
          'p': '/provider',
          's': '/system',
          'y': '/history',
          'o': '/clear',
          't': '/terminal',
          'q': '/exit'
        };
        
        const mappedCmd = shortcutMap[key.name];
        if (mappedCmd) {
          resolve(mappedCmd);
        } else {
          updateStatusLine();
          drawPromptText();
        }
        return;
      }
      
      if (key.name === 'return') {
        if (showingSuggestions && suggestions.length > 0) {
          input = suggestions[selectedIdx] + ' ';
          cleanSuggestions();
          drawPromptText();
        } else {
          cleanEverythingBeforeExit();
          cleanup();
          resolve(input.trim());
        }
        return;
      }
      
      if (key.name === 'up' && showingSuggestions && suggestions.length > 0) {
        selectedIdx = (selectedIdx - 1 + suggestions.length) % suggestions.length;
        cleanSuggestions();
        showingSuggestions = true;
        updateSuggestions();
        drawSuggestions();
        return;
      }
      
      if (key.name === 'down' && showingSuggestions && suggestions.length > 0) {
        selectedIdx = (selectedIdx + 1) % suggestions.length;
        cleanSuggestions();
        showingSuggestions = true;
        updateSuggestions();
        drawSuggestions();
        return;
      }
      
      if (key.name === 'backspace') {
        if (input.length > 0) {
          cleanSuggestions();
          input = input.slice(0, -1);
          drawPromptText();
        }
      } else if (str && !key.meta && key.name !== 'escape') {
        cleanSuggestions();
        input += str;
        drawPromptText();
      }
      
      updateSuggestions();
      drawSuggestions();
    }
    
    function updateSuggestions() {
      if (input.startsWith('/')) {
        const query = input.toLowerCase();
        suggestions = COMMANDS.filter(cmd => cmd.startsWith(query));
        if (suggestions.length > 0) {
          showingSuggestions = true;
          if (selectedIdx >= suggestions.length) {
            selectedIdx = 0;
          }
        } else {
          showingSuggestions = false;
          suggestions = [];
        }
      } else {
        showingSuggestions = false;
        suggestions = [];
      }
    }
    
    function cleanup() {
      stdin.removeListener('keypress', keypressHandler);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
    }
    
    stdin.on('keypress', keypressHandler);
    
    // Draw initial text inside box
    drawPromptText();
  });
}

async function handleResponseStream(provider, systemPrompt, messages, modelName, session) {
  let fullResponse = '';
  let firstChunk = true;
  
  process.stdout.write(chalk.gray(' [Thinking...] '));
  
  try {
    // Append capability instructions to the system prompt
    const mode = config.getConfig().mode || 'algo';
    const prefix = mode === 'algo' ? 'Assistant (Commander) > ' : 'A.N.A.N.D > ';
    let capabilityInstructions = '';

    if (mode === 'algo') {
      const pool = config.getConfig().coding_models || [];
      const providerName = config.getConfig().provider || 'gemini';
      const models = await getModelsForProvider(provider, providerName);
      const poolText = pool.length > 0 
        ? `The user has selected the following pool of models for Coding Agents: [${pool.join(', ')}]. You should select from this pool when spawning agents. If you need a specific capability, spawn an agent with one of these models.`
        : `No pool of models is selected for Coding Agents. You must assign them models from the available models: [${models.join(', ')}]. Specify the model attribute in the spawn_agent tag.`;
        
      const debuggerModel = config.getConfig().debugger_model || '';
      const debuggerText = debuggerModel 
        ? `The user has selected "${debuggerModel}" as the default model for Debugger Agents. You can override it by specifying debugger_model="model_name" attribute in the spawn_agent tag if you prefer.`
        : `You can specify the model for the Debugger Agent using the debugger_model="model_name" attribute in the spawn_agent tag. If not specified, the system will choose a default model.`;

      capabilityInstructions = `
You are the Commander Agent of A.N.A.N.D.
Your job is to coordinate and complete the user's task.
You do not write code or run commands directly. Instead, you analyze the task and spawn one or more Coding Agents to execute the subtasks for you.
To spawn a Coding Agent, output the tag:
<spawn_agent model="model_name" debugger_model="debugger_model">the specific subtask instruction for the coding agent</spawn_agent>

Rules for spawning:
1. Specify the model attribute. ${poolText}
2. Specify the debugger_model attribute optionally. ${debuggerText}
3. Be precise in the subtask instructions.
4. Once a Coding Agent finishes its task, the system will feed its execution report back to you. You can then analyze the result, spawn more agents if needed, or reply to the user when the task is fully completed.
5. When you decide to spawn a Coding Agent, you MUST first explain your plan/action to the user in friendly conversational text BEFORE outputting the <spawn_agent> tag. Do not output only the tag in silence.
6. If a Coding Agent fails or returns an error, you must not assume it succeeded. You must report the failure honestly to the user or retry spawning with adjusted parameters or model.
`;
    } else {
      capabilityInstructions = `
You are A.N.A.N.D, a helpful AI assistant.
You have direct access to the local workspace and can execute commands, read files, and write files using special XML tags:
- Run a shell command: <run_command>your command here</run_command>
- Read a file: <read_file>your file path here</read_file>
- Write a file: <write_file path="your file path here">your file content here</write_file>

When you need to use a capability to complete the user's request, output the appropriate tag. Do not explain your actions before outputting the tag. Once you receive the capability output, continue your response.
`;
    }

    const fullSystemPrompt = systemPrompt 
      ? `${systemPrompt}\n${capabilityInstructions}`
      : capabilityInstructions;

    let state = 'NORMAL'; // 'NORMAL', 'THINKING', 'TAG_CANDIDATE', 'SUPPRESSED'
    let preTagState = 'NORMAL';
    let candidateBuffer = '';
    let suppressClosingTag = '';

    for await (const chunk of provider.generateStream(fullSystemPrompt, messages, modelName)) {
      if (firstChunk) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${chalk.green.bold(prefix)}`);
        firstChunk = false;
      }
      
      for (let i = 0; i < chunk.length; i++) {
        const char = chunk[i];
        fullResponse += char;
        
        if (state === 'NORMAL' || state === 'THINKING') {
          if (char === '<') {
            preTagState = state;
            state = 'TAG_CANDIDATE';
            candidateBuffer = '<';
          } else {
            if (state === 'THINKING') {
              process.stdout.write(chalk.gray(char));
            } else {
              process.stdout.write(chalk.white(char));
            }
          }
        } else if (state === 'TAG_CANDIDATE') {
          candidateBuffer += char;
          
          if (candidateBuffer === '<think>') {
            state = 'THINKING';
            process.stdout.write('\n' + chalk.gray(' 💭 Thinking: ') + '\n');
            candidateBuffer = '';
          } else if (candidateBuffer === '</think>') {
            state = 'NORMAL';
            process.stdout.write('\n\n' + chalk.white(' 💡 Response: ') + '\n');
            candidateBuffer = '';
          } else if (candidateBuffer === '<run_command>') {
            state = 'SUPPRESSED';
            suppressClosingTag = '</run_command>';
            candidateBuffer = '';
          } else if (candidateBuffer === '<read_file>') {
            state = 'SUPPRESSED';
            suppressClosingTag = '</read_file>';
            candidateBuffer = '';
          } else if (candidateBuffer.startsWith('<write_file') && char === '>') {
            state = 'SUPPRESSED';
            suppressClosingTag = '</write_file>';
            candidateBuffer = '';
          } else if (candidateBuffer.startsWith('<spawn_agent') && char === '>') {
            state = 'SUPPRESSED';
            suppressClosingTag = '</spawn_agent>';
            candidateBuffer = '';
          } else {
            const prefixes = [
              '<think>', '</think>',
              '<run_command>', '</run_command>',
              '<read_file>', '</read_file>',
              '<write_file', '</write_file>',
              '<spawn_agent', '</spawn_agent>'
            ];
            const isPossible = prefixes.some(p => p.startsWith(candidateBuffer) || candidateBuffer.startsWith('<write_file') || candidateBuffer.startsWith('<spawn_agent'));
            
            if (!isPossible) {
              state = preTagState;
              if (state === 'THINKING') {
                process.stdout.write(chalk.gray(candidateBuffer));
              } else {
                process.stdout.write(chalk.white(candidateBuffer));
              }
              candidateBuffer = '';
            }
          }
        } else if (state === 'SUPPRESSED') {
          candidateBuffer += char;
          if (candidateBuffer.endsWith(suppressClosingTag)) {
            state = 'NORMAL';
            candidateBuffer = '';
            suppressClosingTag = '';
          }
        }
      }
    }
    
    // Flush candidate buffer if stream ended while in candidate state
    if (state === 'TAG_CANDIDATE' && candidateBuffer.length > 0) {
      state = preTagState;
      if (state === 'THINKING') {
        process.stdout.write(chalk.gray(candidateBuffer));
      } else {
        process.stdout.write(chalk.white(candidateBuffer));
      }
    }
    
    if (firstChunk) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`${chalk.green.bold(prefix)}`);
    }
    process.stdout.write('\n');
    session.addMessage('assistant', fullResponse);
    
    // Check if the response contains capability XML tags and execute them
    await checkForAndRunCapabilities(fullResponse, provider, systemPrompt, modelName, session);
    
  } catch (e) {
    if (firstChunk) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`${chalk.green.bold(prefix)}`);
    }
    process.stdout.write('\n');
    console.log(chalk.red(`Error calling API provider: ${e.message}`));
  }
}

// Check for and execute agent capability requests automatically
async function checkForAndRunCapabilities(response, provider, systemPrompt, modelName, session) {
  const cmdRegex = /<run_command>([\s\S]*?)<\/run_command>/;
  const readRegex = /<read_file>([\s\S]*?)<\/read_file>/;
  const writeRegex = /<write_file path="([\s\S]*?)">([\s\S]*?)<\/write_file>/;
  const spawnRegex = /<spawn_agent([\s\S]*?)>([\s\S]*?)<\/spawn_agent>/;
  
  let action = null;
  let payload = {};
  let matchedText = '';
  
  if (cmdRegex.test(response)) {
    const match = response.match(cmdRegex);
    matchedText = match[0];
    action = 'run_command';
    payload = { command: match[1].trim() };
  } else if (readRegex.test(response)) {
    const match = response.match(readRegex);
    matchedText = match[0];
    action = 'read_file';
    payload = { path: match[1].trim() };
  } else if (writeRegex.test(response)) {
    const match = response.match(writeRegex);
    matchedText = match[0];
    action = 'write_file';
    payload = { path: match[1].trim(), content: match[2] };
  } else if (spawnRegex.test(response) && config.getConfig().mode !== 'normal') {
    const match = response.match(spawnRegex);
    matchedText = match[0];
    action = 'spawn_agent';
    const tagAttrs = match[1];
    const task = match[2].trim();
    const modelMatch = tagAttrs.match(/model="([^"]*)"/);
    const dbgMatch = tagAttrs.match(/debugger_model="([^"]*)"/);
    payload = {
      model: modelMatch ? modelMatch[1].trim() : null,
      debuggerModel: dbgMatch ? dbgMatch[1].trim() : null,
      task
    };
  }
  
  if (action) {
    if (action === 'run_command') {
      console.log(chalk.cyan(`\nTerminal > ${payload.command}`));
    } else if (action === 'read_file') {
      console.log(chalk.cyan(`\nTerminal > read ${payload.path}`));
    } else if (action === 'write_file') {
      console.log(chalk.cyan(`\nTerminal > write ${payload.path}`));
    } else if (action === 'spawn_agent') {
      console.log(chalk.magenta.bold(`\n🤖 Spawning Coding Agent for task: "${payload.task}"...`));
    }
    
    try {
      let output = '';
      if (action === 'spawn_agent') {
        output = await runCodingAgent(payload.task, payload.model, payload.debuggerModel, provider, systemPrompt, session);
      } else {
        output = await makeHarnessRequest(action, payload);
      }
      
      if (action === 'run_command') {
        console.log(chalk.gray(output));
      } else if (action === 'read_file') {
        console.log(chalk.gray(`[Content: ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}]`));
      } else if (action === 'write_file') {
        console.log(chalk.green(`[Success: ${output}]`));
      } else if (action === 'spawn_agent') {
        console.log(chalk.magenta.bold(`\n🤖 Coding Agent finished. Feeding report back to Commander...`));
      }
      
      session.addMessage('user', `[System: Capability output for ${matchedText}]:\n${output}`);
      await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
    } catch (e) {
      console.log(chalk.red(`Terminal > Error: ${e.message}`));
      session.addMessage('user', `[System: Capability execution failed/rejected for ${matchedText}]:\nError: ${e.message}`);
      await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
    }
  }
}

async function runCodingAgent(task, preferredModel, preferredDebuggerModel, commanderProvider, systemPrompt, session) {
  const cfg = config.getConfig();
  const providerName = cfg.provider || 'gemini';
  const apiKey = config.getApiKey(providerName);
  
  let agentModel = preferredModel;
  const pool = cfg.coding_models || [];
  const filesWritten = [];
  
  if (!agentModel) {
    if (pool.length > 0) {
      agentModel = pool[0];
      console.log(chalk.magenta(`   No model specified by Commander. Assigning first model from user's coding_models pool: ${chalk.bold(agentModel)}`));
    } else {
      agentModel = cfg.model || 'gemini-2.5-flash';
      console.log(chalk.magenta(`   No model specified by Commander and no pool selected. Assigning default model: ${chalk.bold(agentModel)}`));
    }
  } else {
    if (pool.length > 0 && !pool.includes(agentModel)) {
      console.log(chalk.yellow(`\n⚠️  Note: Commander spawned agent with model "${agentModel}" which is not in user's selected pool: [${pool.join(', ')}].`));
    }
  }

  console.log(chalk.magenta(`   Coding Agent Model: ${chalk.bold(agentModel)}`));

  const agentSession = new ChatSession();
  
  const agentSystemPrompt = `
You are a Coding Agent spawned by the Commander Agent to perform a specific subtask.
Your assigned subtask is: "${task}"

You have access to the local workspace and can execute commands, read files, and write files using special XML tags:
- Run a shell command: <run_command>your command here</run_command>
- Read a file: <read_file>your file path here</read_file>
- Write a file: <write_file path="your file path here">your file content here</write_file>

CRITICAL RULES:
1. ONLY execute shell commands or read/write files related directly to your assigned subtask.
2. Once you have completed your task, write a brief summary of what you did and end your output. Do not output any more tags once your task is done.
`;

  const agentProvider = ProviderManager.getProvider(providerName, apiKey);
  agentSession.addMessage('user', `Please complete the task: "${task}"`);
  
  let agentResponse = '';
  
  async function executeAgent() {
    let fullResponse = '';
    let firstChunk = true;
    
    console.log(chalk.gray(` [Coding Agent is thinking...] `));
    
    try {
      const capabilityInstructions = `
When you need to use a capability, output the tag. Do not explain your actions before outputting the tag. Once you receive the tool output, continue your response.
`;
      const fullAgentSystemPrompt = `${agentSystemPrompt}\n${capabilityInstructions}`;

      let state = 'NORMAL';
      let preTagState = 'NORMAL';
      let candidateBuffer = '';
      let suppressClosingTag = '';

      for await (const chunk of agentProvider.generateStream(fullAgentSystemPrompt, agentSession.getMessages(), agentModel)) {
        if (firstChunk) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          process.stdout.write(`${chalk.magenta.bold('Coding Agent > ')}`);
          firstChunk = false;
        }
        
        for (let i = 0; i < chunk.length; i++) {
          const char = chunk[i];
          fullResponse += char;
          
          if (state === 'NORMAL' || state === 'THINKING') {
            if (char === '<') {
              preTagState = state;
              state = 'TAG_CANDIDATE';
              candidateBuffer = '<';
            } else {
              if (state === 'THINKING') {
                process.stdout.write(chalk.gray(char));
              } else {
                process.stdout.write(chalk.magenta(char));
              }
            }
          } else if (state === 'TAG_CANDIDATE') {
            candidateBuffer += char;
            
            if (candidateBuffer === '<think>') {
              state = 'THINKING';
              process.stdout.write('\n' + chalk.gray(' 💭 Coding Agent Thinking: ') + '\n');
              candidateBuffer = '';
            } else if (candidateBuffer === '</think>') {
              state = 'NORMAL';
              process.stdout.write('\n\n' + chalk.magenta(' 💡 Coding Agent Response: ') + '\n');
              candidateBuffer = '';
            } else if (candidateBuffer === '<run_command>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</run_command>';
              candidateBuffer = '';
            } else if (candidateBuffer === '<read_file>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</read_file>';
              candidateBuffer = '';
            } else if (candidateBuffer.startsWith('<write_file') && char === '>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</write_file>';
              candidateBuffer = '';
            } else {
              const prefixes = [
                '<think>', '</think>',
                '<run_command>', '</run_command>',
                '<read_file>', '</read_file>',
                '<write_file', '</write_file>'
              ];
              const isPossible = prefixes.some(p => p.startsWith(candidateBuffer) || candidateBuffer.startsWith('<write_file'));
              
              if (!isPossible) {
                state = preTagState;
                if (state === 'THINKING') {
                  process.stdout.write(chalk.gray(candidateBuffer));
                } else {
                  process.stdout.write(chalk.magenta(candidateBuffer));
                }
                candidateBuffer = '';
              }
            }
          } else if (state === 'SUPPRESSED') {
            candidateBuffer += char;
            if (candidateBuffer.endsWith(suppressClosingTag)) {
              state = 'NORMAL';
              candidateBuffer = '';
              suppressClosingTag = '';
            }
          }
        }
      }
      
      if (state === 'TAG_CANDIDATE' && candidateBuffer.length > 0) {
        state = preTagState;
        if (state === 'THINKING') {
          process.stdout.write(chalk.gray(candidateBuffer));
        } else {
          process.stdout.write(chalk.magenta(candidateBuffer));
        }
      }
      
      if (firstChunk) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${chalk.magenta.bold('Coding Agent > ')}`);
      }
      process.stdout.write('\n');
      agentSession.addMessage('assistant', fullResponse);
      
      const cmdRegex = /<run_command>([\s\S]*?)<\/run_command>/;
      const readRegex = /<read_file>([\s\S]*?)<\/read_file>/;
      const writeRegex = /<write_file path="([\s\S]*?)">([\s\S]*?)<\/write_file>/;
      
      let action = null;
      let payload = {};
      let matchedText = '';
      
      if (cmdRegex.test(fullResponse)) {
        const match = fullResponse.match(cmdRegex);
        matchedText = match[0];
        action = 'run_command';
        payload = { command: match[1].trim() };
      } else if (readRegex.test(fullResponse)) {
        const match = fullResponse.match(readRegex);
        matchedText = match[0];
        action = 'read_file';
        payload = { path: match[1].trim() };
      } else if (writeRegex.test(fullResponse)) {
        const match = fullResponse.match(writeRegex);
        matchedText = match[0];
        action = 'write_file';
        payload = { path: match[1].trim(), content: match[2] };
      }
      
      if (action) {
        if (action === 'run_command') {
          console.log(chalk.cyan(`\nTerminal (Coding Agent) > ${payload.command}`));
        } else if (action === 'read_file') {
          console.log(chalk.cyan(`\nTerminal (Coding Agent) > read ${payload.path}`));
        } else if (action === 'write_file') {
          console.log(chalk.cyan(`\nTerminal (Coding Agent) > write ${payload.path}`));
        }
        
        try {
          const output = await makeHarnessRequest(action, payload);
          if (action === 'write_file') {
            filesWritten.push(payload.path);
          }
          if (action === 'run_command') {
            console.log(chalk.gray(output));
          } else if (action === 'read_file') {
            console.log(chalk.gray(`[Content: ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}]`));
          } else if (action === 'write_file') {
            console.log(chalk.green(`[Success: ${output}]`));
          }
          
          agentSession.addMessage('user', `[System: Capability output for ${matchedText}]:\n${output}`);
          await executeAgent();
        } catch (e) {
          console.log(chalk.red(`Terminal (Coding Agent) > Error: ${e.message}`));
          agentSession.addMessage('user', `[System: Capability execution failed/rejected for ${matchedText}]:\nError: ${e.message}`);
          await executeAgent();
        }
      } else {
        agentResponse = fullResponse;
      }
      
    } catch (e) {
      if (firstChunk) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${chalk.magenta.bold('Coding Agent > ')}`);
      }
      process.stdout.write('\n');
      console.log(chalk.red(`Error running Coding Agent: ${e.message}`));
      agentResponse = `Error executing subtask: ${e.message}`;
    }
  }
  
  await executeAgent();
  const codingReport = agentSession.getMessages().filter(m => m.role === 'assistant').map(m => m.content).join('\n\n');
  let finalReport = codingReport;
  
  if (filesWritten.length > 0) {
    const debugReport = await runDebuggerAgent(filesWritten, preferredDebuggerModel, providerName, apiKey, cfg);
    finalReport += `\n\n[System: Debugger Agent Verification Report]:\n${debugReport}`;
  }
  
  return finalReport;
}

async function runDebuggerAgent(filesWritten, preferredDebuggerModel, providerName, apiKey, cfg) {
  let debuggerModel = preferredDebuggerModel;
  if (!debuggerModel) {
    debuggerModel = cfg.debugger_model || cfg.model || 'gemini-2.5-flash';
  }

  console.log(chalk.yellow.bold(`\n🔍 Spawning Debugger Agent to verify files: [${filesWritten.join(', ')}]...`));
  console.log(chalk.yellow(`   Debugger Agent Model: ${chalk.bold(debuggerModel)}`));

  const debuggerSession = new ChatSession();
  
  const debuggerSystemPrompt = `
You are a Debugger Agent spawned to verify the files modified or written by the Coding Agent.
The files to verify are: [${filesWritten.join(', ')}]

You have access to the local workspace and can execute commands, read files, and write files using special XML tags:
- Run a shell command: <run_command>your command here</run_command>
- Read a file: <read_file>your file path here</read_file>
- Write a file: <write_file path="your file path here">your file content here</write_file>

CRITICAL RULES:
1. You must analyze the files for any syntax errors, compile errors, runtime errors, or logical bugs.
2. Read the files first, then run compilation/check/lint/run commands (e.g. compile or run them with node/python or tests) to verify they work.
3. If you find a SMALL error (like syntax errors, typos, basic bugs), you MUST fix it yourself by rewriting or modifying the file using the <write_file> tag.
4. If you find a BIG error (like design issues, missing core logic, or major bugs that require changing the requirements), do NOT fix it. Instead, write a detailed report of the error.
5. Once done, output a summary report. If there were no errors, state "Verification succeeded. No bugs found." If you fixed a small error, state what you fixed. If you found a big error, explain it clearly so the Commander Agent can solve it.
`;

  const debuggerProvider = ProviderManager.getProvider(providerName, apiKey);
  debuggerSession.addMessage('user', `Please debug and verify these files: ${filesWritten.join(', ')}`);
  
  let debuggerResponse = '';
  
  async function executeDebugger() {
    let fullResponse = '';
    let firstChunk = true;
    
    console.log(chalk.gray(` [Debugger Agent is thinking...] `));
    
    try {
      const capabilityInstructions = `
When you need to use a capability, output the tag. Do not explain your actions before outputting the tag. Once you receive the tool output, continue your response.
`;
      const fullDebuggerSystemPrompt = `${debuggerSystemPrompt}\n${capabilityInstructions}`;

      let state = 'NORMAL';
      let preTagState = 'NORMAL';
      let candidateBuffer = '';
      let suppressClosingTag = '';

      for await (const chunk of debuggerProvider.generateStream(fullDebuggerSystemPrompt, debuggerSession.getMessages(), debuggerModel)) {
        if (firstChunk) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          process.stdout.write(`${chalk.yellow.bold('Debugger Agent > ')}`);
          firstChunk = false;
        }
        
        for (let i = 0; i < chunk.length; i++) {
          const char = chunk[i];
          fullResponse += char;
          
          if (state === 'NORMAL' || state === 'THINKING') {
            if (char === '<') {
              preTagState = state;
              state = 'TAG_CANDIDATE';
              candidateBuffer = '<';
            } else {
              if (state === 'THINKING') {
                process.stdout.write(chalk.gray(char));
              } else {
                process.stdout.write(chalk.yellow(char));
              }
            }
          } else if (state === 'TAG_CANDIDATE') {
            candidateBuffer += char;
            
            if (candidateBuffer === '<think>') {
              state = 'THINKING';
              process.stdout.write('\n' + chalk.gray(' 💭 Debugger Agent Thinking: ') + '\n');
              candidateBuffer = '';
            } else if (candidateBuffer === '</think>') {
              state = 'NORMAL';
              process.stdout.write('\n\n' + chalk.yellow(' 💡 Debugger Agent Response: ') + '\n');
              candidateBuffer = '';
            } else if (candidateBuffer === '<run_command>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</run_command>';
              candidateBuffer = '';
            } else if (candidateBuffer === '<read_file>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</read_file>';
              candidateBuffer = '';
            } else if (candidateBuffer.startsWith('<write_file') && char === '>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</write_file>';
              candidateBuffer = '';
            } else {
              const prefixes = [
                '<think>', '</think>',
                '<run_command>', '</run_command>',
                '<read_file>', '</read_file>',
                '<write_file', '</write_file>'
              ];
              const isPossible = prefixes.some(p => p.startsWith(candidateBuffer) || candidateBuffer.startsWith('<write_file'));
              
              if (!isPossible) {
                state = preTagState;
                if (state === 'THINKING') {
                  process.stdout.write(chalk.gray(candidateBuffer));
                } else {
                  process.stdout.write(chalk.yellow(candidateBuffer));
                }
                candidateBuffer = '';
              }
            }
          } else if (state === 'SUPPRESSED') {
            candidateBuffer += char;
            if (candidateBuffer.endsWith(suppressClosingTag)) {
              state = 'NORMAL';
              candidateBuffer = '';
              suppressClosingTag = '';
            }
          }
        }
      }
      
      if (state === 'TAG_CANDIDATE' && candidateBuffer.length > 0) {
        state = preTagState;
        if (state === 'THINKING') {
          process.stdout.write(chalk.gray(candidateBuffer));
        } else {
          process.stdout.write(chalk.yellow(candidateBuffer));
        }
      }
      
      if (firstChunk) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${chalk.yellow.bold('Debugger Agent > ')}`);
      }
      process.stdout.write('\n');
      debuggerSession.addMessage('assistant', fullResponse);
      
      const cmdRegex = /<run_command>([\s\S]*?)<\/run_command>/;
      const readRegex = /<read_file>([\s\S]*?)<\/read_file>/;
      const writeRegex = /<write_file path="([\s\S]*?)">([\s\S]*?)<\/write_file>/;
      
      let action = null;
      let payload = {};
      let matchedText = '';
      
      if (cmdRegex.test(fullResponse)) {
        const match = fullResponse.match(cmdRegex);
        matchedText = match[0];
        action = 'run_command';
        payload = { command: match[1].trim() };
      } else if (readRegex.test(fullResponse)) {
        const match = fullResponse.match(readRegex);
        matchedText = match[0];
        action = 'read_file';
        payload = { path: match[1].trim() };
      } else if (writeRegex.test(fullResponse)) {
        const match = fullResponse.match(writeRegex);
        matchedText = match[0];
        action = 'write_file';
        payload = { path: match[1].trim(), content: match[2] };
      }
      
      if (action) {
        if (action === 'run_command') {
          console.log(chalk.cyan(`\nTerminal (Debugger Agent) > ${payload.command}`));
        } else if (action === 'read_file') {
          console.log(chalk.cyan(`\nTerminal (Debugger Agent) > read ${payload.path}`));
        } else if (action === 'write_file') {
          console.log(chalk.cyan(`\nTerminal (Debugger Agent) > write ${payload.path}`));
        }
        
        try {
          const output = await makeHarnessRequest(action, payload);
          if (action === 'run_command') {
            console.log(chalk.gray(output));
          } else if (action === 'read_file') {
            console.log(chalk.gray(`[Content: ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}]`));
          } else if (action === 'write_file') {
            console.log(chalk.green(`[Success: ${output}]`));
          }
          
          debuggerSession.addMessage('user', `[System: Capability output for ${matchedText}]:\n${output}`);
          await executeDebugger();
        } catch (e) {
          console.log(chalk.red(`Terminal (Debugger Agent) > Error: ${e.message}`));
          debuggerSession.addMessage('user', `[System: Capability execution failed/rejected for ${matchedText}]:\nError: ${e.message}`);
          await executeDebugger();
        }
      } else {
        debuggerResponse = fullResponse;
      }
      
    } catch (e) {
      if (firstChunk) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${chalk.yellow.bold('Debugger Agent > ')}`);
      }
      process.stdout.write('\n');
      console.log(chalk.red(`Error running Debugger Agent: ${e.message}`));
      debuggerResponse = `Error executing debugging: ${e.message}`;
    }
  }
  
  await executeDebugger();
  console.log(chalk.yellow.bold(`\n🔍 Debugger Agent finished.`));
  return debuggerSession.getMessages().filter(m => m.role === 'assistant').map(m => m.content).join('\n\n');
}

// Multi-line editor mode logic for /editor command
async function handleEditorCommand() {
  console.log(chalk.yellow.bold('\n--- Multi-Line Editor Mode ---'));
  console.log(chalk.gray("Type text. To submit, type 'SAVE' on a new line and press Enter. To cancel, type 'EXIT'.\n"));
  
  const lines = [];
  while (true) {
    const line = await askRawInput('');
    if (line.trim().toUpperCase() === 'SAVE') {
      break;
    }
    if (line.trim().toUpperCase() === 'EXIT') {
      console.log(chalk.red('Editor cancelled.'));
      return null;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// /init command: create AGENTS.md rules file
function handleInitCommand() {
  const filePath = path.resolve('AGENTS.md');
  const content = `# Workspace Coding Guidelines

This workspace uses autonomous coding agents for development.

## Collaboration Rules
1. **Design Before Coding**: Propose architectural specs inside \`project.md\` before generating files.
2. **Task Division**: Maintain a clear \`task.md\` outlining current tasks and interfaces.
3. **No Placeholders**: Ensure all generated files are complete, functional, and documented.
4. **Environment Secrets**: Do not commit secrets, API keys, or active configuration values directly to code. Use \`.env\` and configuration managers.
`;
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(chalk.green(`Successfully initialized Agent Rules file: `) + chalk.cyan(filePath));
  } catch (e) {
    console.error(chalk.red(`Error writing AGENTS.md: ${e.message}`));
  }
}

// /compact command: summarize history using LLM to save token memory
async function handleCompactCommand(session, cfg) {
  const messages = session.getMessages();
  if (messages.length === 0) {
    console.log(chalk.yellow('No history to compact.'));
    return;
  }
  
  const providerName = cfg.provider || 'gemini';
  const apiKey = config.getApiKey(providerName);
  
  console.log(chalk.yellow('Requesting summarization to compact conversation memory...'));
  
  try {
    const provider = ProviderManager.getProvider(providerName, apiKey);
    const compactMessages = [
      ...messages,
      { role: 'user', content: 'Provide a concise summary of our entire discussion so far in one paragraph to use as context.' }
    ];
    
    let summary = '';
    for await (const chunk of provider.generateStream('You are a context compaction utility.', compactMessages, cfg.model)) {
      summary += chunk;
    }
    
    session.clear();
    session.addMessage('system', `Conversation summary context: ${summary}`);
    console.log(chalk.green('Context successfully compacted! Summary saved:'));
    console.log(chalk.italic.gray(summary));
  } catch (e) {
    console.log(chalk.red(`Compaction failed: ${e.message}`));
  }
}

// /sessions command: list saved session exports
function handleSessionsCommand() {
  const exportDir = path.resolve('exports');
  if (!fs.existsSync(exportDir)) {
    console.log(chalk.yellow('No saved sessions found (exports/ directory does not exist).'));
    return;
  }
  
  try {
    const files = fs.readdirSync(exportDir).filter(f => f.endsWith('.md'));
    if (files.length === 0) {
      console.log(chalk.yellow('No exported sessions in exports/ folder.'));
      return;
    }
    
    console.log(chalk.magenta.bold('\n--- Exported Chat Sessions ---'));
    files.forEach((file, idx) => {
      const stats = fs.statSync(path.join(exportDir, file));
      const sizeStr = `${(stats.size / 1024).toFixed(2)} KB`;
      console.log(`${chalk.cyan(idx + 1)}. ${file.padEnd(30)} (${sizeStr})`);
    });
    console.log('');
  } catch (e) {
    console.error(chalk.red(`Error reading sessions: ${e.message}`));
  }
}

async function handleProviderCommand(args, cfg) {
  let providerName = '';
  
  if (args.length === 0) {
    const options = ['gemini', 'openai', 'anthropic', 'nvidia', 'ollama'];
    providerName = await askSelection(chalk.magenta.bold('Select LLM Provider:'), options, cfg.provider);
  } else {
    providerName = args[0].toLowerCase();
  }

  if (!['gemini', 'openai', 'anthropic', 'nvidia', 'ollama'].includes(providerName)) {
    console.log(chalk.red(`Error: Unknown provider '${providerName}'.`));
    return;
  }

  if (providerName !== 'ollama') {
    let apiKey = config.getApiKey(providerName);
    if (!apiKey) {
      console.log(chalk.yellow(`API key not configured for ${providerName.toUpperCase()}.`));
      apiKey = await askRawInput(`Enter API Key for ${providerName.toUpperCase()}: `);
      if (!apiKey) {
        console.log(chalk.red('Error: API Key is required to activate this provider.'));
        return;
      }
      config.saveApiKey(providerName, apiKey);
    }
  }

  config.updateConfig('provider', providerName);
  config.updateConfig('coding_models', []);
  config.updateConfig('debugger_model', '');

  const defaultModels = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-latest',
    nvidia: 'meta/llama-3.1-70b-instruct',
    ollama: 'llama3'
  };
  const newModel = defaultModels[providerName];
  config.updateConfig('model', newModel);

  console.log(chalk.green(`Switched active provider to: `) + chalk.green.bold(providerName.toUpperCase()) + chalk.green(` (Default Model: ${newModel})`));
}

async function handleModelsCommand(cfg) {
  const providerName = cfg.provider || 'gemini';
  const apiKey = config.getApiKey(providerName);

  try {
    const provider = ProviderManager.getProvider(providerName, apiKey);
    const models = await provider.listModels();

    if (models.length === 0) {
      console.log(chalk.yellow('No models found for active provider.'));
      return;
    }

    const selectedModel = await askSelection(
      chalk.magenta.bold(`Select Model for ${providerName.toUpperCase()}:`),
      models,
      cfg.model
    );

    if (selectedModel) {
      config.updateConfig('model', selectedModel);
      console.log(chalk.green('Active model set to: ') + chalk.green.bold(selectedModel));
    }
  } catch (e) {
    console.log(chalk.red(`Error listing models: ${e.message}`));
  }
}

async function handleCodingModelsCommand(cfg) {
  const providerName = cfg.provider || 'gemini';
  const apiKey = config.getApiKey(providerName);

  try {
    const provider = ProviderManager.getProvider(providerName, apiKey);
    const models = await provider.listModels();

    if (models.length === 0) {
      console.log(chalk.yellow('No models found for active provider.'));
      return;
    }

    const currentPool = cfg.coding_models || [];
    console.log(chalk.magenta(`\nCurrent Coding Agent models pool: [${currentPool.join(', ')}]`));

    const selectedPool = await askMultiSelection(
      chalk.magenta.bold(`Toggle Models for Coding Agents pool (active provider: ${providerName.toUpperCase()}):`),
      models,
      currentPool
    );

    config.updateConfig('coding_models', selectedPool);
    console.log(chalk.green('\nCoding Agent models pool updated to: ') + chalk.green.bold(`[${selectedPool.join(', ')}]`));
  } catch (e) {
    console.log(chalk.red(`Error listing models: ${e.message}`));
  }
}

async function handleDebuggerCommand(cfg) {
  const providerName = cfg.provider || 'gemini';
  const apiKey = config.getApiKey(providerName);

  try {
    const provider = ProviderManager.getProvider(providerName, apiKey);
    const models = await provider.listModels();

    if (models.length === 0) {
      console.log(chalk.yellow('No models found for active provider.'));
      return;
    }

    const currentModel = cfg.debugger_model || '';
    if (currentModel) {
      console.log(chalk.yellow(`Current Debugger model: ${chalk.bold(currentModel)}`));
    }

    const selectedModel = await askSelection(
      chalk.magenta.bold(`Select Model for Debugger Agent (active provider: ${providerName.toUpperCase()}):`),
      models,
      cfg.debugger_model || cfg.model
    );

    if (selectedModel) {
      config.updateConfig('debugger_model', selectedModel);
      console.log(chalk.green('Debugger Agent model set to: ') + chalk.green.bold(selectedModel));
    }
  } catch (e) {
    console.log(chalk.red(`Error listing models: ${e.message}`));
  }
}

function handleSystemCommand(args, cfg) {
  if (args.length === 0) {
    const current = cfg.system_prompt || 'None';
    console.log(chalk.green(`Current system prompt: ${current}`));
    return;
  }

  const prompt = args.join(' ');
  config.updateConfig('system_prompt', prompt);
  console.log(chalk.green(`System prompt updated.`));
}

function handleHistoryCommand(args, session) {
  if (args[0] === 'export') {
    const filepath = session.exportToMarkdown();
    console.log(chalk.green(`Chat history exported to: `) + chalk.cyan(filepath));
    return;
  }

  const messages = session.messages;
  if (messages.length === 0) {
    console.log(chalk.yellow('No history in this session.'));
    return;
  }

  console.log(chalk.magenta.bold('\n--- Session History ---'));
  messages.forEach(msg => {
    const role = msg.role.toUpperCase();
    const color = role === 'USER' ? chalk.cyan : role === 'ASSISTANT' ? chalk.green : chalk.magenta;
    console.log(color(`${role}:`) + ` ${msg.content}`);
    console.log(chalk.gray('-'.repeat(40)));
  });
}

async function handleTerminalCommand() {
  console.log(chalk.yellow.bold('\n--- Interactive Terminal Mode ---'));
  console.log(chalk.gray("Type shell commands to run them via the harness. Type 'exit' to return to Chat Mode.\n"));
  
  while (true) {
    const command = await askRawInput(chalk.green('Terminal > '));
    if (!command) continue;
    if (command.trim().toLowerCase() === 'exit') {
      console.log(chalk.yellow('Returning to Chat Mode.'));
      break;
    }
    
    console.log(chalk.yellow(`Requesting harness to run command: ${command}...`));
    try {
      const output = await makeHarnessRequest('run_command', { command });
      console.log(chalk.green('\n--- Command Output ---'));
      console.log(output);
    } catch (e) {
      console.log(chalk.red(`\nError: ${e.message}`));
    }
    console.log(''); // empty line
  }
}

async function main() {
  drawWelcomeScreen();
  const session = new ChatSession();

  while (true) {
    const cfg = config.getConfig();
    const providerName = cfg.provider || 'gemini';
    const modelName = cfg.model || 'gemini-2.5-flash';
    const systemPrompt = cfg.system_prompt || '';

    const userInput = await askQuestion(`${chalk.cyan.bold('You > ')}`);
    if (!userInput) continue;

    // Handle slash commands
    if (userInput.startsWith('/')) {
      const parts = userInput.split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      if (cmd === '/exit') {
        console.log(chalk.yellow('Exiting... Goodbye!'));
        break;
      }
      if (cmd === '/help') {
        showHelp();
        continue;
      }
      if (cmd === '/provider') {
        await handleProviderCommand(args, cfg);
        continue;
      }
      if (cmd === '/models') {
        await handleModelsCommand(cfg);
        continue;
      }
      if (cmd === '/coding-models') {
        await handleCodingModelsCommand(cfg);
        continue;
      }
      if (cmd === '/debugger') {
        await handleDebuggerCommand(cfg);
        continue;
      }
      if (cmd === '/algo') {
        config.updateConfig('mode', 'algo');
        console.log(chalk.green('Switched to Multi-Agent Algorithm mode [ALGO]'));
        continue;
      }
      if (cmd === '/normal') {
        config.updateConfig('mode', 'normal');
        console.log(chalk.green('Switched to Normal Chatbot mode [NORMAL]'));
        continue;
      }
      if (cmd === '/system') {
        handleSystemCommand(args, cfg);
        continue;
      }
      if (cmd === '/history') {
        handleHistoryCommand(args, session);
        continue;
      }
      if (cmd === '/clear') {
        session.clear();
        firstMessageSent = false;
        drawWelcomeScreen();
        console.log(chalk.green('Session memory and workspace UI reset.'));
        continue;
      }
      if (cmd === '/editor') {
        const text = await handleEditorCommand();
        if (text) {
          // If first message and logo is not cleared yet
          if (!firstMessageSent) {
            console.clear();
            firstMessageSent = true;
          }
          
          session.addMessage('user', text);
          console.log(`${chalk.cyan.bold('You > ')}${text}`);
          
          const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
          await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
        }
        continue;
      }
      if (cmd === '/init') {
        handleInitCommand();
        continue;
      }
      if (cmd === '/compact') {
        await handleCompactCommand(session, cfg);
        continue;
      }
      if (cmd === '/sessions') {
        handleSessionsCommand();
        continue;
      }
      if (cmd === '/terminal') {
        await handleTerminalCommand();
        continue;
      }
      
      // Harness capability routing commands
      if (cmd === '/run') {
        if (args.length === 0) {
          console.log(chalk.red('Error: Command text required. Usage: /run <shell command>'));
          continue;
        }
        const commandToRun = args.join(' ');
        console.log(chalk.yellow(`Requesting harness to run command: ${commandToRun}...`));
        try {
          const output = await makeHarnessRequest('run_command', { command: commandToRun });
          console.log(chalk.green('\n--- Command Output ---'));
          console.log(output);
        } catch (e) {
          console.log(chalk.red(`\nError: ${e.message}`));
        }
        continue;
      }
      
      if (cmd === '/read') {
        if (args.length === 0) {
          console.log(chalk.red('Error: File path required. Usage: /read <file path>'));
          continue;
        }
        const filePath = args[0];
        console.log(chalk.yellow(`Requesting harness to read file: ${filePath}...`));
        try {
          const output = await makeHarnessRequest('read_file', { path: filePath });
          console.log(chalk.green('\n--- File Content ---'));
          console.log(output);
        } catch (e) {
          console.log(chalk.red(`\nError: ${e.message}`));
        }
        continue;
      }
      
      if (cmd === '/write') {
        if (args.length < 2) {
          console.log(chalk.red('Error: File path and content required. Usage: /write <file path> <content>'));
          continue;
        }
        const filePath = args[0];
        const fileContent = args.slice(1).join(' ');
        console.log(chalk.yellow(`Requesting harness to write file: ${filePath}...`));
        try {
          const output = await makeHarnessRequest('write_file', { path: filePath, content: fileContent });
          console.log(chalk.green(`\nSuccess: ${output}`));
        } catch (e) {
          console.log(chalk.red(`\nError: ${e.message}`));
        }
        continue;
      }
      
      console.log(chalk.red(`Unknown command: ${cmd}. Type /help for assistance.`));
      continue;
    }

    // Clear the welcome screen / logo as soon as the first chat message is sent
    if (!firstMessageSent) {
      console.clear();
      firstMessageSent = true;
    }

    // Call API provider for standard chat messages
    const apiKey = config.getApiKey(providerName);
    if (providerName !== 'ollama' && !apiKey) {
      console.log(chalk.red(`Error: API Key for ${providerName.toUpperCase()} is not configured.`));
      console.log(chalk.yellow('Please set it using the /provider command first.'));
      continue;
    }

    session.addMessage('user', userInput);
    console.log(`${chalk.cyan.bold('You > ')}${userInput}`);
    
    const provider = ProviderManager.getProvider(providerName, apiKey);
    await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
  }
}

main().catch(console.error);
