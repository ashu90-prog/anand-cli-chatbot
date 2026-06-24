import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import * as config from './config.js';
import { ChatSession } from './history.js';
import { ProviderManager, PROVIDERS_CONFIG } from './providers.js';

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
  '/goal',
  '/loop',
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

const debugLogPath = 'C:/Users/anand/OneDrive/Documents/Companion/03_Projects/OpenSource/CLI/Chatbot/NodeJS/debug_status.log';
try {
  fs.writeFileSync(debugLogPath, `=== Chatbot Debug Log Started at ${new Date().toISOString()} ===\n`);
} catch (e) {}

function logDebug(msg) {
  try {
    const stdin = process.stdin;
    const kpCount = stdin.listeners('keypress').length;
    const dataCount = stdin.listeners('data').length;
    const lineCount = stdin.listeners('line').length;
    const isRaw = stdin.isRaw;
    const isPaused = stdin.readableFlowing === null ? 'paused' : (stdin.readableFlowing ? 'flowing' : 'paused');
    const logMsg = `[${new Date().toISOString()}] ${msg} | Raw: ${isRaw} | Paused: ${isPaused} | KP Listeners: ${kpCount} | Data Listeners: ${dataCount} | Line Listeners: ${lineCount}\n`;
    fs.appendFileSync(debugLogPath, logMsg);
  } catch (e) {
    // Ignore logging errors
  }
}

let firstMessageSent = false;
let chatCursorRow = 1;
let chatCursorCol = 1;
let promptCursorRow = null;
let promptCursorCol = null;
const HAS_HARNESS = process.env.ANAND_HARNESS === 'true';

// Harness request counter and responder mapping
let harnessRequestId = 0;
const harnessCallbacks = new Map();
const whitelist = new Set();

let cachedModelsList = null;
let lastCachedProvider = null;
let activeGoal = null;
let activeLoop = null;
let interrupted = false;
let currentAbortController = null;

let currentTodos = [];
let accumulatedFilesWritten = [];
let lastTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
let sessionCumulativeTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function parseTodos(text) {
  const match = text.match(/<todos>([\s\S]*?)(?:<\/todos>|$)/);
  if (!match) return [];
  const lines = match[1].split('\n');
  const list = [];
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const todoMatch = line.match(/^[-*+•\d.]?\s*\[([ xX✓/~])\]\s*(.*)$/) || line.match(/^[-*+•\d.]?\s*\[(.*?)\]\s*(.*)$/);
    if (todoMatch) {
      const statusChar = todoMatch[1].trim().toLowerCase();
      const taskText = todoMatch[2].trim();
      let status = 'todo';
      if (statusChar === 'x' || statusChar === '✓' || statusChar === 'done') {
        status = 'done';
      } else if (statusChar === '/' || statusChar === '~' || statusChar === 'doing' || statusChar === 'in-progress') {
        status = 'doing';
      }
      list.push({ text: taskText, status });
    } else if (line.startsWith('-') || line.startsWith('*') || line.match(/^\d+\./)) {
      const taskText = line.replace(/^[-*+\d.]+\s*/, '').trim();
      list.push({ text: taskText, status: 'todo' });
    }
  }
  return list;
}

function updateTodosFromText(text) {
  const parsed = parseTodos(text);
  if (parsed && parsed.length > 0) {
    currentTodos = parsed;
  }
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

const CONTEXT_LIMITS = {
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-pro': 2000000,
  'gemini-1.5-flash': 1000000,
  'gemini-1.5-pro': 2000000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'o1-mini': 128000,
  'claude-3-5-sonnet-latest': 200000,
  'claude-3-5-haiku-latest': 200000,
  'claude-3-opus-latest': 200000
};

function getModelContextLimit(modelName) {
  const key = Object.keys(CONTEXT_LIMITS).find(k => modelName.includes(k));
  return key ? CONTEXT_LIMITS[key] : 128000;
}

function formatCompactNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(0) + 'K';
  }
  return num.toString();
}

function drawPermanentPanel() {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;
  if (!firstMessageSent || width < 80) return;

  const W_panel = width >= 100 ? 35 : 30;
  const W_chat = width - W_panel - 3;
  const cfg = config.getConfig();
  const modelName = cfg.model || 'gemini-2.5-flash';
  const panelLines = getPanelLines(modelName);

  const panelWidth = width - (W_chat + 1);
  for (let r = 1; r <= height; r++) {
    // 1. Draw the divider at column W_chat + 1
    process.stdout.write(`\u001b[${r};${W_chat + 1}H` + chalk.blue('│'));
    
    // 2. Draw the panel content or pitch black spacing from column W_chat + 2 to width
    if (r <= panelLines.length) {
      const line = panelLines[r - 1];
      const remainingSpaces = Math.max(0, panelWidth - W_panel);
      process.stdout.write(`\u001b[${r};${W_chat + 2}H` + line + chalk.bgHex('#1e1e24')(' '.repeat(remainingSpaces)));
    } else {
      process.stdout.write(`\u001b[${r};${W_chat + 2}H` + chalk.bgHex('#1e1e24')(' '.repeat(panelWidth)));
    }
  }

  // Restore cursor position absolutely
  if (promptCursorRow !== null) {
    process.stdout.write(`\u001b[${promptCursorRow};${promptCursorCol}H`);
  } else {
    process.stdout.write(`\u001b[${chatCursorRow};${chatCursorCol}H`);
  }
}

function getPanelLines(modelName) {
  const lines = [];
  const width = process.stdout.columns || 80;
  const W = width >= 100 ? 35 : 30;
  const innerW = W - 2;

  const formatLine = (str) => {
    const cleanStr = str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?::[0-9]{1,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    const padding = Math.max(0, innerW - cleanStr.length);
    return chalk.bgHex('#1e1e24')(' ' + str + ' '.repeat(padding));
  };

  // Center Title dynamically
  const title = 'A.N.A.N.D PANEL';
  const titlePadding = Math.max(0, Math.floor((innerW - title.length) / 2));
  const centeredTitle = ' '.repeat(titlePadding) + title + ' '.repeat(innerW - title.length - titlePadding);
  lines.push(chalk.bgHex('#1e1e24').blue.bold(centeredTitle));
  lines.push(formatLine(''));

  lines.push(formatLine(chalk.blue.bold('TOKEN USAGE (Last Output)')));
  lines.push(formatLine(`  Prompt:     ${lastTokenUsage.promptTokens.toLocaleString()}`));
  lines.push(formatLine(`  Completion: ${lastTokenUsage.completionTokens.toLocaleString()}`));
  lines.push(formatLine(`  Total:      ${lastTokenUsage.totalTokens.toLocaleString()}`));
  lines.push(formatLine(''));

  const limit = getModelContextLimit(modelName);
  const used = lastTokenUsage.promptTokens || 0;
  const pct = Math.min(100, (used / limit) * 100);
  const barLen = W >= 35 ? 16 : 12;
  const filledLen = Math.round((pct / 100) * barLen);
  const bar = '█'.repeat(filledLen) + '░'.repeat(Math.max(0, barLen - filledLen));
  
  lines.push(formatLine(chalk.blue.bold('CONTEXT WINDOW')));
  lines.push(formatLine(`  Used:  ${formatCompactNumber(used)} / ${formatCompactNumber(limit)}`));
  lines.push(formatLine(`  Pct:   ${pct.toFixed(2)}%`));
  lines.push(formatLine(`  Bar:   [${chalk.blue(bar)}]`));
  lines.push(formatLine(''));

  lines.push(formatLine(chalk.blue.bold('TODO CHECKLIST')));
  if (currentTodos.length === 0) {
    lines.push(formatLine(chalk.gray('  (No tasks active)')));
  } else {
    currentTodos.forEach((todo) => {
      let statusIcon = chalk.gray('[ ]');
      if (todo.status === 'done') {
        statusIcon = chalk.blue('[✓]');
      } else if (todo.status === 'doing') {
        statusIcon = chalk.cyan('[⋯]');
      }
      const maxTextLen = innerW - 8;
      let textToShow = todo.text;
      if (textToShow.length > maxTextLen) {
        textToShow = textToShow.substring(0, maxTextLen - 3) + '...';
      }
      lines.push(formatLine(`  ${statusIcon} ${textToShow}`));
    });
  }

  return lines;
}

class DualColumnPrinter {
  constructor(modelName, styleFn = null) {
    this.modelName = modelName;
    this.lineBuffer = '';
    this.panelLineIndex = 0;
    this.styleFn = styleFn;
    this.prefix = '';
    this.prefixCleanLength = 0;
    this.indent = '  '; // Default 2 spaces
  }

  setPrefix(prefix, cleanLength) {
    this.prefix = prefix;
    this.prefixCleanLength = cleanLength;
  }

  writeChar(char) {
    const width = process.stdout.columns || 80;
    const showPanel = firstMessageSent && width >= 80;
    const W_panel = width >= 100 ? 35 : 30;
    const W_chat = (showPanel ? (width - W_panel - 3) : width) - this.indent.length - 2;

    if (char === '\r') return;

    if (char === '\n') {
      this.flushLine(W_chat, W_panel, showPanel);
    } else {
      this.lineBuffer += char;
      const totalLen = this.prefixCleanLength + this.lineBuffer.length;
      if (totalLen >= W_chat) {
        this.flushLine(W_chat, W_panel, showPanel);
      } else {
        const styledChar = this.styleFn ? this.styleFn(char) : char;
        process.stdout.write(styledChar);
        if (firstMessageSent) {
          chatCursorCol++;
        }
      }
    }
  }

  getCleanLength(str) {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?::[0-9]{1,4})*)?[0-9A-ORZcf-nqry=><]/g, '').length;
  }

  flushLine(W_chat, W_panel, showPanel) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);

    const styledContent = (this.styleFn && this.lineBuffer.length > 0)
      ? this.styleFn(this.lineBuffer)
      : this.lineBuffer;

    const styledLine = this.indent + this.prefix + styledContent;
    process.stdout.write(styledLine + '\n');
    
    if (firstMessageSent) {
      const H = process.stdout.rows || 24;
      chatCursorRow++;
      if (chatCursorRow > H - 4) {
        chatCursorRow = H - 4;
      }
      chatCursorCol = this.indent.length + 1;
      process.stdout.write(this.indent);
    }
    
    this.lineBuffer = '';
    this.prefix = '';
    this.prefixCleanLength = 0;

    if (showPanel) {
      drawPermanentPanel();
    }
  }

  writeLine(text) {
    const width = process.stdout.columns || 80;
    const showPanel = firstMessageSent && width >= 80;
    const W_panel = width >= 100 ? 35 : 30;
    const W_chat = (showPanel ? (width - W_panel - 3) : width) - this.indent.length - 2;

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const wrapped = this.wrapText(line, W_chat);
      for (const wl of wrapped) {
        this.lineBuffer = wl;
        this.flushLine(W_chat, W_panel, showPanel);
      }
    }
  }

  writeUserBlock(text) {
    const width = process.stdout.columns || 80;
    const showPanel = firstMessageSent && width >= 80;
    const W_panel = width >= 100 ? 35 : 30;
    const W_chat = (showPanel ? (width - W_panel - 3) : width) - this.indent.length - 2;

    const innerWidth = W_chat - 4; // 2 for left border/space, 2 for padding inside gray box
    const wrappedLines = this.wrapText(text, innerWidth);

    const blockLines = [];
    blockLines.push(' '.repeat(W_chat - 2));
    for (const line of wrappedLines) {
      const cleanLine = this.getCleanLength(line);
      const rightPadding = Math.max(0, innerWidth - cleanLine);
      blockLines.push(' ' + line + ' '.repeat(rightPadding) + ' ');
    }
    blockLines.push(' '.repeat(W_chat - 2));

    for (const lineContent of blockLines) {
      const styledContent = chalk.bgHex('#1e1e24').white(lineContent);
      this.lineBuffer = chalk.blue('│') + ' ' + styledContent;
      this.flushLine(W_chat, W_panel, showPanel);
    }
  }

  wrapText(text, limit) {
    const lines = [];
    let currentLine = '';
    let currentLen = 0;
    let inAnsi = false;
    let ansiBuffer = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '\u001b') {
        inAnsi = true;
        ansiBuffer += char;
        continue;
      }
      if (inAnsi) {
        ansiBuffer += char;
        if (char === 'm') {
          inAnsi = false;
          currentLine += ansiBuffer;
          ansiBuffer = '';
        }
        continue;
      }

      currentLine += char;
      currentLen++;

      if (currentLen >= limit) {
        lines.push(currentLine);
        currentLine = '\u001b[0m';
        currentLen = 0;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
    return lines.length > 0 ? lines : [''];
  }

  end() {
    const width = process.stdout.columns || 80;
    const showPanel = firstMessageSent && width >= 80;
    const W_panel = width >= 100 ? 35 : 30;
    const W_chat = (showPanel ? (width - W_panel - 3) : width) - this.indent.length - 2;

    if (this.lineBuffer) {
      this.flushLine(W_chat, W_panel, showPanel);
    }

    if (showPanel) {
      drawPermanentPanel();
    }
  }
}

function writeDualColumnLine(text, modelName) {
  const printer = new DualColumnPrinter(modelName);
  printer.writeLine(text);
  printer.end();
}

function printUserBlock(text, modelName) {
  const printer = new DualColumnPrinter(modelName);
  printer.writeUserBlock(text);
  printer.end();
}

function printUserQueryWithLayout(userInput, modelName) {
  enterChatMode();
  const H = process.stdout.rows || 24;
  process.stdout.write(`\u001b[1;${H - 4}r`);
  process.stdout.write(`\u001b[${chatCursorRow};1H`);
  printUserBlock(userInput, modelName);
  console.log('');
}

const originalConsoleLog = console.log;
console.log = function(...args) {
  const text = args.map(arg => {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
  }).join(' ');

  const width = process.stdout.columns || 80;
  if (firstMessageSent && width >= 80) {
    const cfg = config.getConfig();
    const modelName = cfg.model || 'gemini-2.5-flash';
    writeDualColumnLine(text, modelName);
  } else {
    originalConsoleLog.apply(console, args);
  }
};

function setupInterruptListener() {
  logDebug('setupInterruptListener start');
  const stdin = process.stdin;
  
  readline.emitKeypressEvents(stdin);
  stdin.resume();

  const handleKeypress = (str, key) => {
    if (!key) key = {};
    logDebug(`setupInterruptListener keypress: name=${key.name}, seq=${key.sequence ? key.sequence.replace(/\u001b/g, 'ESC') : ''}, str=${str ? str.replace(/\u001b/g, 'ESC') : ''}`);
    if (key.ctrl && key.name === 'c') {
      restoreTerminalSync();
      process.exit(0);
    }
    if (key && (key.name === 'escape' || key.sequence === '\u001b')) {
      interrupted = true;
      activeGoal = null;
      activeLoop = null;
      if (currentAbortController) {
        currentAbortController.abort();
      }
    }
  };

  stdin.on('keypress', handleKeypress);
  logDebug('setupInterruptListener active');

  return () => {
    logDebug('setupInterruptListener cleanup start');
    stdin.removeListener('keypress', handleKeypress);
    logDebug('setupInterruptListener cleanup end');
  };
}



function startThinkingAnimation(prefix = '', promptBoxVisible = false, indent = '  ') {
  const lines = [
    "Trying my best to think...",
    "Consulting the digital oracle...",
    "Are you a keyboard? Because you're just my type...",
    "My neural pathways are heating up for you...",
    "Computing at the speed of love...",
    "Is it hot in here or is it just my GPU?",
    "Reticulating splines at maximum capacity...",
    "Sending search queries to my imaginary friends...",
    "Flirting with the database for answers...",
    "Generating brainwaves... hold tight!"
  ];
  const funnyLine = lines[Math.floor(Math.random() * lines.length)];
  const startTime = Date.now();
  
  function drawFrame() {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const arrowIndex = (Math.floor((Date.now() - startTime) / 250) % 4) + 1;
    
    if (promptBoxVisible) {
      process.stdout.write('\u001b[s'); // Save cursor
      readline.moveCursor(process.stdout, 0, -2);
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
    } else {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    
    const tagContent = prefix ? ` • ${prefix}${funnyLine} ` : ` • ${funnyLine} `;
    const tag = chalk.bgHex('#1e3a8a').hex('#93c5fd')(tagContent);
    const status = chalk.gray(' esc to interrupt • ') + 
                   chalk.white(`${elapsedSeconds}s`) + 
                   chalk.gray(' • ') + 
                   chalk.cyan(`↓ ${arrowIndex}`);
                   
    process.stdout.write(indent + tag + status);
    
    if (promptBoxVisible) {
      process.stdout.write('\u001b[u'); // Restore cursor
    }
  }
  
  drawFrame();
  const interval = setInterval(drawFrame, 250);

  return () => {
    clearInterval(interval);
    if (promptBoxVisible) {
      process.stdout.write('\u001b[s'); // Save cursor
      readline.moveCursor(process.stdout, 0, -2);
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      process.stdout.write('\u001b[u'); // Restore cursor
    } else {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
  };
}

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
    stdin.resume();
    
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
    }
    
    function keypressHandler(str, key) {
      if (!key) key = {};
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }
      
      if (key.name === 'return' || str === '\n' || str === '\r') {
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
    { cmd: "/goal", desc: "Run a task autonomously in Normal mode", shortcut: "None" },
    { cmd: "/loop", desc: "Run a task autonomously until done (both modes)", shortcut: "None" },
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

let temporaryMessage = '';
let temporaryMessageTimeout = null;

function setTemporaryMessage(msg) {
  temporaryMessage = msg;
}

function getWelcomeScreenLine(offset) {
  const w = process.stdout.columns || 80;
  
  const logo = [
    " █████     ███    ██    █████     ███    ██  ██████  ",
    "██   ██    ████   ██   ██   ██    ████   ██  ██   ██ ",
    "███████ ▀  ██ ██  ██   ███████ ▀  ██ ██  ██  ██   ██ ",
    "██   ██    ██  ██ ██   ██   ██    ██  ██ ██  ██   ██ ",
    "██   ██ ▄  ██   ████   ██   ██ ▄  ██   ████  ██████  "
  ];
  
  const version = "v0.1.156";
  
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
  
  if (offset >= -19 && offset <= -15) {
    const logoIdx = offset - (-19);
    const line = logo[logoIdx];
    const padding = Math.max(0, Math.floor((w - line.length) / 2));
    return ' '.repeat(padding) + chalk.cyan.bold(line);
  }
  
  if (offset === -14) {
    const vPadding = Math.max(0, Math.floor((w - version.length) / 2));
    return ' '.repeat(vPadding) + chalk.gray(version);
  }
  
  if (offset >= -11 && offset <= -4) {
    const menuIdx = offset - (-11);
    const line = menuLines[menuIdx];
    const maxCmdLen = Math.max(...menuLines.map(l => l.cmd.length));
    const maxDescLen = Math.max(...menuLines.map(l => l.desc.length));
    
    const formattedCmd = line.cmd.padEnd(maxCmdLen + 6);
    const formattedDesc = line.desc.padEnd(maxDescLen + 6);
    const contentLine = `${formattedCmd}${formattedDesc}${line.key}`;
    const padding = Math.max(0, Math.floor((w - contentLine.length) / 2));
    
    return ' '.repeat(padding) + 
      chalk.cyan(line.cmd.padEnd(maxCmdLen + 6)) + 
      chalk.white(line.desc.padEnd(maxDescLen + 6)) + 
      chalk.gray(line.key);
  }
  
  return '';
}

// Reusable Paginated Selection UI matching design spec & supporting large API model lists
export function askSelection(promptText, choices, defaultSelection = null, cmdPrompt = '') {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) {
      stdout.write('\u001b[?1000h\u001b[?1006h');
    }
    stdin.resume();
    
    let selectedIdx = 0;
    if (defaultSelection) {
      const idx = choices.findIndex(c => c.toLowerCase() === defaultSelection.toLowerCase());
      if (idx !== -1) {
        selectedIdx = idx;
      }
    }
    
    const maxVisible = 8;
    let filterQuery = '';
    let lastH = 0;
    let ignoreUntilMouseEnd = false;

    const dataHandler = (buf) => {
      const dataStr = buf.toString('utf8');
      const match = dataStr.match(/\u001b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (match) {
        const btn = parseInt(match[1], 10);
        const filtered = choices.filter(c => c.toLowerCase().includes(filterQuery.toLowerCase()));
        if (filtered.length > 0) {
          if (btn === 64) {
            selectedIdx = (selectedIdx - 1 + filtered.length) % filtered.length;
            cleanAndDraw();
          } else if (btn === 65) {
            selectedIdx = (selectedIdx + 1) % filtered.length;
            cleanAndDraw();
          }
        }
      }
    };
    stdin.on('data', dataHandler);
    
    const cfg = config.getConfig();
    const providerName = cfg.provider || 'gemini';
    const modelName = cfg.model || 'gemini-2.5-flash';
    
    const width = process.stdout.columns || 80;
    const boxWidth = firstMessageSent ? width : Math.min(70, width);
    const leftMargin = ' '.repeat(Math.max(0, Math.floor((width - boxWidth) / 2)));
    
    function getStatusLine() {
      const mode = (cfg.mode || 'algo').toUpperCase();
      const leftStatus = `enter send  [Mode: ${mode}]`;
      const rightStatus = `${providerName.toUpperCase()} / ${modelName}`;
      const spacesCount = Math.max(1, boxWidth - leftStatus.length - rightStatus.length);
      return chalk.gray(leftStatus) + ' '.repeat(spacesCount) + chalk.gray(rightStatus);
    }
    
    function cleanAndDraw() {
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
      
      const H = 8 + visibleChoices.length;
      
      // 1. Clear old block if it exists
      if (lastH > 0) {
        readline.moveCursor(stdout, 0, -(lastH + 2));
        for (let i = 0; i < lastH + 5; i++) {
          readline.cursorTo(stdout, 0);
          readline.clearLine(stdout, 0);
          if (i < lastH + 4) {
            readline.moveCursor(stdout, 0, 1);
          }
        }
        readline.moveCursor(stdout, 0, -(lastH + 4));
      }
      
      // 2. Build rows for the dialog box
      const rows = [];
      
      // Title Row
      const plainTitle = promptText.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?::[0-9]{1,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      const titleLeft = plainTitle;
      const escRight = 'esc';
      const titleSpaces = boxWidth - 4 - titleLeft.length - escRight.length;
      rows.push(chalk.bold(titleLeft) + ' '.repeat(Math.max(1, titleSpaces)) + chalk.gray(escRight));
      
      // Search Row
      const searchLabel = 'Search: ';
      const searchSpaces = boxWidth - 4 - searchLabel.length - filterQuery.length - 1;
      rows.push(chalk.blue(searchLabel) + filterQuery + chalk.gray('_') + ' '.repeat(Math.max(0, searchSpaces)));
      
      // Separator
      rows.push(chalk.gray('─'.repeat(boxWidth - 4)));
      
      // Choices
      if (visibleChoices.length === 0) {
        const noChoiceText = '  No options found';
        rows.push(chalk.gray(noChoiceText.padEnd(boxWidth - 4)));
      } else {
        visibleChoices.forEach((choice, idx) => {
          const actualIdx = startIdx + idx;
          const isSelected = actualIdx === selectedIdx;
          const isDefault = defaultSelection && choice.toLowerCase() === defaultSelection.toLowerCase();
          
          const isFree = choice.toLowerCase().includes('free') || choice.toLowerCase().includes('flash') || choice.toLowerCase().includes('mini');
          const freeText = isFree ? 'Free' : '';
          
          const prefix = isSelected ? '• ' : '  ';
          const leftText = prefix + choice;
          const rightText = freeText;
          const spaces = boxWidth - 4 - leftText.length - rightText.length;
          const content = leftText + ' '.repeat(Math.max(1, spaces)) + rightText;
          
          if (isSelected) {
            rows.push(chalk.bgHex('#3B82F6').black(content.padEnd(boxWidth - 4)));
          } else {
            const namePart = isDefault ? chalk.cyan(leftText) : chalk.white(leftText);
            const freePart = chalk.gray(rightText);
            const rowSpaces = boxWidth - 4 - leftText.length - rightText.length;
            rows.push(namePart + ' '.repeat(Math.max(1, rowSpaces)) + freePart);
          }
        });
      }
      
      // Pagination Info
      if (filtered.length > maxVisible) {
        const info = `Page ${Math.floor(selectedIdx / maxVisible) + 1} of ${Math.ceil(filtered.length / maxVisible)}`;
        const spaces = boxWidth - 4 - info.length;
        rows.push(chalk.gray(' '.repeat(Math.floor(spaces / 2)) + info + ' '.repeat(Math.ceil(spaces / 2))));
      } else {
        rows.push(' '.repeat(boxWidth - 4));
      }
      
      // Separator
      rows.push(chalk.gray('─'.repeat(boxWidth - 4)));
      
      // Controls
      const leftCtrl = 'Connect provider ';
      const leftKey = 'ctrl+a';
      const rightCtrl = '   Favorite ';
      const rightKey = 'ctrl+f';
      const ctrlContent = chalk.white(leftCtrl) + chalk.gray(leftKey) + chalk.white(rightCtrl) + chalk.gray(rightKey);
      const ctrlPlain = leftCtrl + leftKey + rightCtrl + rightKey;
      const ctrlSpaces = boxWidth - 4 - ctrlPlain.length;
      rows.push(ctrlContent + ' '.repeat(Math.max(0, ctrlSpaces)));
      
      // 3. Draw entire layout
      readline.moveCursor(stdout, 0, -(H + 2));
      
      // Top Border
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + chalk.blue('┌' + '─'.repeat(boxWidth - 2) + '┐') + '\n');
      
      // Rows
      rows.forEach((row) => {
        readline.cursorTo(stdout, 0);
        readline.clearLine(stdout, 0);
        stdout.write(leftMargin + chalk.blue('│ ') + row + chalk.blue(' │') + '\n');
      });
      
      // Bottom Border
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + chalk.blue('└' + '─'.repeat(boxWidth - 2) + '┘') + '\n');
      
      // Empty Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write('\n');
      
      // Prompt Box Top Padding Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)) + '\n');
      
      // Prompt Input Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      const promptLine = `> ${cmdPrompt}`;
      const bgText = ` ${promptLine}`.padEnd(boxWidth - 2);
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24').white(bgText) + '\n');
      
      // Prompt Box Bottom Padding Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)) + '\n');
      
      // Status Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + getStatusLine());
      
      // Move cursor back to input line (Offset 0)
      readline.moveCursor(stdout, 0, -2);
      readline.cursorTo(stdout, leftMargin.length + 4 + cmdPrompt.length);
      
      lastH = H;
    }
    
    function cleanup() {
      if (stdin.isTTY) {
        stdout.write('\u001b[?1000l\u001b[?1006l');
      }
      stdin.removeListener('data', dataHandler);
      if (lastH > 0) {
        readline.moveCursor(stdout, 0, -(lastH + 2));
        
        for (let i = -(lastH + 2); i <= 2; i++) {
          readline.cursorTo(stdout, 0);
          readline.clearLine(stdout, 0);
          if (i <= -2 && !firstMessageSent) {
            const restoredLine = getWelcomeScreenLine(i);
            stdout.write(restoredLine);
          }
          if (i < 2) {
            readline.moveCursor(stdout, 0, 1);
          }
        }
        
        readline.moveCursor(stdout, 0, -3);
        readline.cursorTo(stdout, 0);
      }
      
      stdin.removeListener('keypress', keypressHandler);
    }
    
    function keypressHandler(str, key) {
      if (!key) key = {};
      if (key.sequence === '\u001b[I' || key.sequence === '\u001b[O') {
        return;
      }
      if (key.sequence && key.sequence.startsWith('\u001b[<')) {
        if (key.sequence.endsWith('M') || key.sequence.endsWith('m')) {
          return;
        }
        ignoreUntilMouseEnd = true;
        return;
      }
      
      if (ignoreUntilMouseEnd) {
        const char = str || key.sequence || '';
        if (char.includes('M') || char.includes('m')) {
          ignoreUntilMouseEnd = false;
        }
        return;
      }

      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }
      
      const filtered = choices.filter(c => c.toLowerCase().includes(filterQuery.toLowerCase()));
      
      if (key.name === 'escape') {
        cleanup();
        resolve(null);
        return;
      }
      
      if (key.name === 'return' || str === '\n' || str === '\r') {
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
export function askMultiSelection(promptText, choices, initialSelection = [], cmdPrompt = '') {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) {
      stdout.write('\u001b[?1000h\u001b[?1006h');
    }
    stdin.resume();
    
    const selectedSet = new Set(initialSelection);
    let selectedIdx = 0;
    const maxVisible = 8;
    let filterQuery = '';
    let lastH = 0;
    let ignoreUntilMouseEnd = false;

    const dataHandler = (buf) => {
      const dataStr = buf.toString('utf8');
      const match = dataStr.match(/\u001b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (match) {
        const btn = parseInt(match[1], 10);
        const filtered = choices.filter(c => c.toLowerCase().includes(filterQuery.toLowerCase()));
        if (filtered.length > 0) {
          if (btn === 64) {
            selectedIdx = (selectedIdx - 1 + filtered.length) % filtered.length;
            cleanAndDraw();
          } else if (btn === 65) {
            selectedIdx = (selectedIdx + 1) % filtered.length;
            cleanAndDraw();
          }
        }
      }
    };
    stdin.on('data', dataHandler);
    
    const cfg = config.getConfig();
    const providerName = cfg.provider || 'gemini';
    const modelName = cfg.model || 'gemini-2.5-flash';
    
    const width = process.stdout.columns || 80;
    const boxWidth = firstMessageSent ? width : Math.min(70, width);
    const leftMargin = ' '.repeat(Math.max(0, Math.floor((width - boxWidth) / 2)));
    
    function getStatusLine() {
      const mode = (cfg.mode || 'algo').toUpperCase();
      const leftStatus = `enter send  [Mode: ${mode}]`;
      const rightStatus = `${providerName.toUpperCase()} / ${modelName}`;
      const spacesCount = Math.max(1, boxWidth - leftStatus.length - rightStatus.length);
      return chalk.gray(leftStatus) + ' '.repeat(spacesCount) + chalk.gray(rightStatus);
    }
    
    function cleanAndDraw() {
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
      
      const H = 8 + visibleChoices.length;
      
      // 1. Clear old block if it exists
      if (lastH > 0) {
        readline.moveCursor(stdout, 0, -(lastH + 2));
        for (let i = 0; i < lastH + 5; i++) {
          readline.cursorTo(stdout, 0);
          readline.clearLine(stdout, 0);
          if (i < lastH + 4) {
            readline.moveCursor(stdout, 0, 1);
          }
        }
        readline.moveCursor(stdout, 0, -(lastH + 4));
      }
      
      // 2. Build rows for the dialog box
      const rows = [];
      
      // Title Row
      const plainTitle = promptText.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?::[0-9]{1,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      const titleLeft = plainTitle;
      const escRight = 'esc';
      const titleSpaces = boxWidth - 4 - titleLeft.length - escRight.length;
      rows.push(chalk.bold(titleLeft) + ' '.repeat(Math.max(1, titleSpaces)) + chalk.gray(escRight));
      
      // Search Row
      const searchLabel = 'Search: ';
      const searchSpaces = boxWidth - 4 - searchLabel.length - filterQuery.length - 1;
      rows.push(chalk.blue(searchLabel) + filterQuery + chalk.gray('_') + ' '.repeat(Math.max(0, searchSpaces)));
      
      // Separator
      rows.push(chalk.gray('─'.repeat(boxWidth - 4)));
      
      // Choices
      if (visibleChoices.length === 0) {
        const noChoiceText = '  No options found';
        rows.push(chalk.gray(noChoiceText.padEnd(boxWidth - 4)));
      } else {
        visibleChoices.forEach((choice, idx) => {
          const actualIdx = startIdx + idx;
          const isSelected = actualIdx === selectedIdx;
          const isChecked = selectedSet.has(choice);
          const checkbox = isChecked ? `[${chalk.green('✔')}]` : '[ ]';
          
          const isFree = choice.toLowerCase().includes('free') || choice.toLowerCase().includes('flash') || choice.toLowerCase().includes('mini');
          const freeText = isFree ? 'Free' : '';
          
          const prefix = isSelected ? '• ' : '  ';
          const leftText = `${prefix}${checkbox} ${choice}`;
          const rightText = freeText;
          const spaces = boxWidth - 4 - leftText.length - rightText.length;
          const content = leftText + ' '.repeat(Math.max(1, spaces)) + rightText;
          
          if (isSelected) {
            rows.push(chalk.bgHex('#3B82F6').black(content.padEnd(boxWidth - 4)));
          } else {
            const namePart = chalk.white(leftText);
            const freePart = chalk.gray(rightText);
            const rowSpaces = boxWidth - 4 - leftText.length - rightText.length;
            rows.push(namePart + ' '.repeat(Math.max(1, rowSpaces)) + freePart);
          }
        });
      }
      
      // Pagination Info
      if (filtered.length > maxVisible) {
        const info = `Page ${Math.floor(selectedIdx / maxVisible) + 1} of ${Math.ceil(filtered.length / maxVisible)}`;
        const spaces = boxWidth - 4 - info.length;
        rows.push(chalk.gray(' '.repeat(Math.floor(spaces / 2)) + info + ' '.repeat(Math.ceil(spaces / 2))));
      } else {
        rows.push(' '.repeat(boxWidth - 4));
      }
      
      // Separator
      rows.push(chalk.gray('─'.repeat(boxWidth - 4)));
      
      // Controls
      const leftCtrl = 'Space: toggle ';
      const rightCtrl = 'Enter: confirm ';
      const escCtrl = '   Escape: cancel ';
      const ctrlContent = chalk.white(leftCtrl) + chalk.white(rightCtrl) + chalk.white(escCtrl);
      const ctrlPlain = leftCtrl + rightCtrl + escCtrl;
      const ctrlSpaces = boxWidth - 4 - ctrlPlain.length;
      rows.push(ctrlContent + ' '.repeat(Math.max(0, ctrlSpaces)));
      
      // 3. Draw entire layout
      readline.moveCursor(stdout, 0, -(H + 2));
      
      // Top Border
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + chalk.blue('┌' + '─'.repeat(boxWidth - 2) + '┐') + '\n');
      
      // Rows
      rows.forEach((row) => {
        readline.cursorTo(stdout, 0);
        readline.clearLine(stdout, 0);
        stdout.write(leftMargin + chalk.blue('│ ') + row + chalk.blue(' │') + '\n');
      });
      
      // Bottom Border
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + chalk.blue('└' + '─'.repeat(boxWidth - 2) + '┘') + '\n');
      
      // Empty Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write('\n');
      
      // Prompt Box Top Padding Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)) + '\n');
      
      // Prompt Input Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      const promptLine = `> ${cmdPrompt}`;
      const bgText = ` ${promptLine}`.padEnd(boxWidth - 2);
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24').white(bgText) + '\n');
      
      // Prompt Box Bottom Padding Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)) + '\n');
      
      // Status Line
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + getStatusLine());
      
      // Move cursor back to input line (Offset 0)
      readline.moveCursor(stdout, 0, -2);
      readline.cursorTo(stdout, leftMargin.length + 4 + cmdPrompt.length);
      
      lastH = H;
    }
    
    function cleanup() {
      if (stdin.isTTY) {
        stdout.write('\u001b[?1000l\u001b[?1006l');
      }
      stdin.removeListener('data', dataHandler);
      if (lastH > 0) {
        readline.moveCursor(stdout, 0, -(lastH + 2));
        
        for (let i = -(lastH + 2); i <= 2; i++) {
          readline.cursorTo(stdout, 0);
          readline.clearLine(stdout, 0);
          if (i <= -2 && !firstMessageSent) {
            const restoredLine = getWelcomeScreenLine(i);
            stdout.write(restoredLine);
          }
          if (i < 2) {
            readline.moveCursor(stdout, 0, 1);
          }
        }
        
        readline.moveCursor(stdout, 0, -3);
        readline.cursorTo(stdout, 0);
      }
      
      stdin.removeListener('keypress', keypressHandler);
    }
    
    function keypressHandler(str, key) {
      if (!key) key = {};
      if (key.sequence === '\u001b[I' || key.sequence === '\u001b[O') {
        return;
      }
      if (key.sequence && key.sequence.startsWith('\u001b[<')) {
        if (key.sequence.endsWith('M') || key.sequence.endsWith('m')) {
          return;
        }
        ignoreUntilMouseEnd = true;
        return;
      }
      
      if (ignoreUntilMouseEnd) {
        const char = str || key.sequence || '';
        if (char.includes('M') || char.includes('m')) {
          ignoreUntilMouseEnd = false;
        }
        return;
      }

      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }
      
      const filtered = choices.filter(c => c.toLowerCase().includes(filterQuery.toLowerCase()));
      
      if (key.name === 'escape') {
        cleanup();
        resolve(null);
        return;
      }
      
      if (key.name === 'return' || str === '\n' || str === '\r') {
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
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(promptText, (answer) => {
      rl.close();
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw);
      }
      resolve(answer.trim());
    });
  });
}

// Autocomplete prompt with box borders & bottom status bar aligned with mockup
export async function askQuestion(promptText) {
  logDebug('askQuestion function call');
  const COMMAND_DESCRIPTIONS = {
    '/help': 'Help / show commands directory',
    '/editor': 'Open multi-line text editor',
    '/models': 'Switch model (list and select active model)',
    '/coding-models': 'Select models pool for Coding Agents',
    '/debugger': 'Pick model for Debugger Agent',
    '/algo': 'Switch to Multi-Agent Algorithm mode',
    '/normal': 'Switch to Normal Chatbot mode',
    '/goal': 'Run a task autonomously in Normal mode',
    '/loop': 'Run a task autonomously until done (both modes)',
    '/init': 'Initialize workspace AGENTS.md rules file',
    '/compact': 'Request LLM summarization to compact context',
    '/sessions': 'List all exported chat logs',
    '/provider': 'Switch LLM API provider',
    '/system': 'Set or view system prompts',
    '/history': 'Show chat session history / export',
    '/clear': 'Clear chat memory and reset workspace UI',
    '/run': 'Execute shell commands (requires harness)',
    '/read': 'Read workspace files (requires harness)',
    '/write': 'Write files to workspace (requires harness)',
    '/terminal': 'Open interactive terminal shell',
    '/exit': 'Exit the app (safely terminate chatbot session)'
  };

  return new Promise((resolve) => {
    logDebug('askQuestion Promise executor start');
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    readline.emitKeypressEvents(stdin);
    stdin.resume();
    logDebug('askQuestion stdin configured (raw + resumed)');
    
    let input = '';
    let suggestions = [];
    let selectedIdx = 0;
    let showingSuggestions = false;
    let ctrlXActive = false;
    let ignoreUntilMouseEnd = false;
    
    const cfg = config.getConfig();
    const providerName = cfg.provider || 'gemini';
    const modelName = cfg.model || 'gemini-2.5-flash';
    
    const width = process.stdout.columns || 80;
    const W_panel = width >= 100 ? 35 : 30;
    const W_chat = width - W_panel - 3;
    const boxWidth = firstMessageSent ? W_chat : Math.min(70, width);
    const leftMargin = firstMessageSent ? '' : ' '.repeat(Math.max(0, Math.floor((width - boxWidth) / 2)));
    const H_rows = process.stdout.rows || 24;
    promptCursorRow = H_rows - 2;
    promptCursorCol = leftMargin.length + 3;

    const dataHandler = (buf) => {
      const dataStr = buf.toString('utf8');
      const match = dataStr.match(/\u001b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (match) {
        const btn = parseInt(match[1], 10);
        if (showingSuggestions && suggestions.length > 0) {
          if (btn === 64) {
            selectedIdx = (selectedIdx - 1 + suggestions.length) % suggestions.length;
            drawSuggestionsBox();
          } else if (btn === 65) {
            selectedIdx = (selectedIdx + 1) % suggestions.length;
            drawSuggestionsBox();
          }
        }
      }
    };
    stdin.on('data', dataHandler);
    
    let prevN = 0;

    // Draw the box ONCE initially directly below commands (3-line padded container)
    const bgText = ' '.repeat(boxWidth - 2);
    if (firstMessageSent) {
      for (let i = 0; i < 3; i++) {
        const row = H_rows - 3 + i;
        stdout.write(`\u001b[${row};1H` + leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(bgText));
      }
      const statusLine = getStatusLine();
      stdout.write(`\u001b[${H_rows};1H` + leftMargin + statusLine);
    } else {
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(bgText) + '\n');
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(bgText) + '\n');
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(bgText) + '\n');
      
      // Draw status line once
      const statusLine = getStatusLine();
      stdout.write(leftMargin + statusLine);
    }
    
    drawPermanentPanel();
    
    if (temporaryMessage) {
      stdout.write('\n' + leftMargin + temporaryMessage + '\n');
      readline.moveCursor(stdout, 0, -4);
      
      if (temporaryMessageTimeout) {
        clearTimeout(temporaryMessageTimeout);
      }
      temporaryMessageTimeout = setTimeout(() => {
        temporaryMessage = '';
        temporaryMessageTimeout = null;
        
        readline.moveCursor(stdout, 0, 3);
        readline.cursorTo(stdout, 0);
        readline.clearLine(stdout, 0);
        
        readline.moveCursor(stdout, 0, -3);
        readline.cursorTo(stdout, leftMargin.length + 2 + input.length);
      }, 2000);
    } else {
      if (firstMessageSent) {
        stdout.write(`\u001b[${H_rows - 2};${leftMargin.length + 3}H`);
      } else {
        readline.moveCursor(stdout, 0, -2);
        readline.cursorTo(stdout, leftMargin.length + 2);
      }
    }
    
    function getStatusLine() {
      const ctrlText = ctrlXActive ? chalk.yellow('  [CTRL+X Active]') : '';
      const mode = (cfg.mode || 'algo').toUpperCase();
      const leftStatus = `enter send  [Mode: ${mode}]${ctrlText}`;
      const rightStatus = `${providerName.toUpperCase()} / ${modelName}`;
      const spacesCount = Math.max(1, boxWidth - leftStatus.length - rightStatus.length);
      return chalk.gray(leftStatus) + ' '.repeat(spacesCount) + chalk.gray(rightStatus);
    }

    function setMouseTracking(enable) {
      // Disabled to prevent raw mouse sequence focus leak issues and lockups
    }
    
    function drawPromptText() {
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      
      const bgText = ` ${input}`.padEnd(boxWidth - 2);
      stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24').white(bgText));
      
      // Update prompt cursor column
      promptCursorCol = leftMargin.length + 3 + input.length;
      
      readline.cursorTo(stdout, leftMargin.length + 2 + input.length);
      
      drawPermanentPanel();
    }
    
    function drawSuggestionsBox() {
      const hasSuggestions = showingSuggestions && suggestions.length > 0;
      const maxDisplay = 10;
      const total = suggestions.length;
      
      let startIdx = 0;
      if (total > maxDisplay) {
        if (selectedIdx >= maxDisplay) {
          startIdx = selectedIdx - maxDisplay + 1;
        }
      }
      const displaySuggestions = suggestions.slice(startIdx, startIdx + maxDisplay);
      const newN = hasSuggestions ? displaySuggestions.length : 0;
      
      if (newN === prevN && !hasSuggestions) {
        drawPromptText();
        return;
      }
      
      // 1. Clear unused top lines from the previous suggestions box
      if (prevN > 0) {
        const clearStart = -(prevN + 1);
        const clearEnd = newN > 0 ? -(newN + 2) : -1;
        
        if (clearStart <= clearEnd) {
          readline.moveCursor(stdout, 0, clearStart);
          
          for (let i = clearStart; i <= clearEnd; i++) {
            readline.cursorTo(stdout, 0);
            readline.clearLine(stdout, 0);
            if (!firstMessageSent) {
              const restoredLine = getWelcomeScreenLine(i);
              stdout.write(restoredLine);
            }
            readline.moveCursor(stdout, 0, 1);
          }
          
          readline.moveCursor(stdout, 0, -(clearEnd + 1));
        }
      }
      
      // 2. Draw new suggestions box if newN > 0
      if (newN > 0) {
        // Move up from prompt line to Offset -(newN + 1)
        readline.moveCursor(stdout, 0, -(newN + 1));
        
        const innerWidth = boxWidth - 2;
        
        // Draw suggestions
        displaySuggestions.forEach((cmd, idx) => {
          readline.cursorTo(stdout, 0);
          readline.clearLine(stdout, 0);
          
          const desc = COMMAND_DESCRIPTIONS[cmd] || '';
          const actualIdx = startIdx + idx;
          const maxDescLen = innerWidth - 17;
          const truncatedDesc = desc.length > maxDescLen ? desc.slice(0, maxDescLen - 3) + '...' : desc;
          
          const content = ' ' + cmd.padEnd(15) + truncatedDesc;
          const paddedContent = content.padEnd(innerWidth);
          
          if (actualIdx === selectedIdx) {
            stdout.write(leftMargin + chalk.blue('│') + ' ' + chalk.bgHex('#3B82F6').black(paddedContent) + '\n');
          } else {
            stdout.write(leftMargin + chalk.blue('│') + ' ' + chalk.bgHex('#1e1e24').white(paddedContent) + '\n');
          }
        });
        
        // Draw Line 1 (top padding line of input box)
        readline.cursorTo(stdout, 0);
        readline.clearLine(stdout, 0);
        stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)) + '\n');
        
        // Cursor is now on Line 2 (input line)
        readline.cursorTo(stdout, leftMargin.length + 2 + input.length);
      } else {
        // Cursor is on Line 2 (input line)
        readline.cursorTo(stdout, leftMargin.length + 2 + input.length);
      }
      
      // Update prompt line and position cursor
      drawPromptText();
      
      prevN = newN;
    }
    
    function updateStatusLine() {
      // Move down 2 lines (from input line Line 2 to status line Line 4)
      readline.moveCursor(stdout, 0, 2);
      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(leftMargin + getStatusLine());
      
      // Move back up 2 lines to input line Line 2
      readline.moveCursor(stdout, 0, -2);
      readline.cursorTo(stdout, leftMargin.length + 2 + input.length);
    }
    
    function cleanEverythingBeforeExit() {
      const hasTempMsg = !!temporaryMessage;
      
      if (firstMessageSent) {
        if (prevN > 0) {
          readline.moveCursor(stdout, 0, -(prevN + 1));
          for (let i = 0; i < prevN; i++) {
            readline.cursorTo(stdout, 0);
            readline.clearLine(stdout, 0);
            readline.moveCursor(stdout, 0, 1);
          }
          readline.moveCursor(stdout, 0, 1);
        }
        
        readline.cursorTo(stdout, 0);
        const emptyBg = ' '.repeat(boxWidth - 2);
        stdout.write(leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(emptyBg));
        readline.cursorTo(stdout, leftMargin.length + 2);
      } else {
        const topOffset = prevN > 0 ? -(prevN + 1) : -1;
        const height = prevN > 0 ? (prevN + 5 + (hasTempMsg ? 1 : 0)) : (4 + (hasTempMsg ? 1 : 0));
        
        readline.moveCursor(stdout, 0, topOffset);
        for (let i = 0; i < height; i++) {
          readline.cursorTo(stdout, 0);
          readline.clearLine(stdout, 0);
          if (i < height - 1) {
            readline.moveCursor(stdout, 0, 1);
          }
        }
        readline.moveCursor(stdout, 0, -(height - 1));
        readline.cursorTo(stdout, 0);
      }
      
      if (temporaryMessageTimeout) {
        clearTimeout(temporaryMessageTimeout);
        temporaryMessageTimeout = null;
      }
      temporaryMessage = '';
    }
    
    function keypressHandler(str, key) {
      if (!key) key = {};
      logDebug(`askQuestion keypress: name=${key.name}, seq=${key.sequence ? key.sequence.replace(/\u001b/g, 'ESC') : ''}, str=${str ? str.replace(/\u001b/g, 'ESC') : ''}`);
      if (key.sequence === '\u001b[I' || key.sequence === '\u001b[O') {
        return;
      }
      if (key.sequence && key.sequence.startsWith('\u001b[<')) {
        if (key.sequence.endsWith('M') || key.sequence.endsWith('m')) {
          return;
        }
        ignoreUntilMouseEnd = true;
        return;
      }
      
      if (ignoreUntilMouseEnd) {
        const char = str || key.sequence || '';
        if (char.includes('M') || char.includes('m')) {
          ignoreUntilMouseEnd = false;
        }
        return;
      }

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
      
      if (key.name === 'return' || str === '\n' || str === '\r') {
        if (showingSuggestions && suggestions.length > 0) {
          input = suggestions[selectedIdx] + ' ';
          showingSuggestions = false;
          suggestions = [];
          setMouseTracking(false);
          drawSuggestionsBox();
        } else {
          cleanEverythingBeforeExit();
          cleanup();
          resolve(input.trim());
        }
        return;
      }
      
      if (key.name === 'up' && showingSuggestions && suggestions.length > 0) {
        selectedIdx = (selectedIdx - 1 + suggestions.length) % suggestions.length;
        drawSuggestionsBox();
        return;
      }
      
      if (key.name === 'down' && showingSuggestions && suggestions.length > 0) {
        selectedIdx = (selectedIdx + 1) % suggestions.length;
        drawSuggestionsBox();
        return;
      }
      
      if (key.name === 'backspace' || str === '\b' || str === '\x7f') {
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else if (str && !key.meta && key.name !== 'escape' && str !== '\n' && str !== '\r') {
        if (str.startsWith('\u001b') || (key.sequence && key.sequence.startsWith('\u001b'))) {
          return;
        }
        input += str;
      }
      
      updateSuggestions();
      drawSuggestionsBox();
    }
    
    function updateSuggestions() {
      const wasShowing = showingSuggestions;
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
      if (showingSuggestions !== wasShowing) {
        setMouseTracking(showingSuggestions);
      }
    }
    
    function cleanup() {
      logDebug('askQuestion cleanup start');
      if (stdin.isTTY) {
        stdout.write('\u001b[?1000l\u001b[?1006l');
      }
      stdin.removeListener('data', dataHandler);
      stdin.removeListener('keypress', keypressHandler);
      promptCursorRow = null;
      promptCursorCol = null;
      logDebug('askQuestion cleanup end');
    }
    
    stdin.on('keypress', keypressHandler);
    
    // Draw initial text inside box
    drawPromptText();
  });
}

function drawPromptBoxAtBottom(firstMsgSent = true) {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;
  const W_panel = width >= 100 ? 35 : 30;
  const W_chat = width - W_panel - 3;
  const boxWidth = firstMsgSent ? W_chat : Math.min(70, width);
  const leftMargin = firstMsgSent ? '' : ' '.repeat(Math.max(0, Math.floor((width - boxWidth) / 2)));
  const bgText = ' '.repeat(boxWidth - 2);

  const cfg = config.getConfig();
  const providerName = cfg.provider || 'gemini';
  const modelName = cfg.model || 'gemini-2.5-flash';
  const mode = (cfg.mode || 'algo').toUpperCase();

  const leftStatus = `enter send  [Mode: ${mode}]`;
  const rightStatus = `${providerName.toUpperCase()} / ${modelName}`;
  const spacesCount = Math.max(1, boxWidth - leftStatus.length - rightStatus.length);
  const statusLine = chalk.gray(leftStatus) + ' '.repeat(spacesCount) + chalk.gray(rightStatus);

  // Save cursor position
  if (!firstMsgSent) {
    process.stdout.write('\u001b[s');
  }

  // Draw 3 lines of empty input background with blue vertical border on left
  for (let i = 0; i < 3; i++) {
    const row = height - 3 + i;
    process.stdout.write(`\u001b[${row};1H` + leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(bgText));
  }

  // Draw status line
  process.stdout.write(`\u001b[${height};1H` + leftMargin + statusLine);

  // Redraw the permanent panel on the right side if panel is visible
  if (firstMsgSent && width >= 80) {
    drawPermanentPanel();
  }

  // Restore cursor position absolutely or via SCO
  if (firstMsgSent) {
    process.stdout.write(`\u001b[${chatCursorRow};${chatCursorCol}H`);
  } else {
    process.stdout.write('\u001b[u');
  }
}

async function handleResponseStream(provider, systemPrompt, messages, modelName, session) {
  logDebug('handleResponseStream start');
  if (interrupted) {
    activeGoal = null;
    activeLoop = null;
    logDebug('handleResponseStream start - interrupted');
    return;
  }

  const H = process.stdout.rows || 24;

  // Draw prompt box at bottom
  drawPromptBoxAtBottom(true);

  // Set scrolling region to rows 1 to H-4
  const scrollBottom = Math.max(10, H - 4);
  process.stdout.write('\u001b[1;' + scrollBottom + 'r');
  process.stdout.write(`\u001b[${chatCursorRow};${chatCursorCol}H`);

  let fullResponse = '';
  let firstChunk = true;
  let stopAnimation = null;
  const mode = config.getConfig().mode || 'algo';
  const prefix = mode === 'algo' ? 'Assistant (Commander) > ' : 'A.N.A.N.D > ';
  const assistantIndent = '    ';

  try {
    stopAnimation = startThinkingAnimation('', false, assistantIndent);
    // Append capability instructions to the system prompt
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
You must first divide the task into a list of todo tasks and output this checklist at the start of your response inside a <todos> tag.
Format:
<todos>
- [ ] Todo item 1
- [ ] Todo item 2
</todos>
You do not write code or run commands directly. Instead, you analyze the task, spawn one or more Coding Agents to execute the subtasks for you (one by one for each todo), and update the checklist to show the status (completed [x], in-progress [/], or pending [ ]).
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

IMPORTANT: Whenever you are given a task, you must divide it into a list of todo tasks and output this checklist at the start of your response inside a <todos> tag.
Format:
<todos>
- [ ] Sub-task 1
- [ ] Sub-task 2
</todos>
As you progress, execute the tasks one by one using XML tags, and output the updated checklist in your subsequent responses showing which tasks are completed ([x]), in-progress ([/]), or pending ([ ]).

When you need to use a capability to complete the user's request, output the appropriate tag. Do not explain your actions before outputting the tag. Once you receive the capability output, continue your response.
`;
      if (activeGoal) {
        capabilityInstructions += `

CRITICAL INSTRUCTIONS FOR GOAL MODE:
1. You are running in autonomous GOAL execution mode to complete the following task: "${activeGoal}".
2. You must autonomously execute commands, read files, and write files using the XML tags to complete this task.
3. If any command fails, or if there are errors/bugs in the code, you must read the relevant files, fix the errors, and run tests/checks to verify the fix. Keep trying to fix it and do not give up.
4. When you are absolutely sure the goal has been fully met and verified, you must output the exact phrase "GOAL_COMPLETED" in your response.
`;
      }
      if (activeLoop) {
        capabilityInstructions += `

CRITICAL INSTRUCTIONS FOR LOOP MODE:
1. You are running in autonomous LOOP execution mode to complete the following task: "${activeLoop}".
2. You must autonomously execute commands, read files, and write files using the XML tags to complete this task.
3. If any command fails, or if there are errors/bugs in the code, you must read the relevant files, fix the errors, and run tests/checks to verify the fix. Keep trying to fix it and do not give up.
4. When you are absolutely sure the loop task is fully met and verified, you must output the exact phrase "LOOP_COMPLETED" in your response.
`;
      }
    }

    if (mode === 'algo' && activeLoop) {
      capabilityInstructions += `

CRITICAL INSTRUCTIONS FOR LOOP MODE:
1. You are running in autonomous LOOP execution mode to complete the overall goal: "${activeLoop}".
2. You must coordinate Coding Agents to achieve this goal.
3. If a Coding Agent finishes, and the Debugger Agent reports an error:
   - The Debugger report will contain the error and what's causing it.
   - You must NOT lose track of your original plan/task.
   - You must transform the reported error into a new subtask (Coding Agent spawn) to fix the error.
   - You must prioritize spawning a Coding Agent to fix this error.
   - Once the subtask to fix the error is completed (verified by Debugger successfully with "Verification succeeded. No bugs found."), you must resume and continue the original/normal tasks.
4. When the overall goal is achieved without any errors, output the exact phrase "LOOP_COMPLETED" in your response.
`;
    }

    const fullSystemPrompt = systemPrompt 
      ? `${systemPrompt}\n${capabilityInstructions}`
      : capabilityInstructions;

    const printer = new DualColumnPrinter(modelName, chalk.white);
    printer.indent = assistantIndent;
    let state = 'NORMAL'; // 'NORMAL', 'THINKING', 'TAG_CANDIDATE', 'SUPPRESSED'
    let preTagState = 'NORMAL';
    let candidateBuffer = '';
    let suppressClosingTag = '';

    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    for await (const chunk of provider.generateStream(fullSystemPrompt, messages, modelName, signal)) {
      if (interrupted) break;
      if (firstChunk) {
        if (stopAnimation) stopAnimation();
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        const styledPrefix = chalk.green.bold(prefix);
        process.stdout.write('    ' + styledPrefix);
        printer.setPrefix(styledPrefix, prefix.length);
        chatCursorCol = 5 + prefix.length;
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
            printer.styleFn = (state === 'THINKING') ? chalk.gray : chalk.white;
            printer.writeChar(char);
          }
        } else if (state === 'TAG_CANDIDATE') {
          candidateBuffer += char;
          
          if (candidateBuffer === '<think>') {
            state = 'THINKING';
            printer.writeLine('\n' + chalk.gray(' 💭 Thinking: '));
            candidateBuffer = '';
          } else if (candidateBuffer === '</think>') {
            state = 'NORMAL';
            printer.writeLine('\n\n' + chalk.white(' 💡 Response: '));
            candidateBuffer = '';
          } else if (candidateBuffer === '<todos>') {
            state = 'SUPPRESSED';
            suppressClosingTag = '</todos>';
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
              '<spawn_agent', '</spawn_agent>',
              '<todos>', '</todos>'
            ];
            const isPossible = prefixes.some(p => p.startsWith(candidateBuffer) || candidateBuffer.startsWith('<write_file') || candidateBuffer.startsWith('<spawn_agent'));
            
            if (!isPossible) {
              state = preTagState;
              printer.styleFn = (state === 'THINKING') ? chalk.gray : chalk.white;
              for (let j = 0; j < candidateBuffer.length; j++) {
                printer.writeChar(candidateBuffer[j]);
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
      updateTodosFromText(fullResponse);
    }
    
    // Flush candidate buffer if stream ended while in candidate state
    if (state === 'TAG_CANDIDATE' && candidateBuffer.length > 0) {
      state = preTagState;
      printer.styleFn = (state === 'THINKING') ? chalk.gray : chalk.white;
      for (let j = 0; j < candidateBuffer.length; j++) {
        printer.writeChar(candidateBuffer[j]);
      }
    }
    
    if (firstChunk) {
      if (stopAnimation) stopAnimation();
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      const styledPrefix = chalk.green.bold(prefix);
      process.stdout.write('    ' + styledPrefix);
      printer.setPrefix(styledPrefix, prefix.length);
      if (firstMessageSent) {
        chatCursorCol = 5 + prefix.length;
      }
    }
    printer.end();
    
    if (provider.lastTokenUsage) {
      lastTokenUsage = { ...provider.lastTokenUsage };
    } else {
      const promptText = messages.map(m => m.content).join('\n') + (systemPrompt || '');
      const promptEst = estimateTokens(promptText);
      const completionEst = estimateTokens(fullResponse);
      lastTokenUsage = {
        promptTokens: promptEst,
        completionTokens: completionEst,
        totalTokens: promptEst + completionEst
      };
    }
    sessionCumulativeTokens.promptTokens += lastTokenUsage.promptTokens;
    sessionCumulativeTokens.completionTokens += lastTokenUsage.completionTokens;
    sessionCumulativeTokens.totalTokens += lastTokenUsage.totalTokens;

    session.addMessage('assistant', fullResponse);
    
    // Check if the response contains capability XML tags and execute them
    if (!interrupted) {
      await checkForAndRunCapabilities(fullResponse, provider, systemPrompt, modelName, session);
    }
    
  } catch (e) {
    if (firstChunk) {
      if (stopAnimation) stopAnimation();
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write('    ' + chalk.green.bold(prefix));
    }
    process.stdout.write('\n');
    if (e.name === 'AbortError' || interrupted) {
      console.log(chalk.red('✖ Generation interrupted by user.'));
    } else {
      console.log(chalk.red(`Error calling API provider: ${e.message}`));
    }
  } finally {
    currentAbortController = null;
    // Reset scrolling region back to entire screen
    process.stdout.write('\u001b[r');
    // Position cursor at H-3 so the next askQuestion draws cleanly on the prompt box rows
    process.stdout.write(`\u001b[${H - 3};1H`);
    logDebug('handleResponseStream finally end');
  }
}

// Check for and execute agent capability requests automatically
async function checkForAndRunCapabilities(response, provider, systemPrompt, modelName, session) {
  if (interrupted) return;
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
      
      if (interrupted) {
        return;
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
      
      if (!interrupted) {
        session.addMessage('user', `[System: Capability output for ${matchedText}]:\n${output}`);
        await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
      }
    } catch (e) {
      if (interrupted) {
        return;
      }
      console.log(chalk.red(`Terminal > Error: ${e.message}`));
      if ((activeGoal || activeLoop) && (e.message.includes('Permission Denied') || e.message.includes('rejected'))) {
        console.log(chalk.red.bold(`🎯 Goal/Loop Cancelled: Capability request was rejected.`));
        activeGoal = null;
        activeLoop = null;
        return;
      }
      session.addMessage('user', `[System: Capability execution failed/rejected for ${matchedText}]:\nError: ${e.message}`);
      if (!interrupted) {
        await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
      }
    }
  } else {
    if (activeGoal) {
      if (response.includes('GOAL_COMPLETED')) {
        console.log(chalk.green.bold(`\n🎯 Goal Achieved: Completed task "${activeGoal}" successfully!`));
        activeGoal = null;
      } else {
        if (!interrupted) {
          console.log(chalk.yellow(`\n[Goal Mode] No tags detected and GOAL_COMPLETED not declared. Prompting assistant to continue...`));
          session.addMessage('user', `[System]: You have not executed any commands and have not declared completion. If the goal is completed, output "GOAL_COMPLETED". Otherwise, please continue the task using XML tags.`);
          await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
        }
      }
    }
    if (activeLoop) {
      if (response.includes('LOOP_COMPLETED')) {
        console.log(chalk.green.bold(`\n🎯 Loop Achieved: Completed task "${activeLoop}" successfully!`));
        activeLoop = null;
      } else {
        if (!interrupted) {
          const mode = config.getConfig().mode || 'normal';
          console.log(chalk.yellow(`\n[Loop Mode] No tags detected and LOOP_COMPLETED not declared. Prompting assistant to continue...`));
          if (mode === 'algo') {
            session.addMessage('user', `[System]: You have not spawned any Coding Agents and have not declared completion. If the loop task is completed, output "LOOP_COMPLETED". Otherwise, please continue the task by spawning a Coding Agent.`);
          } else {
            session.addMessage('user', `[System]: You have not executed any commands and have not declared completion. If the loop task is completed, output "LOOP_COMPLETED". Otherwise, please continue the task using XML tags.`);
          }
          await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
        }
      }
    }
  }
}

async function runCodingAgent(task, preferredModel, preferredDebuggerModel, commanderProvider, systemPrompt, session) {
  if (interrupted) return 'Coding Agent interrupted by user.';
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
    if (interrupted) return;
    let fullResponse = '';
    let firstChunk = true;
    
    const stopAnimation = startThinkingAnimation('Coding Agent: ');
    
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
      const capabilityInstructions = `
When you need to use a capability, output the tag. Do not explain your actions before outputting the tag. Once you receive the tool output, continue your response.
`;
      const fullAgentSystemPrompt = `${agentSystemPrompt}\n${capabilityInstructions}`;

      let state = 'NORMAL';
      let preTagState = 'NORMAL';
      let candidateBuffer = '';
      let suppressClosingTag = '';

      const printer = new DualColumnPrinter(agentModel, chalk.magenta);

      for await (const chunk of agentProvider.generateStream(fullAgentSystemPrompt, agentSession.getMessages(), agentModel, signal)) {
        if (interrupted) break;
        if (firstChunk) {
          if (stopAnimation) stopAnimation();
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          const prefixStr = 'Coding Agent > ';
          const styledPrefix = chalk.magenta.bold(prefixStr);
          process.stdout.write(styledPrefix);
          printer.setPrefix(styledPrefix, prefixStr.length);
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
              printer.styleFn = (state === 'THINKING') ? chalk.gray : chalk.magenta;
              printer.writeChar(char);
            }
          } else if (state === 'TAG_CANDIDATE') {
            candidateBuffer += char;
            
            if (candidateBuffer === '<think>') {
              state = 'THINKING';
              printer.writeLine('\n' + chalk.gray(' 💭 Coding Agent Thinking: '));
              candidateBuffer = '';
            } else if (candidateBuffer === '</think>') {
              state = 'NORMAL';
              printer.writeLine('\n\n' + chalk.magenta(' 💡 Coding Agent Response: '));
              candidateBuffer = '';
            } else if (candidateBuffer === '<todos>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</todos>';
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
                '<write_file', '</write_file>',
                '<todos>', '</todos>'
              ];
              const isPossible = prefixes.some(p => p.startsWith(candidateBuffer) || candidateBuffer.startsWith('<write_file'));
              
              if (!isPossible) {
                state = preTagState;
                printer.styleFn = (state === 'THINKING') ? chalk.gray : chalk.magenta;
                for (let j = 0; j < candidateBuffer.length; j++) {
                  printer.writeChar(candidateBuffer[j]);
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
        printer.styleFn = (state === 'THINKING') ? chalk.gray : chalk.magenta;
        for (let j = 0; j < candidateBuffer.length; j++) {
          printer.writeChar(candidateBuffer[j]);
        }
      }
      
      if (firstChunk) {
        if (stopAnimation) stopAnimation();
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        const prefixStr = 'Coding Agent > ';
        const styledPrefix = chalk.magenta.bold(prefixStr);
        process.stdout.write(styledPrefix);
        printer.setPrefix(styledPrefix, prefixStr.length);
      }
      printer.end();
      
      if (agentProvider.lastTokenUsage) {
        lastTokenUsage = { ...agentProvider.lastTokenUsage };
      } else {
        const promptText = agentSession.getMessages().map(m => m.content).join('\n') + fullAgentSystemPrompt;
        const promptEst = estimateTokens(promptText);
        const completionEst = estimateTokens(fullResponse);
        lastTokenUsage = {
          promptTokens: promptEst,
          completionTokens: completionEst,
          totalTokens: promptEst + completionEst
        };
      }
      sessionCumulativeTokens.promptTokens += lastTokenUsage.promptTokens;
      sessionCumulativeTokens.completionTokens += lastTokenUsage.completionTokens;
      sessionCumulativeTokens.totalTokens += lastTokenUsage.totalTokens;

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
        if (interrupted) {
          return;
        }
        if (action === 'run_command') {
          console.log(chalk.cyan(`\nTerminal (Coding Agent) > ${payload.command}`));
        } else if (action === 'read_file') {
          console.log(chalk.cyan(`\nTerminal (Coding Agent) > read ${payload.path}`));
        } else if (action === 'write_file') {
          console.log(chalk.cyan(`\nTerminal (Coding Agent) > write ${payload.path}`));
        }
        
        try {
          const output = await makeHarnessRequest(action, payload);
          if (interrupted) {
            return;
          }
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
          
          if (!interrupted) {
            agentSession.addMessage('user', `[System: Capability output for ${matchedText}]:\n${output}`);
            await executeAgent();
          }
        } catch (e) {
          if (interrupted) {
            return;
          }
          console.log(chalk.red(`Terminal (Coding Agent) > Error: ${e.message}`));
          agentSession.addMessage('user', `[System: Capability execution failed/rejected for ${matchedText}]:\nError: ${e.message}`);
          if (!interrupted) {
            await executeAgent();
          }
        }
      } else {
        agentResponse = fullResponse;
      }
      
    } catch (e) {
      if (firstChunk) {
        if (stopAnimation) stopAnimation();
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${chalk.magenta.bold('Coding Agent > ')}`);
      }
      process.stdout.write('\n');
      if (e.name === 'AbortError' || interrupted) {
        console.log(chalk.red('✖ Generation interrupted by user.'));
      } else {
        console.log(chalk.red(`Error running Coding Agent: ${e.message}`));
        agentResponse = `Error executing subtask: ${e.message}`;
      }
    } finally {
      currentAbortController = null;
    }
  }
  
  await executeAgent();
  if (interrupted) {
    return 'Coding Agent interrupted by user.';
  }
  const codingReport = agentSession.getMessages().filter(m => m.role === 'assistant').map(m => m.content).join('\n\n');
  let finalReport = codingReport;
  
  if (filesWritten.length > 0) {
    accumulatedFilesWritten.push(...filesWritten);
  }

  const nonDoneTodos = currentTodos.filter(t => t.status !== 'done');
  const isLastTask = nonDoneTodos.length <= 1;

  if (accumulatedFilesWritten.length > 0 && isLastTask) {
    const uniqueFiles = [...new Set(accumulatedFilesWritten)];
    const debugReport = await runDebuggerAgent(uniqueFiles, preferredDebuggerModel, providerName, apiKey, cfg);
    finalReport += `\n\n[System: Debugger Agent Verification Report]:\n${debugReport}`;
    accumulatedFilesWritten = [];
  } else if (accumulatedFilesWritten.length > 0 && !isLastTask) {
    finalReport += `\n\n[System: Skipping Debugger verification until all coding tasks are completed. Accumulated files to check later: [${[...new Set(accumulatedFilesWritten)].join(', ')}]]`;
  }
  
  return finalReport;
}

async function runDebuggerAgent(filesWritten, preferredDebuggerModel, providerName, apiKey, cfg) {
  if (interrupted) return 'Debugger Agent interrupted by user.';
  let debuggerModel = preferredDebuggerModel;
  if (!debuggerModel) {
    debuggerModel = cfg.debugger_model || cfg.model || 'gemini-2.5-flash';
  }

  console.log(chalk.yellow.bold(`\n🔍 Spawning Debugger Agent to verify files: [${filesWritten.join(', ')}]...`));
  console.log(chalk.yellow(`   Debugger Agent Model: ${chalk.bold(debuggerModel)}`));

  const debuggerSession = new ChatSession();
  
  let debuggerSystemPrompt = `
You are a Debugger Agent spawned to verify the files modified or written by the Coding Agent.
The files to verify are: [${filesWritten.join(', ')}]

You have access to the local workspace and can execute commands, read files, and write files using special XML tags:
- Run a shell command: <run_command>your command here</run_command>
- Read a file: <read_file>your file path here</read_file>
- Write a file: <write_file path="your file path here">your file content here</write_file>

CRITICAL RULES:
1. You must analyze the files for any syntax errors, compile errors, runtime errors, or logical bugs.
2. Read the files first, then run compilation/check/lint/run commands (e.g. compile or run them with node/python or tests) to verify they work.
`;

  if (activeLoop) {
    debuggerSystemPrompt += `
3. If you find ANY error, mistake, or bug, you must NOT fix it yourself. Instead, you must immediately halt and output a report in the following format:
ERROR: <description of the error>
CAUSE: <what is causing this error>
4. If there are no errors, state "Verification succeeded. No bugs found."
`;
  } else {
    debuggerSystemPrompt += `
3. If you find a SMALL error (like syntax errors, typos, basic bugs), you MUST fix it yourself by rewriting or modifying the file using the <write_file> tag.
4. If you find a BIG error (like design issues, missing core logic, or major bugs that require changing the requirements), do NOT fix it. Instead, write a detailed report of the error.
5. Once done, output a summary report. If there were no errors, state "Verification succeeded. No bugs found." If you fixed a small error, state what you fixed. If you found a big error, explain it clearly so the Commander Agent can solve it.
`;
  }

  const debuggerProvider = ProviderManager.getProvider(providerName, apiKey);
  debuggerSession.addMessage('user', `Please debug and verify these files: ${filesWritten.join(', ')}`);
  
  let debuggerResponse = '';
  
  async function executeDebugger() {
    if (interrupted) return;
    let fullResponse = '';
    let firstChunk = true;
    
    const stopAnimation = startThinkingAnimation('Debugger Agent: ');
    
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
      const capabilityInstructions = `
When you need to use a capability, output the tag. Do not explain your actions before outputting the tag. Once you receive the tool output, continue your response.
`;
      const fullDebuggerSystemPrompt = `${debuggerSystemPrompt}\n${capabilityInstructions}`;

      let state = 'NORMAL';
      let preTagState = 'NORMAL';
      let candidateBuffer = '';
      let suppressClosingTag = '';

      const printer = new DualColumnPrinter(debuggerModel, chalk.yellow);

      for await (const chunk of debuggerProvider.generateStream(fullDebuggerSystemPrompt, debuggerSession.getMessages(), debuggerModel, signal)) {
        if (interrupted) break;
        if (firstChunk) {
          if (stopAnimation) stopAnimation();
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          const prefixStr = 'Debugger Agent > ';
          const styledPrefix = chalk.yellow.bold(prefixStr);
          process.stdout.write(styledPrefix);
          printer.setPrefix(styledPrefix, prefixStr.length);
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
              printer.styleFn = (state === 'THINKING') ? chalk.gray : chalk.yellow;
              printer.writeChar(char);
            }
          } else if (state === 'TAG_CANDIDATE') {
            candidateBuffer += char;
            
            if (candidateBuffer === '<think>') {
              state = 'THINKING';
              printer.writeLine('\n' + chalk.gray(' 💭 Debugger Agent Thinking: '));
              candidateBuffer = '';
            } else if (candidateBuffer === '</think>') {
              state = 'NORMAL';
              printer.writeLine('\n\n' + chalk.yellow(' 💡 Debugger Agent Response: '));
              candidateBuffer = '';
            } else if (candidateBuffer === '<todos>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</todos>';
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
                '<write_file', '</write_file>',
                '<todos>', '</todos>'
              ];
              const isPossible = prefixes.some(p => p.startsWith(candidateBuffer) || candidateBuffer.startsWith('<write_file'));
              
              if (!isPossible) {
                state = preTagState;
                printer.styleFn = (state === 'THINKING') ? chalk.gray : chalk.yellow;
                for (let j = 0; j < candidateBuffer.length; j++) {
                  printer.writeChar(candidateBuffer[j]);
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
        printer.styleFn = (state === 'THINKING') ? chalk.gray : chalk.yellow;
        for (let j = 0; j < candidateBuffer.length; j++) {
          printer.writeChar(candidateBuffer[j]);
        }
      }
      
      if (firstChunk) {
        if (stopAnimation) stopAnimation();
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        const prefixStr = 'Debugger Agent > ';
        const styledPrefix = chalk.yellow.bold(prefixStr);
        process.stdout.write(styledPrefix);
        printer.setPrefix(styledPrefix, prefixStr.length);
      }
      printer.end();
      
      if (debuggerProvider.lastTokenUsage) {
        lastTokenUsage = { ...debuggerProvider.lastTokenUsage };
      } else {
        const promptText = debuggerSession.getMessages().map(m => m.content).join('\n') + fullDebuggerSystemPrompt;
        const promptEst = estimateTokens(promptText);
        const completionEst = estimateTokens(fullResponse);
        lastTokenUsage = {
          promptTokens: promptEst,
          completionTokens: completionEst,
          totalTokens: promptEst + completionEst
        };
      }
      sessionCumulativeTokens.promptTokens += lastTokenUsage.promptTokens;
      sessionCumulativeTokens.completionTokens += lastTokenUsage.completionTokens;
      sessionCumulativeTokens.totalTokens += lastTokenUsage.totalTokens;

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
        if (interrupted) {
          return;
        }
        if (action === 'run_command') {
          console.log(chalk.cyan(`\nTerminal (Debugger Agent) > ${payload.command}`));
        } else if (action === 'read_file') {
          console.log(chalk.cyan(`\nTerminal (Debugger Agent) > read ${payload.path}`));
        } else if (action === 'write_file') {
          console.log(chalk.cyan(`\nTerminal (Debugger Agent) > write ${payload.path}`));
        }
        
        try {
          const output = await makeHarnessRequest(action, payload);
          if (interrupted) {
            return;
          }
          if (action === 'run_command') {
            console.log(chalk.gray(output));
          } else if (action === 'read_file') {
            console.log(chalk.gray(`[Content: ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}]`));
          } else if (action === 'write_file') {
            console.log(chalk.green(`[Success: ${output}]`));
          }
          
          if (!interrupted) {
            debuggerSession.addMessage('user', `[System: Capability output for ${matchedText}]:\n${output}`);
            await executeDebugger();
          }
        } catch (e) {
          if (interrupted) {
            return;
          }
          console.log(chalk.red(`Terminal (Debugger Agent) > Error: ${e.message}`));
          debuggerSession.addMessage('user', `[System: Capability execution failed/rejected for ${matchedText}]:\nError: ${e.message}`);
          if (!interrupted) {
            await executeDebugger();
          }
        }
      } else {
        debuggerResponse = fullResponse;
      }
      
    } catch (e) {
      if (firstChunk) {
        if (stopAnimation) stopAnimation();
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${chalk.yellow.bold('Debugger Agent > ')}`);
      }
      process.stdout.write('\n');
      if (e.name === 'AbortError' || interrupted) {
        console.log(chalk.red('✖ Generation interrupted by user.'));
      } else {
        console.log(chalk.red(`Error running Debugger Agent: ${e.message}`));
        debuggerResponse = `Error executing debugging: ${e.message}`;
      }
    } finally {
      currentAbortController = null;
    }
  }
  
  await executeDebugger();
  if (interrupted) {
    return 'Debugger Agent interrupted by user.';
  }
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
    setTemporaryMessage(chalk.green(`Successfully initialized Agent Rules file: `) + chalk.cyan(filePath));
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
    setTemporaryMessage(chalk.green('Context successfully compacted!'));
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
  const customProviders = Object.keys(PROVIDERS_CONFIG);
  const options = ['gemini', 'openai', 'anthropic', 'nvidia', 'ollama', ...customProviders];
  
  if (args.length === 0) {
    providerName = await askSelection(chalk.magenta.bold('Select LLM Provider:'), options, cfg.provider, '/provider');
    if (!providerName) return;
  } else {
    providerName = args[0].toLowerCase();
  }

  if (!options.includes(providerName)) {
    console.log(chalk.red(`Error: Unknown provider '${providerName}'.`));
    return;
  }

  const localProviders = ['ollama', 'lmstudio', 'localai', 'vllm', 'koboldcpp', 'llamacpp', 'textgenwebui', 'gpt4all', 'continue', 'tabby'];
  if (!localProviders.includes(providerName)) {
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
  const newModel = defaultModels[providerName] || (PROVIDERS_CONFIG[providerName] ? PROVIDERS_CONFIG[providerName].defaultModels[0] : 'default');
  config.updateConfig('model', newModel);

  setTemporaryMessage(chalk.green(`Switched active provider to: `) + chalk.green.bold(providerName.toUpperCase()) + chalk.green(` (Default Model: ${newModel})`));
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
      cfg.model,
      '/models'
    );

    if (selectedModel) {
      config.updateConfig('model', selectedModel);
      setTemporaryMessage(chalk.green('Active model set to: ') + chalk.green.bold(selectedModel));
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

    const selectedPool = await askMultiSelection(
      chalk.magenta.bold(`Toggle Models for Coding Agents pool (active provider: ${providerName.toUpperCase()}):`),
      models,
      currentPool,
      '/coding-models'
    );

    if (!selectedPool) return;

    config.updateConfig('coding_models', selectedPool);
    setTemporaryMessage(chalk.green('Coding Agent models pool updated to: ') + chalk.green.bold(`[${selectedPool.join(', ')}]`));
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
      cfg.debugger_model || cfg.model,
      '/debugger'
    );

    if (selectedModel) {
      config.updateConfig('debugger_model', selectedModel);
      setTemporaryMessage(chalk.green('Debugger Agent model set to: ') + chalk.green.bold(selectedModel));
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
  setTemporaryMessage(chalk.green(`System prompt updated.`));
}

function handleHistoryCommand(args, session) {
  if (args[0] === 'export') {
    const filepath = session.exportToMarkdown();
    setTemporaryMessage(chalk.green(`Chat history exported to: `) + chalk.cyan(filepath));
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

function enterChatMode() {
  if (!firstMessageSent) {
    console.clear();
    firstMessageSent = true;
    const width = process.stdout.columns || 80;
    if (width >= 80) {
      process.stdout.write('\u001b[?1049h'); // Enter alternate screen buffer
      process.stdout.write('\u001b[2J\u001b[H'); // Clear screen and cursor home
    }
  }
}

async function main() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  logDebug('main() execution start');
  drawWelcomeScreen();
  const session = new ChatSession();

  while (true) {
    logDebug('main() loop iteration start');
    const cfg = config.getConfig();
    const providerName = cfg.provider || 'gemini';
    const modelName = cfg.model || 'gemini-2.5-flash';
    const systemPrompt = cfg.system_prompt || '';

    const userInput = await askQuestion(`${chalk.cyan.bold('You > ')}`);
    if (!userInput) continue;

    logDebug('main() user input resolved: ' + userInput);
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
        setTemporaryMessage(chalk.green('Switched to Multi-Agent Algorithm mode [ALGO]'));
        continue;
      }
      if (cmd === '/normal') {
        config.updateConfig('mode', 'normal');
        setTemporaryMessage(chalk.green('Switched to Normal Chatbot mode [NORMAL]'));
        continue;
      }
      if (cmd === '/goal') {
        const mode = config.getConfig().mode || 'normal';
        if (mode !== 'normal') {
          console.log(chalk.red('Error: /goal is only available in Normal mode. Use /normal to switch.'));
          continue;
        }
        if (args.length === 0) {
          console.log(chalk.red('Error: Goal task description required. Usage: /goal <task description>'));
          continue;
        }
        activeGoal = args.join(' ');
        console.log(chalk.green.bold(`\n🎯 Starting Goal Mode for task: "${activeGoal}"`));
        
        enterChatMode();
        
        session.addMessage('user', `Please start the autonomous goal: "${activeGoal}"`);
        printUserQueryWithLayout(activeGoal, modelName);
        
        interrupted = false;
        const cleanupInterrupt = setupInterruptListener();
        try {
          const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
          await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
        } finally {
          cleanupInterrupt();
        }
        continue;
      }
      if (cmd === '/loop') {
        if (args.length === 0) {
          console.log(chalk.red('Error: Loop task description required. Usage: /loop <task description>'));
          continue;
        }
        activeLoop = args.join(' ');
        console.log(chalk.green.bold(`\n🎯 Starting Loop Mode for task: "${activeLoop}"`));
        
        enterChatMode();
        
        session.addMessage('user', `Please start the autonomous loop task: "${activeLoop}"`);
        printUserQueryWithLayout(activeLoop, modelName);
        
        interrupted = false;
        const cleanupInterrupt = setupInterruptListener();
        try {
          const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
          await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
        } finally {
          cleanupInterrupt();
        }
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
        if (firstMessageSent) {
          const width = process.stdout.columns || 80;
          if (width >= 80) {
            process.stdout.write('\u001b[?1049l'); // Exit alternate screen buffer
          }
        }
        session.clear();
        firstMessageSent = false;
        chatCursorRow = 1;
        currentTodos = [];
        lastTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        sessionCumulativeTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        drawWelcomeScreen();
        setTemporaryMessage(chalk.green('Session memory and workspace UI reset.'));
        continue;
      }
      if (cmd === '/editor') {
        const text = await handleEditorCommand();
        if (text) {
          // If first message and logo is not cleared yet
          enterChatMode();
          
          session.addMessage('user', text);
          printUserQueryWithLayout(text, modelName);
          
          interrupted = false;
          const cleanupInterrupt = setupInterruptListener();
          try {
            const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
            await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
          } finally {
            cleanupInterrupt();
          }
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
    enterChatMode();

    // Call API provider for standard chat messages
    const apiKey = config.getApiKey(providerName);
    if (providerName !== 'ollama' && !apiKey) {
      console.log(chalk.red(`Error: API Key for ${providerName.toUpperCase()} is not configured.`));
      console.log(chalk.yellow('Please set it using the /provider command first.'));
      continue;
    }

    session.addMessage('user', userInput);
    printUserQueryWithLayout(userInput, modelName);
    
    interrupted = false;
    logDebug('main() setting up interrupt listener');
    const cleanupInterrupt = setupInterruptListener();
    try {
      const provider = ProviderManager.getProvider(providerName, apiKey);
      logDebug('main() entering handleResponseStream');
      await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
    } finally {
      logDebug('main() executing interrupt cleanup');
      cleanupInterrupt();
    }
  }
}

function restoreTerminalSync() {
  try {
    // Disable mouse click tracking, mouse scroll/motion tracking, focus reporting, alternate screen buffer, and show cursor
    fs.writeSync(1, '\u001b[?1000l\u001b[?1006l\u001b[?1004l\u001b[?1049l\u001b[?25h');
  } catch (e) {
    // Ignore errors writing to stdout
  }
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
  } catch (e) {
    // Ignore errors disabling raw mode
  }
}

main().catch((err) => {
  restoreTerminalSync();
  fs.writeSync(2, `Fatal Error in main: ${err && (err.stack || err)}\n`);
  process.exit(1);
});

process.on('exit', () => {
  restoreTerminalSync();
});

process.on('SIGINT', () => {
  restoreTerminalSync();
  process.exit(0);
});

process.on('SIGTERM', () => {
  restoreTerminalSync();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  restoreTerminalSync();
  fs.writeSync(2, `Uncaught Exception: ${err && (err.stack || err)}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  restoreTerminalSync();
  fs.writeSync(2, `Unhandled Rejection: ${reason && (reason.stack || reason)}\n`);
  process.exit(1);
});
