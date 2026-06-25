import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import * as config from './config.js';
import { ChatSession } from './history.js';
import { ProviderManager, PROVIDERS_CONFIG, modelContextLimits } from './providers.js';

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
  '/exit',
  '/search-web',
  '/browse-url',
  // 1. File & Project Commands
  '/new',
  '/open',
  '/save',
  '/rename',
  '/delete',
  '/close',
  // 2. Navigation Commands
  '/goto',
  '/search',
  '/explorer',
  // 3. Code Assistance Commands
  '/build',
  '/format',
  '/fix',
  '/debug',
  // 4. AI / Agent Commands
  '/ask',
  '/explain',
  '/generate',
  '/test',
  '/doc',
  // 5. Version Control Commands
  '/clone',
  '/commit',
  '/push',
  '/pull',
  '/branch',
  '/status',
  '/stash',
  // 6. Environment & Workspace Commands
  '/settings',
  '/theme',
  '/extensions',
  '/restart',
  // 7. Utility & Misc Commands
  '/snippet',
  '/cmd',
  '/log'
];

const debugLogPath = 'C:/Users/anand/OneDrive/Documents/Companion/03_Projects/OpenSource/CLI/Chatbot/NodeJS/debug_status.log';
try {
  fs.writeFileSync(debugLogPath, `=== Chatbot Debug Log Started at ${new Date().toISOString()} ===\n`);
} catch (e) {}

function getThemeColors() {
  const theme = config.getConfig().theme || 'classic';
  switch (theme.toLowerCase()) {
    case 'fire':
      return { border: chalk.red, detail: chalk.yellow, primary: chalk.yellow, name: 'FIRE' };
    case 'forest':
      return { border: chalk.green, detail: chalk.cyan, primary: chalk.green, name: 'FOREST' };
    case 'sunset':
      return { border: chalk.magenta, detail: chalk.yellow, primary: chalk.magenta, name: 'SUNSET' };
    case 'hacker':
      return { border: chalk.green, detail: chalk.green, primary: chalk.green, name: 'HACKER' };
    case 'classic':
    default:
      return { border: chalk.blue, detail: chalk.cyan, primary: chalk.blue, name: 'CLASSIC' };
  }
}

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
let currentPromptText = '';
let lastPromptLineCount = 1;
let lastPromptCursorLineIdx = 0;
let isGenerating = false;
let streamKeypressHandler = null;
let currentFile = null;
const HAS_HARNESS = process.env.ANAND_HARNESS === 'true';

// Viewport scrolling and file selection globals
let chatViewportLines = [];
let chatScrollOffset = 0;
let currentStreamingLine = '';
let mainSession = null;
let lastRenderedPanelRows = {};
let cachedWorkspaceFiles = null;
let currentActiveModel = '';

function getWorkspaceFiles(dir = process.cwd(), baseDir = process.cwd()) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (e) {
        continue;
      }
      
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      
      if (stat && stat.isDirectory()) {
        if (
          file === 'node_modules' ||
          file === '.git' ||
          file === '.gemini' ||
          file === 'exports' ||
          file === 'dist' ||
          file === 'build' ||
          file === '.commandcode' ||
          file === 'NodeJS_backup' ||
          file === 'NodeJS_backup_june24'
        ) {
          continue;
        }
        results = results.concat(getWorkspaceFiles(fullPath, baseDir));
      } else {
        const ext = path.extname(file).toLowerCase();
        const skipExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.wav', '.exe', '.dll', '.so', '.dylib'];
        if (skipExts.includes(ext)) {
          continue;
        }
        if (stat.size > 500 * 1024) {
          continue;
        }
        results.push(relPath);
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return results;
}

function processUserPromptWithAttachments(prompt) {
  if (!prompt) return { finalPrompt: prompt, hasAttachments: false };
  const words = prompt.split(/\s+/);
  const fileAttachments = [];
  const processedWords = words.map(word => {
    if (word.startsWith('@') && word.length > 1) {
      const cleanPath = word.slice(1).replace(/[.,?!:;)]+$/, "");
      const absolutePath = path.resolve(process.cwd(), cleanPath);
      if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
        try {
          const content = fs.readFileSync(absolutePath, 'utf8');
          fileAttachments.push({ path: cleanPath, content });
          return word;
        } catch (e) {
          return word;
        }
      }
    }
    return word;
  });

  if (fileAttachments.length === 0) {
    return { finalPrompt: prompt, hasAttachments: false };
  }

  let finalPrompt = processedWords.join(' ');
  finalPrompt += '\n\n--- Attached Files ---';
  for (const attachment of fileAttachments) {
    finalPrompt += `\n\nFile: ${attachment.path}\n\`\`\`\n${attachment.content}\n\`\`\``;
  }
  return { finalPrompt, hasAttachments: true };
}

function redrawViewport() {
  const H = process.stdout.rows || 24;
  const viewportHeight = H - lastPromptLineCount - 3;
  
  let tempLines = [...chatViewportLines];
  if (currentStreamingLine) {
    tempLines.push(currentStreamingLine);
  }
  
  const totalCount = tempLines.length;
  const startIdx = Math.max(0, totalCount - viewportHeight - chatScrollOffset);
  const endIdx = Math.max(0, totalCount - chatScrollOffset);
  const visibleLines = tempLines.slice(startIdx, endIdx);

  const width = process.stdout.columns || 80;
  const showPanel = firstMessageSent && width >= 80;
  const W_panel = width >= 100 ? 35 : 30;
  const W_chat = width - W_panel - 3;
  const clearWidth = showPanel ? W_chat : width;

  // Clear rows 1 to viewportHeight
  for (let r = 1; r <= viewportHeight; r++) {
    process.stdout.write(`\u001b[${r};1H` + ' '.repeat(clearWidth) + `\u001b[${r};1H`);
    const lineIndex = r - 1;
    if (lineIndex < visibleLines.length) {
      process.stdout.write(visibleLines[lineIndex]);
    }
  }

  chatCursorRow = Math.min(viewportHeight, visibleLines.length + 1);

  // Draw the divider and panel
  drawPermanentPanel(true);

  // Restore cursor position
  if (promptCursorRow !== null) {
    process.stdout.write(`\u001b[${promptCursorRow};${promptCursorCol}H`);
  } else {
    process.stdout.write(`\u001b[${chatCursorRow};${chatCursorCol}H`);
  }
}

function checkAndResetScroll() {
  if (chatScrollOffset > 0) {
    chatScrollOffset = 0;
    redrawViewport();
  }
}

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
  'gemini-2.0-flash': 1000000,
  'gemini-2.0-pro': 2000000,
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
  if (!modelName) return 128000;
  const nameLower = modelName.toLowerCase();
  
  // Check dynamically cached model context limits from API listModels responses first!
  const cachedLimit = modelContextLimits[nameLower] || modelContextLimits[modelName];
  if (cachedLimit) {
    return cachedLimit;
  }
  
  // 1. Explicit token size suffix detection (e.g. "8k", "32k", "128k", "256k", "1m")
  // Check for "k" suffixes
  const kMatch = nameLower.match(/(\d+)\s*k\b/);
  if (kMatch) {
    const num = parseInt(kMatch[1], 10);
    if (num === 8) return 8192;
    if (num === 16) return 16384;
    if (num === 32) return 32768;
    if (num === 64) return 64000;
    if (num === 128) return 128000;
    if (num === 256) return 256000;
    if (num === 262) return 262144;
    return num * 1000;
  }
  // Check for "m" suffixes
  const mMatch = nameLower.match(/(\d+(?:\.\d+)?)\s*m\b/);
  if (mMatch) {
    const num = parseFloat(mMatch[1]);
    return Math.round(num * 1000000);
  }

  // 2. Kimi / Moonshot AI
  if (nameLower.includes('kimi') || nameLower.includes('moonshot')) {
    if (nameLower.includes('2.6') || nameLower.includes('k2.6')) {
      return 262144;
    }
    if (nameLower.includes('8k')) return 8192;
    if (nameLower.includes('32k')) return 32768;
    if (nameLower.includes('128k')) return 128000;
    return 262144; // Default kimi limit
  }

  // 3. Gemini
  if (nameLower.includes('gemini')) {
    if (nameLower.includes('pro')) {
      return 2000000;
    }
    if (nameLower.includes('flash')) {
      return 1000000;
    }
    return 1000000;
  }
  
  // 4. Claude / Anthropic
  if (nameLower.includes('claude')) {
    if (nameLower.includes('claude-3') || nameLower.includes('claude-3.5') || nameLower.includes('claude-3-5')) {
      return 200000;
    }
    if (nameLower.includes('claude-2.1')) {
      return 200000;
    }
    if (nameLower.includes('claude-2') || nameLower.includes('claude-instant')) {
      return 100000;
    }
    return 200000;
  }
  
  // 5. OpenAI
  if (nameLower.includes('gpt-4o') || nameLower.includes('o1-') || nameLower.includes('o3-')) {
    return 128000;
  }
  if (nameLower.includes('gpt-4')) {
    if (nameLower.includes('turbo') || nameLower.includes('1106') || nameLower.includes('0125')) {
      return 128000;
    }
    if (nameLower.includes('32k')) {
      return 32768;
    }
    return 8192;
  }
  if (nameLower.includes('gpt-3.5')) {
    if (nameLower.includes('1106') || nameLower.includes('0125') || nameLower.includes('16k')) {
      return 16385;
    }
    return 4096;
  }

  // 6. DeepSeek
  if (nameLower.includes('deepseek')) {
    return 128000;
  }

  // 7. Llama
  if (nameLower.includes('llama')) {
    if (nameLower.includes('3.3') || nameLower.includes('3.2') || nameLower.includes('3.1') || nameLower.includes('3-1') || nameLower.includes('3-2') || nameLower.includes('3-3') || nameLower.includes('nemotron')) {
      return 128000;
    }
    if (nameLower.includes('3')) {
      return 8192;
    }
    if (nameLower.includes('2')) {
      return 4096;
    }
    return 128000;
  }

  // 8. Qwen
  if (nameLower.includes('qwen')) {
    if (nameLower.includes('2.5') || nameLower.includes('2-5')) {
      return 128000;
    }
    return 32768;
  }

  // 9. Mistral / Mixtral
  if (nameLower.includes('mistral') || nameLower.includes('mixtral') || nameLower.includes('codestral')) {
    if (nameLower.includes('large')) {
      return 128000;
    }
    if (nameLower.includes('nemo')) {
      return 128000;
    }
    if (nameLower.includes('8x22b')) {
      return 64000;
    }
    return 32768;
  }
  
  // 10. StepFun
  if (nameLower.includes('step-') || nameLower.includes('stepfun')) {
    if (nameLower.includes('3.7') || nameLower.includes('3-7')) {
      return 262144;
    }
    return 128000;
  }

  // 11. Phi
  if (nameLower.includes('phi')) {
    if (nameLower.includes('phi-3') || nameLower.includes('phi3')) {
      return 128000;
    }
    return 4096;
  }

  // 11. Gemma
  if (nameLower.includes('gemma')) {
    return 8192;
  }

  // 12. Grok
  if (nameLower.includes('grok')) {
    return 128000;
  }

  // 13. Perplexity Sonar
  if (nameLower.includes('sonar')) {
    return 128000;
  }
  
  const key = Object.keys(CONTEXT_LIMITS).find(k => nameLower.includes(k.toLowerCase()));
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

function drawPermanentPanel(forceRedraw = false) {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;
  if (!firstMessageSent || width < 80) return;

  const W_panel = width >= 100 ? 35 : 30;
  const W_chat = width - W_panel - 3;
  const cfg = config.getConfig();
  const modelName = currentActiveModel || cfg.model || 'gemini-2.5-flash';
  const panelLines = getPanelLines(modelName);

  // We write up to width - 1 to prevent hitting the bottom-right/rightmost column wrap scroll glitch
  const panelWidth = width - (W_chat + 1) - 1;
  
  if (forceRedraw || isGenerating) {
    lastRenderedPanelRows = {};
  }

  for (let r = 1; r <= height - 1; r++) {
    const colors = getThemeColors();
    const dividerStr = colors.border('│');
    
    let contentStr = '';
    if (r <= panelLines.length) {
      const line = panelLines[r - 1];
      const remainingSpaces = Math.max(0, panelWidth - (W_panel - 1));
      contentStr = line + chalk.bgHex('#1e1e24')(' '.repeat(remainingSpaces));
    } else {
      contentStr = chalk.bgHex('#1e1e24')(' '.repeat(panelWidth));
    }
    
    const rowKey = `${r}_${width}_${height}`;
    const rowText = dividerStr + contentStr;
    
    if (lastRenderedPanelRows[rowKey] !== rowText) {
      process.stdout.write(`\u001b[${r};${W_chat + 1}H` + rowText);
      lastRenderedPanelRows[rowKey] = rowText;
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

  const colors = getThemeColors();

  // Center Title dynamically
  const title = 'A.N.A.N.D PANEL';
  const titlePadding = Math.max(0, Math.floor((innerW - title.length) / 2));
  const centeredTitle = ' '.repeat(titlePadding) + title + ' '.repeat(innerW - title.length - titlePadding);
  lines.push(chalk.bgHex('#1e1e24')(colors.primary.bold(centeredTitle)));
  lines.push(formatLine(''));

  lines.push(formatLine(colors.primary.bold('TOKEN USAGE (Last Output)')));
  lines.push(formatLine(`  Prompt:     ${lastTokenUsage.promptTokens.toLocaleString()}`));
  lines.push(formatLine(`  Completion: ${lastTokenUsage.completionTokens.toLocaleString()}`));
  lines.push(formatLine(`  Total:      ${lastTokenUsage.totalTokens.toLocaleString()}`));
  lines.push(formatLine(''));

  const limit = getModelContextLimit(modelName);
  let used = lastTokenUsage.promptTokens || 0;
  if (mainSession) {
    const messages = mainSession.getMessages();
    const cfg = config.getConfig();
    const systemPrompt = cfg.system_prompt || '';
    const mode = cfg.mode || 'algo';
    let capLen = 0;
    if (mode === 'algo') {
      capLen = 1500;
    } else {
      capLen = 800;
    }
    const promptText = messages.map(m => m.content).join('\n') + systemPrompt;
    const estTokens = estimateTokens(promptText) + Math.round(capLen / 4);
    
    let typingTokens = 0;
    if (currentPromptText) {
      const { finalPrompt } = processUserPromptWithAttachments(currentPromptText);
      typingTokens = estimateTokens(finalPrompt);
    }
    used = Math.max(used, estTokens) + typingTokens;
  }
  const pct = Math.min(100, (used / limit) * 100);
  const barLen = W >= 35 ? 16 : 12;
  const filledLen = Math.round((pct / 100) * barLen);
  const bar = '█'.repeat(filledLen) + '░'.repeat(Math.max(0, barLen - filledLen));
  
  lines.push(formatLine(colors.primary.bold('CONTEXT WINDOW')));
  let modelDisplayName = modelName;
  if (modelDisplayName.length > innerW - 10) {
    modelDisplayName = modelDisplayName.substring(0, innerW - 13) + '...';
  }
  lines.push(formatLine(`  Model: ${modelDisplayName}`));
  lines.push(formatLine(`  Used:  ${formatCompactNumber(used)} / ${formatCompactNumber(limit)}`));
  lines.push(formatLine(`  Pct:   ${pct.toFixed(2)}%`));
  lines.push(formatLine(`  Bar:   [${colors.primary(bar)}]`));
  lines.push(formatLine(''));

  lines.push(formatLine(colors.primary.bold('TODO CHECKLIST')));
  if (currentTodos.length === 0) {
    lines.push(formatLine(chalk.gray('  (No tasks active)')));
  } else {
    currentTodos.forEach((todo) => {
      let statusIcon = chalk.gray('[ ]');
      if (todo.status === 'done') {
        statusIcon = colors.primary('[✓]');
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
    checkAndResetScroll();
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
    checkAndResetScroll();
    readline.cursorTo(process.stdout, 0);
    if (showPanel) {
      process.stdout.write(' '.repeat(W_chat + 1));
      readline.cursorTo(process.stdout, 0);
    } else {
      readline.clearLine(process.stdout, 0);
    }

    const styledContent = (this.styleFn && this.lineBuffer.length > 0)
      ? this.styleFn(this.lineBuffer)
      : this.lineBuffer;

    const styledLine = this.indent + this.prefix + styledContent;
    process.stdout.write(styledLine + '\n');

    chatViewportLines.push(styledLine);
    if (chatViewportLines.length > 5000) {
      chatViewportLines = chatViewportLines.slice(chatViewportLines.length - 5000);
    }
    
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
      drawPermanentPanel(true);
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
      const colors = getThemeColors();
      this.lineBuffer = colors.border('│') + ' ' + styledContent;
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
      drawPermanentPanel(true);
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
  logDebug('setupInterruptListener called (no-op, unified into streamKeypressHandler)');
  return () => {
    logDebug('setupInterruptListener cleanup called');
  };
}function startThinkingAnimation(prefix = '', promptBoxVisible = false, indent = '  ') {
  const lines = [
    "Trying my best to think",
    "Consulting the digital oracle",
    "Are you a keyboard? Because you're just my type",
    "My neural pathways are heating up for you",
    "Computing at the speed of love",
    "Is it hot in here or is it just my GPU",
    "Reticulating splines at maximum capacity",
    "Sending search queries to my imaginary friends",
    "Flirting with the database for answers",
    "Generating brainwaves... hold tight!"
  ];
  const funnyLine = lines[Math.floor(Math.random() * lines.length)];
  const startTime = Date.now();
  
  function drawFrame() {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const arrowIndex = (Math.floor((Date.now() - startTime) / 250) % 4) + 1;
    
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const spinner = spinnerFrames[Math.floor((Date.now() - startTime) / 100) % spinnerFrames.length];
    
    const dotsCount = Math.floor((Date.now() - startTime) / 500) % 4;
    const dots = '.'.repeat(dotsCount) + ' '.repeat(3 - dotsCount);
    const animatedLine = funnyLine.endsWith('!') || funnyLine.endsWith('?') 
      ? funnyLine 
      : `${funnyLine}${dots}`;
      
    // Save current cursor position
    process.stdout.write('\u001b[s');
    
    // Move cursor to chat area coordinates
    process.stdout.write(`\u001b[${chatCursorRow};${chatCursorCol}H`);
    const width = process.stdout.columns || 80;
    const W_panel = width >= 100 ? 35 : 30;
    const W_chat = width - W_panel - 3;
    const showPanel = firstMessageSent && width >= 80;
    if (showPanel) {
      process.stdout.write(' '.repeat(W_chat + 1));
      readline.cursorTo(process.stdout, 0);
    } else {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    
    const tagContent = prefix 
      ? ` ${spinner} ${prefix}${animatedLine} ` 
      : ` ${spinner} ${animatedLine} `;
    const tag = chalk.bgHex('#1e3a8a').hex('#93c5fd')(tagContent);
    
    const escColorFn = Math.floor((Date.now() - startTime) / 500) % 2 === 0 
      ? chalk.yellow.bold 
      : chalk.gray;
      
    const status = escColorFn(' esc to interrupt • ') + 
                   chalk.white(`${elapsedSeconds}s`) + 
                   chalk.gray(' • ') + 
                   chalk.cyan(`↓ ${arrowIndex}`);
                   
    process.stdout.write(indent + tag + status);
    
    // Restore cursor position
    process.stdout.write('\u001b[u');
  }
  
  drawFrame();
  const interval = setInterval(drawFrame, 100);

  return () => {
    clearInterval(interval);
    const width = process.stdout.columns || 80;
    const W_panel = width >= 100 ? 35 : 30;
    const W_chat = width - W_panel - 3;
    const showPanel = firstMessageSent && width >= 80;
    if (promptBoxVisible) {
      process.stdout.write('\u001b[s'); // Save cursor
      readline.moveCursor(process.stdout, 0, -2);
      readline.cursorTo(process.stdout, 0);
      if (showPanel) {
        process.stdout.write(' '.repeat(W_chat + 1));
      } else {
        readline.clearLine(process.stdout, 0);
      }
      process.stdout.write('\u001b[u'); // Restore cursor
    } else {
      if (showPanel) {
        process.stdout.write(' '.repeat(W_chat + 1));
        readline.cursorTo(process.stdout, 0);
      } else {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
      }
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
    
    let selectedIdx = 0;
    
    let actionText = '';
    let detailText = '';
    if (action === 'run_command') {
      actionText = 'Run Shell Command';
      detailText = payload.command;
    } else if (action === 'read_file') {
      actionText = 'Read File';
      detailText = payload.path;
    } else if (action === 'write_file') {
      actionText = 'Write File';
      detailText = payload.path;
    } else if (action === 'search_web') {
      actionText = 'Search Web';
      detailText = payload.query;
    } else if (action === 'browse_url') {
      actionText = 'Browse URL';
      detailText = payload.url;
    }

    const requestStartIdx = chatViewportLines.length;

    // Push initial details and choice lines to the virtual viewport buffer
    chatViewportLines.push(
      chalk.yellow.bold('⚠️  A.N.A.N.D Capability Request:'),
      `   Action:  ${chalk.cyan(actionText)}`,
      `   Target:  ${chalk.white.bold(detailText)}`,
      '', // Choices (will be updated dynamically)
      chalk.gray('   (Use Left/Right or Up/Down arrows to select, Enter to confirm)'),
      ''
    );

    function updateChoiceLine() {
      const choices = ['Allow Once', 'Always Allow', 'Reject'];
      let choicesStr = '   Choices: ';
      choices.forEach((choice, idx) => {
        if (idx === selectedIdx) {
          const color = idx === 2 ? chalk.black.bgRed : chalk.black.bgGreen;
          choicesStr += color(` > ${choice} `) + '   ';
        } else {
          choicesStr += chalk.cyan(`   ${choice}`) + '   ';
        }
      });
      chatViewportLines[requestStartIdx + 3] = choicesStr;
    }

    // Initialize choice line
    updateChoiceLine();
    
    // Clear scroll offset to show the request at the bottom
    chatScrollOffset = 0;
    redrawViewport();
    
    function cleanup() {
      stdin.removeListener('keypress', keypressHandler);
      
      // Update chat history with final result
      chatViewportLines.splice(requestStartIdx, 6);
      const statusText = selectedIdx === 2 
        ? chalk.red(`✖ Permission Rejected: ${actionText} (${detailText})`)
        : chalk.green(`✔ Permission Approved: ${actionText} (${detailText})`);
      chatViewportLines.push(statusText);
      
      // Redraw the main viewport
      redrawViewport();
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
        selectedIdx = (selectedIdx - 1 + 3) % 3;
        updateChoiceLine();
        redrawViewport();
        return;
      }
      
      if (key.name === 'right' || key.name === 'down') {
        selectedIdx = (selectedIdx + 1) % 3;
        updateChoiceLine();
        redrawViewport();
        return;
      }
    }
    
    stdin.on('keypress', keypressHandler);
  });
}

function makeHarnessRequest(action, payload = {}) {
  return new Promise(async (resolve, reject) => {
    if (!HAS_HARNESS) {
      reject(new Error("Harness not detected. Launch via node harness.js."));
      return;
    }
    
    const isAllowed = 
      (action === 'run_command' && whitelist.has(payload.command)) ||
      (action === 'search_web' && (whitelist.has('search_web:*') || whitelist.has(`search_web:${payload.query}`))) ||
      (action === 'browse_url' && (whitelist.has('browse_url:*') || whitelist.has(`browse_url:${payload.url}`))) ||
      (action === 'read_file' && (whitelist.has('read_file:*') || whitelist.has(`read_file:${payload.path}`))) ||
      (action === 'write_file' && (whitelist.has('write_file:*') || whitelist.has(`write_file:${payload.path}`)));
    if (!isAllowed) {
      try {
        const choice = await promptUserPermission(action, payload);
        if (choice === '1' || choice === '2') {
          if (choice === '2') {
            if (action === 'run_command') {
              whitelist.add(payload.command);
            } else if (action === 'search_web') {
              whitelist.add('search_web:*');
            } else if (action === 'browse_url') {
              whitelist.add('browse_url:*');
            } else if (action === 'read_file') {
              whitelist.add(`read_file:${payload.path}`);
            } else if (action === 'write_file') {
              whitelist.add(`write_file:${payload.path}`);
            }
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
  let output = '';
  const log = (str = '') => {
    output += str + '\n';
  };

  log(chalk.magenta.bold('\n=== A.N.A.N.D Commands Directory ==='));
  
  log(chalk.blue.bold('\n1. File & Project Commands:'));
  log(`  ${chalk.cyan('/new [path]')}     Create a new file`);
  log(`  ${chalk.cyan('/open [path]')}    Open an existing file`);
  log(`  ${chalk.cyan('/save')}           Save changes using the editor`);
  log(`  ${chalk.cyan('/rename [path]')}  Rename the active file`);
  log(`  ${chalk.cyan('/delete [path]')}  Delete a file`);
  log(`  ${chalk.cyan('/close')}          Close the active file`);

  log(chalk.blue.bold('\n2. Navigation Commands:'));
  log(`  ${chalk.cyan('/goto [dest]')}     Jump to file or search symbol`);
  log(`  ${chalk.cyan('/search [text]')}   Search text in the workspace`);
  log(`  ${chalk.cyan('/explorer')}        Toggle project directory tree`);

  log(chalk.blue.bold('\n3. Code Assistance Commands:'));
  log(`  ${chalk.cyan('/run [cmd]')}       Run current file or custom command`);
  log(`  ${chalk.cyan('/build')}           Build or compile the project`);
  log(`  ${chalk.cyan('/format')}          Auto-format active file`);
  log(`  ${chalk.cyan('/fix')}             Spawn Coding Agent to auto-fix active file`);
  log(`  ${chalk.cyan('/debug')}           Spawn Debugger Agent on active file`);

  log(chalk.blue.bold('\n4. AI / Agent Commands:'));
  log(`  ${chalk.cyan('/ask [prompt]')}    Ask AI about code or a question`);
  log(`  ${chalk.cyan('/explain')}         Ask AI to explain active file`);
  log(`  ${chalk.cyan('/generate [txt]')}  Spawn Coding Agent to generate code`);
  log(`  ${chalk.cyan('/test')}            Spawn Coding Agent to write tests`);
  log(`  ${chalk.cyan('/doc')}             Spawn Coding Agent to write docs`);

  log(chalk.blue.bold('\n5. Version Control (Git) Commands:'));
  log(`  ${chalk.cyan('/status')}          View git repository status`);
  log(`  ${chalk.cyan('/branch [name]')}   View or switch git branches`);
  log(`  ${chalk.cyan('/commit [msg]')}    Commit staged git changes`);
  log(`  ${chalk.cyan('/push')}            Push commits to remote`);
  log(`  ${chalk.cyan('/pull')}            Pull commits from remote`);
  log(`  ${chalk.cyan('/clone [url]')}     Clone a git repository`);
  log(`  ${chalk.cyan('/stash')}           Stash active git changes`);

  log(chalk.blue.bold('\n6. Environment & Workspace Commands:'));
  log(`  ${chalk.cyan('/terminal')}        Open interactive shell mode (ctrl+x t)`);
  log(`  ${chalk.cyan('/settings')}        Display current settings`);
  log(`  ${chalk.cyan('/theme [theme]')}   Switch CLI styling theme`);
  log(`  ${chalk.cyan('/extensions')}      List active workspace extensions`);
  log(`  ${chalk.cyan('/restart')}         Restart the A.N.A.N.D application`);

  log(chalk.blue.bold('\n7. Utility & General Commands:'));
  log(`  ${chalk.cyan('/provider [name]')} Toggle active provider (ctrl+x p)`);
  log(`  ${chalk.cyan('/models')}          Select active model (ctrl+x m)`);
  log(`  ${chalk.cyan('/coding-models')}   Select coding model pool (ctrl+x g)`);
  log(`  ${chalk.cyan('/debugger')}        Select debugger model (ctrl+x d)`);
  log(`  ${chalk.cyan('/algo')}            Switch to Multi-Agent Algorithm mode`);
  log(`  ${chalk.cyan('/normal')}          Switch to Single-Agent Chat mode`);
  log(`  ${chalk.cyan('/goal [task]')}     Run task autonomously (Normal mode)`);
  log(`  ${chalk.cyan('/loop [task]')}     Run task autonomously until completed`);
  log(`  ${chalk.cyan('/compact')}         Summarize history to save tokens (ctrl+x c)`);
  log(`  ${chalk.cyan('/sessions')}        List all exported chat logs (ctrl+x l)`);
  log(`  ${chalk.cyan('/system [txt]')}     Configure system prompt (ctrl+x s)`);
  log(`  ${chalk.cyan('/history [exp]')}    Renders or exports history (ctrl+x y)`);
  log(`  ${chalk.cyan('/clear')}           Reset terminal and chat memory (ctrl+x o)`);
  log(`  ${chalk.cyan('/snippet')}         Manage code snippets`);
  log(`  ${chalk.cyan('/cmd [cmd]')}        Run arbitrary shell command`);
  log(`  ${chalk.cyan('/log')}             View recent debug logs`);
  log(`  ${chalk.cyan('/exit')}            Exit session (ctrl+x q)`);
  
  log(chalk.blue.bold('\n8. Web Search & Browsing Commands:'));
  log(`  ${chalk.cyan('/search-web [q]')}    Search the web using DuckDuckGo`);
  log(`  ${chalk.cyan('/browse-url [url]')}  Browse target web page content`);
  log('');

  if (firstMessageSent) {
    writeToChat(output);
  } else {
    console.log(output);
  }
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
    let lastRowsLength = 0;
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
    const H_rows = process.stdout.rows || 24;
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
      const currentRowsLength = 6 + visibleChoices.length;
      
      // Build rows for the dialog box
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
      
      if (firstMessageSent) {
        // Clear any old lines from previous draws that might be higher up
        const maxPrevH = (lastRowsLength > 0 ? lastRowsLength : 8) + 7;
        const maxCurrH = rows.length + 7;
        if (maxPrevH > maxCurrH) {
          for (let r = H_rows - maxPrevH + 1; r <= H_rows - maxCurrH; r++) {
            stdout.write(`\u001b[${r};1H` + ' '.repeat(firstMessageSent ? boxWidth : width));
          }
        }

        // Draw Top Border
        let r = H_rows - (rows.length + 6);
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('┌' + '─'.repeat(boxWidth - 2) + '┐'));

        // Draw Rows
        rows.forEach((row, idx) => {
          r = H_rows - (rows.length + 5) + idx;
          stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('│ ') + row + chalk.blue(' │'));
        });

        // Draw Bottom Border
        r = H_rows - 5;
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('└' + '─'.repeat(boxWidth - 2) + '┘'));

        // Draw Empty Line
        r = H_rows - 4;
        stdout.write(`\u001b[${r};1H` + leftMargin + ' '.repeat(boxWidth));

        // Draw Prompt Box Top Padding Line
        r = H_rows - 3;
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)));

        // Draw Prompt Input Line
        r = H_rows - 2;
        const promptLine = `> ${cmdPrompt}`;
        const bgText = ` ${promptLine}`.padEnd(boxWidth - 2);
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24').white(bgText));

        // Draw Prompt Box Bottom Padding Line
        r = H_rows - 1;
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)));

        // Draw Status Line
        r = H_rows;
        stdout.write(`\u001b[${r};1H` + leftMargin + getStatusLine());

        // Position cursor back on the Input Line
        process.stdout.write(`\u001b[${H_rows - 2};${leftMargin.length + 5 + cmdPrompt.length}H`);
      } else {
        // 1. Clear old block if it exists
        if (lastH > 0) {
          readline.moveCursor(stdout, 0, -(lastRowsLength + 4));
          for (let i = 0; i < lastRowsLength + 7; i++) {
            readline.cursorTo(stdout, 0);
            readline.clearLine(stdout, 0);
            if (i < lastRowsLength + 6) {
              readline.moveCursor(stdout, 0, 1);
            }
          }
          readline.moveCursor(stdout, 0, -(lastRowsLength + 6));
        } else {
          readline.moveCursor(stdout, 0, -(currentRowsLength + 4));
        }
        
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
      }
      
      lastH = H;
      lastRowsLength = currentRowsLength;
    }
    
    function cleanup() {
      if (stdin.isTTY) {
        stdout.write('\u001b[?1000l\u001b[?1006l');
      }
      stdin.removeListener('data', dataHandler);
      if (lastH > 0) {
        if (firstMessageSent) {
          const totalRowsToClear = lastRowsLength + 7;
          for (let i = 0; i < totalRowsToClear; i++) {
            const row = H_rows - totalRowsToClear + 1 + i;
            stdout.write(`\u001b[${row};1H` + ' '.repeat(firstMessageSent ? boxWidth : width));
          }
          process.stdout.write(`\u001b[${H_rows - 2};1H`);
        } else {
          readline.moveCursor(stdout, 0, -(lastH + 2));
          for (let i = -(lastH + 2); i <= 2; i++) {
            readline.cursorTo(stdout, 0);
            readline.clearLine(stdout, 0);
            if (i <= -2) {
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
    let lastRowsLength = 0;
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
    const H_rows = process.stdout.rows || 24;
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
      const currentRowsLength = 6 + visibleChoices.length;
      
      // Build rows for the dialog box
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
      
      if (firstMessageSent) {
        // Clear any old lines from previous draws that might be higher up
        const maxPrevH = (lastRowsLength > 0 ? lastRowsLength : 8) + 7;
        const maxCurrH = rows.length + 7;
        if (maxPrevH > maxCurrH) {
          for (let r = H_rows - maxPrevH + 1; r <= H_rows - maxCurrH; r++) {
            stdout.write(`\u001b[${r};1H` + ' '.repeat(firstMessageSent ? boxWidth : width));
          }
        }

        // Draw Top Border
        let r = H_rows - (rows.length + 6);
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('┌' + '─'.repeat(boxWidth - 2) + '┐'));

        // Draw Rows
        rows.forEach((row, idx) => {
          r = H_rows - (rows.length + 5) + idx;
          stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('│ ') + row + chalk.blue(' │'));
        });

        // Draw Bottom Border
        r = H_rows - 5;
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('└' + '─'.repeat(boxWidth - 2) + '┘'));

        // Draw Empty Line
        r = H_rows - 4;
        stdout.write(`\u001b[${r};1H` + leftMargin + ' '.repeat(boxWidth));

        // Draw Prompt Box Top Padding Line
        r = H_rows - 3;
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)));

        // Draw Prompt Input Line
        r = H_rows - 2;
        const promptLine = `> ${cmdPrompt}`;
        const bgText = ` ${promptLine}`.padEnd(boxWidth - 2);
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24').white(bgText));

        // Draw Prompt Box Bottom Padding Line
        r = H_rows - 1;
        stdout.write(`\u001b[${r};1H` + leftMargin + chalk.blue('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)));

        // Draw Status Line
        r = H_rows;
        stdout.write(`\u001b[${r};1H` + leftMargin + getStatusLine());

        // Position cursor back on the Input Line
        process.stdout.write(`\u001b[${H_rows - 2};${leftMargin.length + 5 + cmdPrompt.length}H`);
      } else {
        // 1. Clear old block if it exists
        if (lastH > 0) {
          readline.moveCursor(stdout, 0, -(lastRowsLength + 4));
          for (let i = 0; i < lastRowsLength + 7; i++) {
            readline.cursorTo(stdout, 0);
            readline.clearLine(stdout, 0);
            if (i < lastRowsLength + 6) {
              readline.moveCursor(stdout, 0, 1);
            }
          }
          readline.moveCursor(stdout, 0, -(lastRowsLength + 6));
        } else {
          readline.moveCursor(stdout, 0, -(currentRowsLength + 4));
        }
        
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
      }
      
      lastH = H;
      lastRowsLength = currentRowsLength;
    }
    
    function cleanup() {
      if (stdin.isTTY) {
        stdout.write('\u001b[?1000l\u001b[?1006l');
      }
      stdin.removeListener('data', dataHandler);
      if (lastH > 0) {
        if (firstMessageSent) {
          const totalRowsToClear = lastRowsLength + 7;
          for (let i = 0; i < totalRowsToClear; i++) {
            const row = H_rows - totalRowsToClear + 1 + i;
            stdout.write(`\u001b[${row};1H` + ' '.repeat(firstMessageSent ? boxWidth : width));
          }
          process.stdout.write(`\u001b[${H_rows - 2};1H`);
        } else {
          readline.moveCursor(stdout, 0, -(lastH + 2));
          for (let i = -(lastH + 2); i <= 2; i++) {
            readline.cursorTo(stdout, 0);
            readline.clearLine(stdout, 0);
            if (i <= -2) {
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

export function drawPromptTextGlobal() {
  const cfg = config.getConfig();
  const providerName = cfg.provider || 'gemini';
  const modelName = cfg.model || 'gemini-2.5-flash';
  
  const width = process.stdout.columns || 80;
  const H_rows = process.stdout.rows || 24;
  const W_panel = width >= 100 ? 35 : 30;
  const W_chat = width - W_panel - 3;
  const boxWidth = firstMessageSent ? W_chat : Math.min(70, width);
  const leftMargin = firstMessageSent ? '' : ' '.repeat(Math.max(0, Math.floor((width - boxWidth) / 2)));
  const colors = getThemeColors();
  
  const innerWidth = boxWidth - 2;
  const lines = [];
  const paddedInput = currentPromptText || '';
  for (let i = 0; i < paddedInput.length; i += innerWidth) {
    lines.push(paddedInput.substring(i, i + innerWidth));
  }
  if (lines.length === 0) {
    lines.push('');
  }
  if (paddedInput.length % innerWidth === 0 && paddedInput.length > 0) {
    lines.push('');
  }
  const lineCount = lines.length;
  
  const cursorLineIdx = Math.floor(paddedInput.length / innerWidth);
  const cursorColIdx = paddedInput.length % innerWidth;
  
  function getStatusLineLocal() {
    const mode = (cfg.mode || 'algo').toUpperCase();
    let leftStatus;
    if (isGenerating) {
      const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      const spinner = spinnerFrames[Math.floor(Date.now() / 100) % spinnerFrames.length];
      const escColorFn = Math.floor(Date.now() / 500) % 2 === 0 ? chalk.yellow.bold : chalk.gray;
      leftStatus = chalk.cyan(`${spinner} Generating response... `) + escColorFn('[ESC to interrupt]');
    } else {
      leftStatus = `enter send  [Mode: ${mode}]`;
    }
    const leftStatusClean = leftStatus.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?::[0-9]{1,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    const rightStatus = `${providerName.toUpperCase()} / ${modelName}`;
    const spacesCount = Math.max(1, boxWidth - leftStatusClean.length - rightStatus.length);
    return (isGenerating ? leftStatus : chalk.gray(leftStatus)) + ' '.repeat(spacesCount) + chalk.gray(rightStatus);
  }

  if (firstMessageSent) {
    const maxL = Math.max(lastPromptLineCount, lineCount);
    // Clear any old lines that might have been part of a taller box previously
    for (let l = H_rows - (maxL + 2); l < H_rows - (lineCount + 2); l++) {
      process.stdout.write(`\u001b[${l};1H` + ' '.repeat(firstMessageSent ? boxWidth : width));
    }
    
    // Top padding row
    let r = H_rows - (lineCount + 2);
    process.stdout.write(`\u001b[${r};1H` + leftMargin + colors.border('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)));
    
    // Input text rows
    for (let i = 0; i < lineCount; i++) {
      r = H_rows - (lineCount + 1) + i;
      const content = lines[i].padEnd(boxWidth - 2);
      process.stdout.write(`\u001b[${r};1H` + leftMargin + colors.border('│') + chalk.bgHex('#1e1e24').white(content));
    }
    
    // Bottom padding row
    r = H_rows - 1;
    process.stdout.write(`\u001b[${r};1H` + leftMargin + colors.border('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)));
    
    // Status row
    r = H_rows;
    process.stdout.write(`\u001b[${r};1H` + leftMargin + getStatusLineLocal());
    
    // Place cursor on active input row/col
    promptCursorRow = H_rows - (lineCount + 1) + cursorLineIdx;
    promptCursorCol = leftMargin.length + 2 + cursorColIdx;
    process.stdout.write(`\u001b[${promptCursorRow};${promptCursorCol}H`);
  } else {
    // Move to the top of the previously drawn box padding row relatively
    const moveUp = lastPromptCursorLineIdx + 1;
    if (moveUp > 0) {
      readline.moveCursor(process.stdout, 0, -moveUp);
    }
    
    // Redraw top padding line
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(leftMargin + colors.border('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)) + '\n');
    
    // Redraw input text lines
    for (let i = 0; i < lineCount; i++) {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      const content = lines[i].padEnd(boxWidth - 2);
      process.stdout.write(leftMargin + colors.border('│') + chalk.bgHex('#1e1e24').white(content) + '\n');
    }
    
    // Redraw bottom padding line
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(leftMargin + colors.border('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)) + '\n');
    
    // Redraw status line
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(leftMargin + getStatusLineLocal());
    
    // If box shrank, clean up trailing lines
    if (lineCount < lastPromptLineCount) {
      const diff = lastPromptLineCount - lineCount;
      for (let i = 0; i < diff; i++) {
        process.stdout.write('\n');
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
      }
      readline.moveCursor(process.stdout, 0, -diff);
    }
    
    // Move back to active input line
    const moveBackUp = lineCount - cursorLineIdx + 1;
    if (moveBackUp > 0) {
      readline.moveCursor(process.stdout, 0, -moveBackUp);
    }
    promptCursorCol = leftMargin.length + 2 + cursorColIdx;
    readline.cursorTo(process.stdout, leftMargin.length + 1 + cursorColIdx);
    
    const stdoutRows = process.stdout.rows || 24;
    promptCursorRow = stdoutRows - (lineCount + 1) + cursorLineIdx;
  }
  
  lastPromptLineCount = lineCount;
  lastPromptCursorLineIdx = cursorLineIdx;
  
  drawPermanentPanel();
}

export function activateGenerationInput() {
  if (streamKeypressHandler) return;
  
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    
    const width = process.stdout.columns || 80;
    const H_rows = process.stdout.rows || 24;
    const W_panel = width >= 100 ? 35 : 30;
    const W_chat = width - W_panel - 3;
    const boxWidth = firstMessageSent ? W_chat : Math.min(70, width);
    const leftMargin = firstMessageSent ? '' : ' '.repeat(Math.max(0, Math.floor((width - boxWidth) / 2)));
    
    promptCursorRow = H_rows - 2;
    promptCursorCol = leftMargin.length + 2 + (currentPromptText.length % (boxWidth - 2));

    streamKeypressHandler = (str, key) => {
      if (!key) key = {};
      
      logDebug(`streamKeypressHandler keypress: name=${key.name}, seq=${key.sequence ? key.sequence.replace(/\u001b/g, 'ESC') : ''}, str=${str ? str.replace(/\u001b/g, 'ESC') : ''}`);

      if (key.ctrl && key.name === 'c') {
        restoreTerminalSync();
        process.exit(0);
      }
      
      if (key.name === 'escape' || key.sequence === '\u001b') {
        interrupted = true;
        activeGoal = null;
        activeLoop = null;
        if (currentAbortController) {
          currentAbortController.abort();
        }
        return;
      }
      
      if (key.name === 'pageup') {
        const viewportHeight = (process.stdout.rows || 24) - lastPromptLineCount - 3;
        chatScrollOffset = Math.min(chatViewportLines.length - viewportHeight, chatScrollOffset + 5);
        if (chatScrollOffset < 0) chatScrollOffset = 0;
        redrawViewport();
        return;
      }
      
      if (key.name === 'pagedown') {
        chatScrollOffset = Math.max(0, chatScrollOffset - 5);
        redrawViewport();
        return;
      }

      if (key.name === 'up') {
        const viewportHeight = (process.stdout.rows || 24) - lastPromptLineCount - 3;
        chatScrollOffset = Math.min(chatViewportLines.length - viewportHeight, chatScrollOffset + 1);
        if (chatScrollOffset < 0) chatScrollOffset = 0;
        redrawViewport();
        return;
      }

      if (key.name === 'down') {
        chatScrollOffset = Math.max(0, chatScrollOffset - 1);
        redrawViewport();
        return;
      }

      if (key.ctrl || key.meta) {
        return;
      }
      if (str && str.startsWith('\u001b')) {
        return;
      }
      
      if (key.name === 'backspace' || str === '\b' || str === '\x7f') {
        if (currentPromptText.length > 0) {
          currentPromptText = currentPromptText.slice(0, -1);
        }
        if (chatScrollOffset > 0) {
          chatScrollOffset = 0;
          redrawViewport();
        }
      } else if (str && key.name !== 'escape' && str !== '\n' && str !== '\r') {
        currentPromptText += str;
        if (chatScrollOffset > 0) {
          chatScrollOffset = 0;
          redrawViewport();
        }
      }
      
      drawPromptTextGlobal();
    };
    
    process.stdin.on('keypress', streamKeypressHandler);
  }
}

export function deactivateGenerationInput() {
  if (streamKeypressHandler) {
    process.stdin.removeListener('keypress', streamKeypressHandler);
    streamKeypressHandler = null;
  }
}

export function writeToChat(text) {
  chatScrollOffset = 0;
  const lines = text.split('\n');
  chatViewportLines.push(...lines);
  if (chatViewportLines.length > 5000) {
    chatViewportLines = chatViewportLines.slice(chatViewportLines.length - 5000);
  }
  chatCursorCol = 1;
  redrawViewport();
}

// Autocomplete prompt with box borders & bottom status bar aligned with mockup
export async function askQuestion(promptText) {

  logDebug('askQuestion function call');
  if (firstMessageSent) {
    redrawViewport();
  }
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
    '/run': 'Run current file or custom command',
    '/read': 'Read workspace files (requires harness)',
    '/write': 'Write files to workspace (requires harness)',
    '/terminal': 'Open interactive terminal shell',
    '/exit': 'Exit the app (safely terminate chatbot session)',
    '/search-web': 'Search the web (DuckDuckGo)',
    '/browse-url': 'Browse web page content (HTML to MD)',
    '/new': 'Create a new file in workspace',
    '/open': 'Open an existing file in workspace',
    '/save': 'Save active file with multi-line editor',
    '/rename': 'Rename active file',
    '/delete': 'Delete a file from workspace',
    '/close': 'Close the active file',
    '/goto': 'Jump to a file or search symbol',
    '/search': 'Search text in project workspace',
    '/explorer': 'Toggle project file tree explorer',
    '/build': 'Build or compile the project',
    '/format': 'Auto-format the current file code',
    '/fix': 'Spawn Coding Agent to auto-fix code',
    '/debug': 'Spawn Debugger Agent on active file',
    '/ask': 'Ask AI about active file or a question',
    '/explain': 'Ask AI to explain active file code',
    '/generate': 'Spawn Coding Agent to generate code',
    '/test': 'Spawn Coding Agent to generate tests',
    '/doc': 'Spawn Coding Agent to generate docs',
    '/clone': 'Clone a git repository to workspace',
    '/commit': 'Commit staged changes via Git',
    '/push': 'Push commits to Git remote repository',
    '/pull': 'Pull updates from Git remote repository',
    '/branch': 'View or switch Git branches',
    '/status': 'View Git repository status',
    '/stash': 'Stash active changes in Git repository',
    '/settings': 'Display configuration settings',
    '/theme': 'Switch CLI styling theme',
    '/extensions': 'List active workspace extensions',
    '/restart': 'Restart the A.N.A.N.D application',
    '/snippet': 'Insert or manage code snippets',
    '/cmd': 'Run an arbitrary shell command',
    '/log': 'View recent chatbot debug logs'
  };

  return new Promise((resolve) => {
    logDebug('askQuestion Promise executor start');
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    readline.emitKeypressEvents(stdin);
    stdin.resume();
    logDebug('askQuestion stdin configured (raw + resumed)');
    
    let input = currentPromptText;
    let suggestions = [];
    let selectedIdx = 0;
    let showingSuggestions = false;
    let ctrlXActive = false;
    let ignoreUntilMouseEnd = false;
    let lastLineCount = lastPromptLineCount;
    let lastCursorLineIdx = lastPromptCursorLineIdx;
    
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
    promptCursorCol = leftMargin.length + 2;

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

    const colors = getThemeColors();

    // Dynamically draw the prompt box using the global input text
    drawPromptText();
    
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
        readline.cursorTo(stdout, leftMargin.length + 1 + input.length);
      }, 2000);
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
      currentPromptText = input;
      drawPromptTextGlobal();
      lastLineCount = lastPromptLineCount;
      lastCursorLineIdx = lastPromptCursorLineIdx;
    }

    
    function drawSuggestionsBox() {
      const hasSuggestions = showingSuggestions && suggestions.length > 0;
      const maxDisplay = 10;
      const total = suggestions.length;
      const colors = getThemeColors();
      
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
            if (firstMessageSent) {
              stdout.write(' '.repeat(boxWidth));
            } else {
              readline.clearLine(stdout, 0);
            }
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
          if (firstMessageSent) {
            stdout.write(' '.repeat(boxWidth));
            readline.cursorTo(stdout, 0);
          } else {
            readline.clearLine(stdout, 0);
          }
          
          let desc = COMMAND_DESCRIPTIONS[cmd] || '';
          if (cmd.startsWith('@')) {
            desc = 'Workspace file';
          }
          const actualIdx = startIdx + idx;
          const maxDescLen = innerWidth - 17;
          const truncatedDesc = desc.length > maxDescLen ? desc.slice(0, maxDescLen - 3) + '...' : desc;
          
          const content = ' ' + cmd.padEnd(15) + truncatedDesc;
          const paddedContent = content.padEnd(innerWidth);
          
          if (actualIdx === selectedIdx) {
            stdout.write(leftMargin + colors.border('│') + ' ' + chalk.bgHex('#3B82F6').black(paddedContent) + '\n');
          } else {
            stdout.write(leftMargin + colors.border('│') + ' ' + chalk.bgHex('#1e1e24').white(paddedContent) + '\n');
          }
        });
        
        // Draw Line 1 (top padding line of input box)
        readline.cursorTo(stdout, 0);
        if (firstMessageSent) {
          stdout.write(' '.repeat(boxWidth));
          readline.cursorTo(stdout, 0);
        } else {
          readline.clearLine(stdout, 0);
        }
        stdout.write(leftMargin + colors.border('│') + chalk.bgHex('#1e1e24')(' '.repeat(boxWidth - 2)) + '\n');
        
        // Cursor is now on Line 2 (input line)
        readline.cursorTo(stdout, leftMargin.length + 1 + input.length);
      } else {
        // Cursor is on Line 2 (input line)
        readline.cursorTo(stdout, leftMargin.length + 1 + input.length);
      }
      
      // Update prompt line and position cursor
      drawPromptText();
      
      prevN = newN;
    }
    
    function updateStatusLine() {
      // Move down 2 lines (from input line Line 2 to status line Line 4)
      readline.moveCursor(stdout, 0, 2);
      readline.cursorTo(stdout, 0);
      if (firstMessageSent) {
        stdout.write(' '.repeat(boxWidth));
        readline.cursorTo(stdout, 0);
      } else {
        readline.clearLine(stdout, 0);
      }
      stdout.write(leftMargin + getStatusLine());
      
      // Move back up 2 lines to input line Line 2
      readline.moveCursor(stdout, 0, -2);
      readline.cursorTo(stdout, leftMargin.length + 1 + input.length);
    }
    
    function cleanEverythingBeforeExit() {
      const hasTempMsg = !!temporaryMessage;
      
      if (firstMessageSent) {
        if (prevN > 0) {
          readline.moveCursor(stdout, 0, -(prevN + 1));
          for (let i = 0; i < prevN; i++) {
            readline.cursorTo(stdout, 0);
            if (firstMessageSent) {
              stdout.write(' '.repeat(boxWidth));
            } else {
              readline.clearLine(stdout, 0);
            }
            readline.moveCursor(stdout, 0, 1);
          }
          readline.moveCursor(stdout, 0, 1);
        }
        
        // Clear entire prompt box block (including status line)
        const totalRowsToClear = lastLineCount + 3;
        for (let i = 0; i < totalRowsToClear; i++) {
          const row = H_rows - totalRowsToClear + 1 + i;
          stdout.write(`\u001b[${row};1H` + ' '.repeat(firstMessageSent ? boxWidth : width));
        }
        stdout.write(`\u001b[${H_rows - totalRowsToClear + 1};1H`);
      } else {
        const topOffset = prevN > 0 ? -(prevN + 1) : -1;
        const height = prevN > 0 ? (prevN + 2 + lastLineCount + 2 + (hasTempMsg ? 1 : 0)) : (lastLineCount + 3 + (hasTempMsg ? 1 : 0));
        
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
          currentPromptText = '';
          resolve(mappedCmd);
        } else {
          updateStatusLine();
          drawPromptText();
        }
        return;
      }
      
      if (key.name === 'return' || str === '\n' || str === '\r') {
        if (showingSuggestions && suggestions.length > 0) {
          const words = input.split(' ');
          const lastWord = words[words.length - 1];
          if (lastWord.startsWith('@')) {
            words[words.length - 1] = suggestions[selectedIdx];
            input = words.join(' ') + ' ';
          } else {
            input = suggestions[selectedIdx] + ' ';
          }
          showingSuggestions = false;
          suggestions = [];
          setMouseTracking(false);
          drawSuggestionsBox();
        } else {
          cleanEverythingBeforeExit();
          cleanup();
          currentPromptText = '';
          resolve(input.trim());
        }
        return;
      }
      
      if (key.name === 'pageup') {
        const viewportHeight = (process.stdout.rows || 24) - lastPromptLineCount - 3;
        chatScrollOffset = Math.min(chatViewportLines.length - viewportHeight, chatScrollOffset + 5);
        if (chatScrollOffset < 0) chatScrollOffset = 0;
        redrawViewport();
        if (showingSuggestions) {
          drawSuggestionsBox();
        }
        return;
      }
      
      if (key.name === 'pagedown') {
        chatScrollOffset = Math.max(0, chatScrollOffset - 5);
        redrawViewport();
        if (showingSuggestions) {
          drawSuggestionsBox();
        }
        return;
      }

      if (key.name === 'up') {
        if (showingSuggestions && suggestions.length > 0) {
          selectedIdx = (selectedIdx - 1 + suggestions.length) % suggestions.length;
          drawSuggestionsBox();
        } else {
          const viewportHeight = (process.stdout.rows || 24) - lastPromptLineCount - 3;
          chatScrollOffset = Math.min(chatViewportLines.length - viewportHeight, chatScrollOffset + 1);
          if (chatScrollOffset < 0) chatScrollOffset = 0;
          redrawViewport();
        }
        return;
      }
      
      if (key.name === 'down') {
        if (showingSuggestions && suggestions.length > 0) {
          selectedIdx = (selectedIdx + 1) % suggestions.length;
          drawSuggestionsBox();
        } else {
          chatScrollOffset = Math.max(0, chatScrollOffset - 1);
          redrawViewport();
        }
        return;
      }
      
      if (key.name === 'backspace' || str === '\b' || str === '\x7f') {
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
        if (chatScrollOffset > 0) {
          chatScrollOffset = 0;
          redrawViewport();
        }
      } else if (str && !key.meta && key.name !== 'escape' && str !== '\n' && str !== '\r') {
        if (str.startsWith('\u001b') || (key.sequence && key.sequence.startsWith('\u001b'))) {
          return;
        }
        input += str;
        if (chatScrollOffset > 0) {
          chatScrollOffset = 0;
          redrawViewport();
        }
      }
      
      updateSuggestions();
      drawSuggestionsBox();
    }
    
    function updateSuggestions() {
      const wasShowing = showingSuggestions;
      const words = input.split(' ');
      const lastWord = words[words.length - 1];
      
      if (lastWord.startsWith('@')) {
        const fileQuery = lastWord.slice(1).toLowerCase();
        if (!cachedWorkspaceFiles) {
          cachedWorkspaceFiles = getWorkspaceFiles();
        }
        suggestions = cachedWorkspaceFiles
          .filter(f => f.toLowerCase().includes(fileQuery))
          .map(f => '@' + f);
          
        if (suggestions.length > 0) {
          showingSuggestions = true;
          if (selectedIdx >= suggestions.length) {
            selectedIdx = 0;
          }
        } else {
          showingSuggestions = false;
          suggestions = [];
        }
      } else if (input.startsWith('/') && words.length === 1) {
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

  let leftStatus;
  if (isGenerating) {
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const spinner = spinnerFrames[Math.floor(Date.now() / 100) % spinnerFrames.length];
    const escColorFn = Math.floor(Date.now() / 500) % 2 === 0 ? chalk.yellow.bold : chalk.gray;
    leftStatus = chalk.cyan(`${spinner} Generating response... `) + escColorFn('[ESC to interrupt]');
  } else {
    leftStatus = `enter send  [Mode: ${mode}]`;
  }
  const leftStatusClean = leftStatus.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?::[0-9]{1,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  const rightStatus = `${providerName.toUpperCase()} / ${modelName}`;
  const spacesCount = Math.max(1, boxWidth - leftStatusClean.length - rightStatus.length);
  const statusLine = (isGenerating ? leftStatus : chalk.gray(leftStatus)) + ' '.repeat(spacesCount) + chalk.gray(rightStatus);

  // Save cursor position
  if (!firstMsgSent) {
    process.stdout.write('\u001b[s');
  }

  // Draw 3 lines of empty input background with themed vertical border on left
  const colors = getThemeColors();
  for (let i = 0; i < 3; i++) {
    const row = height - 3 + i;
    process.stdout.write(`\u001b[${row};1H` + leftMargin + colors.border('│') + chalk.bgHex('#1e1e24')(bgText));
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
  currentActiveModel = modelName;
  logDebug('handleResponseStream start');
  if (interrupted) {
    activeGoal = null;
    activeLoop = null;
    logDebug('handleResponseStream start - interrupted');
    return;
  }

  let statusBarInterval = null;
  const isOutermost = !isGenerating;
  if (isOutermost) {
    isGenerating = true;
    currentPromptText = '';
    lastPromptLineCount = 1;
    lastPromptCursorLineIdx = 0;
    activateGenerationInput();
    statusBarInterval = setInterval(() => {
      if (isGenerating) {
        drawPromptBoxAtBottom(true);
      }
    }, 100);
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

You can also search the web and browse target URLs to gather documentation or context for planning.
CRITICAL: Whenever you decide to search the web or browse a URL, you MUST first explain to the user in friendly conversational text in your reply that you are going to search the web or browse the page, and what you are looking for, BEFORE outputting the XML tag:
- Search the web: <search_web>your query here</search_web>
- Browse a URL: <browse_url>URL here</browse_url>

CRITICAL: DO NOT execute shell commands (like curl, wget, or node webfetch.js) to search the web or browse URLs. You MUST use the <search_web> and <browse_url> tags instead.

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
You have direct access to the local workspace and can execute commands, read files, write files, search the web, and browse URLs using special XML tags:
- Run a shell command: <run_command>your command here</run_command>
- Read a file: <read_file>your file path here</read_file>
- Write a file: <write_file path="your file path here">your file content here</write_file>
- Search the web: <search_web>your query here</search_web>
- Browse a URL page: <browse_url>your URL here</browse_url>

CRITICAL: DO NOT execute shell commands (like curl, wget, or node webfetch.js) to search the web or browse URLs. You MUST use the <search_web> and <browse_url> tags instead.

IMPORTANT: Whenever you are given a task, you must divide it into a list of todo tasks and output this checklist at the start of your response inside a <todos> tag.
Format:
<todos>
- [ ] Sub-task 1
- [ ] Sub-task 2
</todos>
As you progress, execute the tasks one by one using XML tags, and output the updated checklist in your subsequent responses showing which tasks are completed ([x]), in-progress ([/]), or pending ([ ]).

When you need to use a capability (except search_web or browse_url) to complete the user's request, output the appropriate tag. Do not explain your actions before outputting the tag. Once you receive the capability output, continue your response.
CRITICAL: If you need to search the web or browse a page, you MUST first inform the user in friendly conversational text in your response (e.g. "Let me search the web for..." or "I will check that URL to see...") before outputting the tag. Do not output the search_web or browse_url tags in silence without explaining/informing the user first.
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
      
      // Temporarily deactivate prompt cursor position mapping and move to chat position
      const oldPromptRow = promptCursorRow;
      const oldPromptCol = promptCursorCol;
      if (oldPromptRow !== null) {
        promptCursorRow = null;
        promptCursorCol = null;
        process.stdout.write(`\u001b[${chatCursorRow};${chatCursorCol}H`);
      }

      if (firstChunk) {
        if (stopAnimation) stopAnimation();
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
          } else if (candidateBuffer === '<search_web>') {
            state = 'SUPPRESSED';
            suppressClosingTag = '</search_web>';
            candidateBuffer = '';
          } else if (candidateBuffer === '<browse_url>') {
            state = 'SUPPRESSED';
            suppressClosingTag = '</browse_url>';
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
              '<search_web>', '</search_web>',
              '<browse_url>', '</browse_url>',
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

      // Restore prompt cursor positioning at end of chunk processing
      if (oldPromptRow !== null) {
        promptCursorRow = oldPromptRow;
        promptCursorCol = oldPromptCol;
        process.stdout.write(`\u001b[${promptCursorRow};${promptCursorCol}H`);
      }
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
    if (statusBarInterval) {
      clearInterval(statusBarInterval);
    }
    currentAbortController = null;
    // Reset scrolling region back to entire screen
    process.stdout.write('\u001b[r');
    // Position cursor at H-3 so the next askQuestion draws cleanly on the prompt box rows
    process.stdout.write(`\u001b[${H - 3};1H`);
    
    if (isOutermost) {
      deactivateGenerationInput();
      isGenerating = false;
      promptCursorRow = null;
      promptCursorCol = null;
      currentActiveModel = '';
    }
    
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
  const searchRegex = /<search_web>([\s\S]*?)<\/search_web>/;
  const browseRegex = /<browse_url>([\s\S]*?)<\/browse_url>/;
  
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
  } else if (searchRegex.test(response)) {
    const match = response.match(searchRegex);
    matchedText = match[0];
    action = 'search_web';
    payload = { query: match[1].trim() };
  } else if (browseRegex.test(response)) {
    const match = response.match(browseRegex);
    matchedText = match[0];
    action = 'browse_url';
    payload = { url: match[1].trim() };
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
      writeToChat(chalk.green('• ') + chalk.yellow('RunCommand') + chalk.gray(`(${payload.command})`));
    } else if (action === 'read_file') {
      writeToChat(chalk.green('• ') + chalk.yellow('Read') + chalk.gray(`(${payload.path})`));
    } else if (action === 'write_file') {
      writeToChat(chalk.green('• ') + chalk.yellow('Write') + chalk.gray(`(${payload.path})`));
    } else if (action === 'search_web') {
      writeToChat(chalk.blue('ℹ A.N.A.N.D is searching the web for: ') + chalk.cyan(`"${payload.query}"...`) + '\n' +
                  chalk.green('• ') + chalk.yellow('WebFetch') + chalk.gray(`(${payload.query})`));
    } else if (action === 'browse_url') {
      writeToChat(chalk.blue('ℹ A.N.A.N.D is browsing: ') + chalk.cyan(`"${payload.url}"...`) + '\n' +
                  chalk.green('• ') + chalk.yellow('WebFetch') + chalk.gray(`(${payload.url})`));
    } else if (action === 'spawn_agent') {
      writeToChat(chalk.green('• ') + chalk.yellow('SpawnAgent') + chalk.gray(`(${payload.task})`));
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
        writeToChat(chalk.gray(`   (Agent executed command: ${payload.command})`));
      } else if (action === 'read_file') {
        writeToChat(chalk.gray(`   (Agent read file: ${payload.path})`));
      } else if (action === 'write_file') {
        writeToChat(chalk.gray(`   (Agent wrote file: ${payload.path})`));
      } else if (action === 'search_web') {
        writeToChat(chalk.gray(`   (Agent used WebFetch to search "${payload.query}")`));
      } else if (action === 'browse_url') {
        writeToChat(chalk.gray(`   (Agent used WebFetch to browse "${payload.url}")`));
      } else if (action === 'spawn_agent') {
        writeToChat(chalk.gray(`   (Agent spawned coding subagent for task: "${payload.task}")`));
      }
      
      if (!interrupted) {
        session.addMessage('user', `[System: Capability output for ${matchedText}]:\n${output}`);
        await handleResponseStream(provider, systemPrompt, session.getMessages(), modelName, session);
      }
    } catch (e) {
      if (interrupted) {
        return;
      }
      writeToChat(chalk.red(`Terminal > Error: ${e.message}`));
      if ((activeGoal || activeLoop) && (e.message.includes('Permission Denied') || e.message.includes('rejected'))) {
        writeToChat(chalk.red.bold(`🎯 Goal/Loop Cancelled: Capability request was rejected.`));
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

You have access to the local workspace and can execute commands, read files, write files, search the web, and browse URLs using special XML tags:
- Run a shell command: <run_command>your command here</run_command>
- Read a file: <read_file>your file path here</read_file>
- Write a file: <write_file path="your file path here">your file content here</write_file>
- Search the web: <search_web>your query here</search_web>
- Browse a URL page: <browse_url>your URL here</browse_url>

CRITICAL RULES:
1. ONLY execute shell commands or read/write files related directly to your assigned subtask.
2. Once you have completed your task, write a brief summary of what you did and end your output. Do not output any more tags once your task is done.
3. DO NOT execute shell commands (like curl, wget, or node webfetch.js) to search the web or browse URLs. You MUST use the <search_web> and <browse_url> tags instead.
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

      currentActiveModel = agentModel;
      for await (const chunk of agentProvider.generateStream(fullAgentSystemPrompt, agentSession.getMessages(), agentModel, signal)) {
        if (interrupted) break;
        if (firstChunk) {
          if (stopAnimation) stopAnimation();
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
            } else if (candidateBuffer === '<search_web>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</search_web>';
              candidateBuffer = '';
            } else if (candidateBuffer === '<browse_url>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</browse_url>';
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
                '<search_web>', '</search_web>',
                '<browse_url>', '</browse_url>',
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
      const searchRegex = /<search_web>([\s\S]*?)<\/search_web>/;
      const browseRegex = /<browse_url>([\s\S]*?)<\/browse_url>/;
      
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
      } else if (searchRegex.test(fullResponse)) {
        const match = fullResponse.match(searchRegex);
        matchedText = match[0];
        action = 'search_web';
        payload = { query: match[1].trim() };
      } else if (browseRegex.test(fullResponse)) {
        const match = fullResponse.match(browseRegex);
        matchedText = match[0];
        action = 'browse_url';
        payload = { url: match[1].trim() };
      }
      
      if (action) {
        if (interrupted) {
          return;
        }
        if (action === 'run_command') {
          writeToChat(chalk.green('• ') + chalk.yellow('RunCommand') + chalk.gray(`(${payload.command})`));
        } else if (action === 'read_file') {
          writeToChat(chalk.green('• ') + chalk.yellow('Read') + chalk.gray(`(${payload.path})`));
        } else if (action === 'write_file') {
          writeToChat(chalk.green('• ') + chalk.yellow('Write') + chalk.gray(`(${payload.path})`));
        } else if (action === 'search_web') {
          writeToChat(chalk.blue('ℹ Coding Agent is searching the web for: ') + chalk.cyan(`"${payload.query}"...`) + '\n' +
                      chalk.green('• ') + chalk.yellow('WebFetch') + chalk.gray(`(${payload.query})`));
        } else if (action === 'browse_url') {
          writeToChat(chalk.blue('ℹ Coding Agent is browsing: ') + chalk.cyan(`"${payload.url}"...`) + '\n' +
                      chalk.green('• ') + chalk.yellow('WebFetch') + chalk.gray(`(${payload.url})`));
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
            writeToChat(chalk.gray(`   (Agent executed command: ${payload.command})`));
          } else if (action === 'read_file') {
            writeToChat(chalk.gray(`   (Agent read file: ${payload.path})`));
          } else if (action === 'write_file') {
            writeToChat(chalk.gray(`   (Agent wrote file: ${payload.path})`));
          } else if (action === 'search_web') {
            writeToChat(chalk.gray(`   (Agent used WebFetch to search "${payload.query}")`));
          } else if (action === 'browse_url') {
            writeToChat(chalk.gray(`   (Agent used WebFetch to browse "${payload.url}")`));
          }
          
          if (!interrupted) {
            agentSession.addMessage('user', `[System: Capability output for ${matchedText}]:\n${output}`);
            await executeAgent();
          }
        } catch (e) {
          if (interrupted) {
            return;
          }
          writeToChat(chalk.red(`Terminal (Coding Agent) > Error: ${e.message}`));
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
      currentActiveModel = '';
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

You have access to the local workspace and can execute commands, read files, write files, search the web, and browse URLs using special XML tags:
- Run a shell command: <run_command>your command here</run_command>
- Read a file: <read_file>your file path here</read_file>
- Write a file: <write_file path="your file path here">your file content here</write_file>
- Search the web: <search_web>your query here</search_web>
- Browse a URL page: <browse_url>your URL here</browse_url>

CRITICAL RULES:
1. You must analyze the files for any syntax errors, compile errors, runtime errors, or logical bugs.
2. Read the files first, then run compilation/check/lint/run commands (e.g. compile or run them with node/python or tests) to verify they work.
3. DO NOT execute shell commands (like curl, wget, or node webfetch.js) to search the web or browse URLs. You MUST use the <search_web> and <browse_url> tags instead.
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

      currentActiveModel = debuggerModel;
      for await (const chunk of debuggerProvider.generateStream(fullDebuggerSystemPrompt, debuggerSession.getMessages(), debuggerModel, signal)) {
        if (interrupted) break;
        if (firstChunk) {
          if (stopAnimation) stopAnimation();
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
            } else if (candidateBuffer === '<search_web>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</search_web>';
              candidateBuffer = '';
            } else if (candidateBuffer === '<browse_url>') {
              state = 'SUPPRESSED';
              suppressClosingTag = '</browse_url>';
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
                '<search_web>', '</search_web>',
                '<browse_url>', '</browse_url>',
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
      const searchRegex = /<search_web>([\s\S]*?)<\/search_web>/;
      const browseRegex = /<browse_url>([\s\S]*?)<\/browse_url>/;
      
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
      } else if (searchRegex.test(fullResponse)) {
        const match = fullResponse.match(searchRegex);
        matchedText = match[0];
        action = 'search_web';
        payload = { query: match[1].trim() };
      } else if (browseRegex.test(fullResponse)) {
        const match = fullResponse.match(browseRegex);
        matchedText = match[0];
        action = 'browse_url';
        payload = { url: match[1].trim() };
      }
      
      if (action) {
        if (interrupted) {
          return;
        }
        if (action === 'run_command') {
          writeToChat(chalk.green('• ') + chalk.yellow('RunCommand') + chalk.gray(`(${payload.command})`));
        } else if (action === 'read_file') {
          writeToChat(chalk.green('• ') + chalk.yellow('Read') + chalk.gray(`(${payload.path})`));
        } else if (action === 'write_file') {
          writeToChat(chalk.green('• ') + chalk.yellow('Write') + chalk.gray(`(${payload.path})`));
        } else if (action === 'search_web') {
          writeToChat(chalk.blue('ℹ Debugger Agent is searching the web for: ') + chalk.cyan(`"${payload.query}"...`) + '\n' +
                      chalk.green('• ') + chalk.yellow('WebFetch') + chalk.gray(`(${payload.query})`));
        } else if (action === 'browse_url') {
          writeToChat(chalk.blue('ℹ Debugger Agent is browsing: ') + chalk.cyan(`"${payload.url}"...`) + '\n' +
                      chalk.green('• ') + chalk.yellow('WebFetch') + chalk.gray(`(${payload.url})`));
        }
        
        try {
          const output = await makeHarnessRequest(action, payload);
          if (interrupted) {
            return;
          }
          if (action === 'run_command') {
            writeToChat(chalk.gray(`   (Agent executed command: ${payload.command})`));
          } else if (action === 'read_file') {
            writeToChat(chalk.gray(`   (Agent read file: ${payload.path})`));
          } else if (action === 'write_file') {
            writeToChat(chalk.gray(`   (Agent wrote file: ${payload.path})`));
          } else if (action === 'search_web') {
            writeToChat(chalk.gray(`   (Agent used WebFetch to search "${payload.query}")`));
          } else if (action === 'browse_url') {
            writeToChat(chalk.gray(`   (Agent used WebFetch to browse "${payload.url}")`));
          }
          
          if (!interrupted) {
            debuggerSession.addMessage('user', `[System: Capability output for ${matchedText}]:\n${output}`);
            await executeDebugger();
          }
        } catch (e) {
          if (interrupted) {
            return;
          }
          writeToChat(chalk.red(`Terminal (Debugger Agent) > Error: ${e.message}`));
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
      currentActiveModel = '';
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
    const summaryEst = estimateTokens(`Conversation summary context: ${summary}`);
    lastTokenUsage = {
      promptTokens: summaryEst,
      completionTokens: 0,
      totalTokens: summaryEst
    };
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

// 1. File & Project Commands
async function handleNewCommand(args) {
  const filepath = args[0] || await askRawInput('Enter path for new file: ');
  if (!filepath) return;
  try {
    await makeHarnessRequest('write_file', { path: filepath, content: '' });
    currentFile = filepath;
    setTemporaryMessage(chalk.green(`File created and opened: `) + chalk.cyan(filepath));
  } catch (e) {
    console.log(chalk.red(`Error creating file: ${e.message}`));
  }
}

async function handleOpenCommand(args) {
  const filepath = args[0] || await askRawInput('Enter path of file to open: ');
  if (!filepath) return;
  try {
    const content = await makeHarnessRequest('read_file', { path: filepath });
    currentFile = filepath;
    console.log(chalk.green(`\nOpened active file: ${filepath}`));
    console.log(chalk.gray('-'.repeat(40)));
    console.log(content.substring(0, 1000) + (content.length > 1000 ? chalk.yellow('\n... [Content Truncated, use /editor or IDE to edit]') : ''));
    console.log(chalk.gray('-'.repeat(40)));
  } catch (e) {
    console.log(chalk.red(`Error opening file: ${e.message}`));
  }
}

async function handleSaveCommand() {
  if (!currentFile) {
    console.log(chalk.red('Error: No file is currently open. Create or open one using /new or /open.'));
    return;
  }
  console.log(chalk.yellow(`Opening editor to save changes to: ${currentFile}`));
  const text = await handleEditorCommand();
  if (text !== null) {
    try {
      await makeHarnessRequest('write_file', { path: currentFile, content: text });
      setTemporaryMessage(chalk.green(`File saved: `) + chalk.cyan(currentFile));
    } catch (e) {
      console.log(chalk.red(`Error saving file: ${e.message}`));
    }
  }
}

async function handleRenameCommand(args) {
  if (!currentFile) {
    console.log(chalk.red('Error: No file is currently open to rename.'));
    return;
  }
  const newPath = args[0] || await askRawInput(`Enter new path for ${currentFile}: `);
  if (!newPath) return;
  
  const isWindows = process.platform === 'win32';
  const cmd = isWindows
    ? `move "${currentFile}" "${newPath}"`
    : `mv "${currentFile}" "${newPath}"`;
  
  console.log(chalk.yellow(`Renaming file to ${newPath}...`));
  try {
    await makeHarnessRequest('run_command', { command: cmd });
    currentFile = newPath;
    setTemporaryMessage(chalk.green(`File renamed successfully to: `) + chalk.cyan(newPath));
  } catch (e) {
    console.log(chalk.red(`Error renaming file: ${e.message}`));
  }
}

async function handleDeleteCommand(args) {
  const filepath = args[0] || await askRawInput('Enter path of file to delete: ');
  if (!filepath) return;
  
  const confirm = await askRawInput(`Are you sure you want to delete ${filepath}? (y/N): `);
  if (confirm.toLowerCase() !== 'y') {
    console.log(chalk.yellow('Delete cancelled.'));
    return;
  }

  const isWindows = process.platform === 'win32';
  const cmd = isWindows
    ? `del /q /f "${filepath}"`
    : `rm -f "${filepath}"`;
    
  try {
    await makeHarnessRequest('run_command', { command: cmd });
    if (currentFile === filepath) {
      currentFile = null;
    }
    setTemporaryMessage(chalk.green(`Deleted file: `) + chalk.cyan(filepath));
  } catch (e) {
    console.log(chalk.red(`Error deleting file: ${e.message}`));
  }
}

function handleCloseCommand() {
  if (!currentFile) {
    console.log(chalk.yellow('No file is currently open.'));
    return;
  }
  const closed = currentFile;
  currentFile = null;
  setTemporaryMessage(chalk.green(`Closed active file: `) + chalk.cyan(closed));
}

// 2. Navigation Commands
async function handleGotoCommand(args) {
  const dest = args[0] || await askRawInput('Enter file or symbol to go to: ');
  if (!dest) return;
  try {
    const exists = fs.existsSync(dest);
    if (exists) {
      const content = await makeHarnessRequest('read_file', { path: dest });
      currentFile = dest;
      console.log(chalk.green(`\nJumped to file: ${dest}`));
      console.log(chalk.gray('-'.repeat(40)));
      console.log(content.substring(0, 1000) + (content.length > 1000 ? '\n...' : ''));
      console.log(chalk.gray('-'.repeat(40)));
    } else {
      console.log(chalk.yellow(`File not found. Searching project workspace for symbol: '${dest}'...`));
      const isWindows = process.platform === 'win32';
      const searchCmd = isWindows
        ? `findstr /s /n /i "${dest}" *.*`
        : `grep -rn "${dest}" .`;
      const output = await makeHarnessRequest('run_command', { command: searchCmd });
      console.log(chalk.green('\n--- Search Results ---'));
      console.log(output);
    }
  } catch (e) {
    console.log(chalk.red(`Error in /goto: ${e.message}`));
  }
}

async function handleSearchCommand(args) {
  const query = args.join(' ') || await askRawInput('Enter search query: ');
  if (!query) return;
  const isWindows = process.platform === 'win32';
  const searchCmd = isWindows
    ? `findstr /s /n /i "${query}" *.*`
    : `grep -rn "${query}" .`;
  console.log(chalk.yellow(`Searching project for '${query}'...`));
  try {
    const output = await makeHarnessRequest('run_command', { command: searchCmd });
    console.log(chalk.green('\n--- Search Results ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Search failed: ${e.message}`));
  }
}

function handleExplorerCommand() {
  console.log(chalk.magenta.bold('\n--- Workspace Explorer ---'));
  try {
    function listExplorer(dir = '.', depth = 0) {
      if (depth > 2) return;
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        if (file === 'node_modules' || file.startsWith('.')) return;
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);
        const indent = '  '.repeat(depth);
        if (stats.isDirectory()) {
          console.log(`${indent}${chalk.blue.bold('📁 ' + file)}`);
          listExplorer(fullPath, depth + 1);
        } else {
          console.log(`${indent}${chalk.white('📄 ' + file)}`);
        }
      });
    }
    listExplorer('.');
  } catch (e) {
    console.error(chalk.red(`Error exploring project: ${e.message}`));
  }
  console.log('');
}

// 3. Code Assistance Commands
async function handleBuildCommand() {
  console.log(chalk.yellow('Detecting build configuration...'));
  let cmd = '';
  if (fs.existsSync('package.json')) {
    cmd = 'npm run build';
  } else if (fs.existsSync('Cargo.toml')) {
    cmd = 'cargo build';
  } else if (fs.existsSync('Makefile')) {
    cmd = 'make';
  } else {
    console.log(chalk.red('No build configuration detected (package.json, Cargo.toml, or Makefile not found).'));
    return;
  }
  console.log(chalk.cyan(`Running build command: ${cmd}...`));
  try {
    const output = await makeHarnessRequest('run_command', { command: cmd });
    console.log(chalk.green('\n--- Build Output ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Build failed: ${e.message}`));
  }
}

async function handleFormatCommand() {
  if (!currentFile) {
    console.log(chalk.red('Error: No file is currently open. Select a file first using /open.'));
    return;
  }
  const ext = path.extname(currentFile);
  console.log(chalk.yellow(`Formatting ${currentFile}...`));
  let cmd = '';
  if (ext === '.js' || ext === '.ts' || ext === '.json' || ext === '.md') {
    cmd = `npx prettier --write "${currentFile}"`;
  } else if (ext === '.py') {
    cmd = `black "${currentFile}"`;
  } else {
    console.log(chalk.red(`No auto-formatter configured for extension ${ext}`));
    return;
  }
  try {
    const output = await makeHarnessRequest('run_command', { command: cmd });
    console.log(chalk.green('Format complete:'));
    console.log(chalk.gray(output));
  } catch (e) {
    console.log(chalk.red(`Formatting failed: ${e.message}`));
  }
}

async function handleFixCommand(provider, systemPrompt, session) {
  if (!currentFile) {
    console.log(chalk.red('Error: No file open to fix. Open a file first using /open.'));
    return;
  }
  const description = await askRawInput('What error or bug should be fixed in this file? ');
  if (!description) return;
  const task = `Fix the following in ${currentFile}: ${description}`;
  const model = config.getConfig().model;
  const debuggerModel = config.getConfig().debugger_model;
  console.log(chalk.magenta.bold(`🤖 Spawning Coding Agent to fix: "${task}"`));
  const output = await runCodingAgent(task, model, debuggerModel, provider, systemPrompt, session);
  console.log(output);
}

async function handleDebugCommand() {
  if (!currentFile) {
    console.log(chalk.red('Error: No file open to debug. Open a file first using /open.'));
    return;
  }
  const debuggerModel = config.getConfig().debugger_model;
  const providerName = config.getConfig().provider || 'gemini';
  const apiKey = config.getApiKey(providerName);
  console.log(chalk.yellow.bold(`🤖 Spawning Debugger Agent to verify ${currentFile}...`));
  const output = await runDebuggerAgent([currentFile], debuggerModel, providerName, apiKey, config.getConfig());
  console.log(output);
}

// 4. AI / Agent Commands
async function handleAskCommand(args, providerName, modelName, provider, systemPrompt, session) {
  const question = args.join(' ') || await askRawInput('Ask AI: ');
  if (!question) return;
  enterChatMode();
  let query = question;
  if (currentFile) {
    try {
      const fileContent = fs.readFileSync(currentFile, 'utf-8');
      query = `Regarding the file [${currentFile}], here is its content:\n\`\`\`\n${fileContent}\n\`\`\`\nUser question: ${question}`;
    } catch (e) {}
  }
  const { finalPrompt } = processUserPromptWithAttachments(query);
  session.addMessage('user', finalPrompt);
  printUserQueryWithLayout(question, modelName);
  interrupted = false;
  const cleanupInterrupt = setupInterruptListener();
  try {
    const providerInstance = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
    await handleResponseStream(providerInstance, systemPrompt, session.getMessages(), modelName, session);
  } finally {
    cleanupInterrupt();
  }
}

async function handleExplainCommand(providerName, modelName, provider, systemPrompt, session) {
  enterChatMode();
  let query = "Please explain the workspace project.";
  let displayQuery = "Explain workspace project";
  if (currentFile) {
    try {
      const fileContent = fs.readFileSync(currentFile, 'utf-8');
      query = `Please explain the code in the file [${currentFile}]:\n\`\`\`\n${fileContent}\n\`\`\``;
      displayQuery = `Explain file: ${currentFile}`;
    } catch (e) {}
  }
  session.addMessage('user', query);
  printUserQueryWithLayout(displayQuery, modelName);
  interrupted = false;
  const cleanupInterrupt = setupInterruptListener();
  try {
    const providerInstance = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
    await handleResponseStream(providerInstance, systemPrompt, session.getMessages(), modelName, session);
  } finally {
    cleanupInterrupt();
  }
}

async function handleGenerateCommand(args, provider, systemPrompt, session) {
  const instructions = args.join(' ') || await askRawInput('What code should be generated? ');
  if (!instructions) return;
  const task = `Generate code: ${instructions}`;
  const model = config.getConfig().model;
  const debuggerModel = config.getConfig().debugger_model;
  console.log(chalk.magenta.bold(`🤖 Spawning Coding Agent to generate code...`));
  const output = await runCodingAgent(task, model, debuggerModel, provider, systemPrompt, session);
  console.log(output);
}

async function handleTestCommand(args, provider, systemPrompt, session) {
  const target = args[0] || currentFile || await askRawInput('Enter file path to generate tests for: ');
  if (!target) return;
  const task = `Write comprehensive unit tests for the file: ${target}`;
  const model = config.getConfig().model;
  const debuggerModel = config.getConfig().debugger_model;
  console.log(chalk.magenta.bold(`🤖 Spawning Coding Agent to generate tests...`));
  const output = await runCodingAgent(task, model, debuggerModel, provider, systemPrompt, session);
  console.log(output);
}

async function handleDocCommand(args, provider, systemPrompt, session) {
  const target = args[0] || currentFile || await askRawInput('Enter file/project path to generate documentation: ');
  if (!target) return;
  const task = `Generate detailed documentation or API docstrings for: ${target}`;
  const model = config.getConfig().model;
  const debuggerModel = config.getConfig().debugger_model;
  console.log(chalk.magenta.bold(`🤖 Spawning Coding Agent to generate documentation...`));
  const output = await runCodingAgent(task, model, debuggerModel, provider, systemPrompt, session);
  console.log(output);
}

// 5. Version Control Commands
async function handleCloneCommand(args) {
  const url = args[0] || await askRawInput('Enter repository URL to clone: ');
  if (!url) return;
  console.log(chalk.yellow(`Cloning repository ${url}...`));
  try {
    const output = await makeHarnessRequest('run_command', { command: `git clone ${url}` });
    console.log(chalk.green('\n--- Git Output ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Git clone failed: ${e.message}`));
  }
}

async function handleCommitCommand(args) {
  const message = args.join(' ') || await askRawInput('Enter commit message: ');
  if (!message) return;
  console.log(chalk.yellow('Committing git changes...'));
  try {
    const output = await makeHarnessRequest('run_command', { command: `git commit -am "${message}"` });
    console.log(chalk.green('\n--- Git Output ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Git commit failed: ${e.message}`));
  }
}

async function handlePushCommand() {
  console.log(chalk.yellow('Pushing commits to remote repository...'));
  try {
    const output = await makeHarnessRequest('run_command', { command: 'git push' });
    console.log(chalk.green('\n--- Git Output ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Git push failed: ${e.message}`));
  }
}

async function handlePullCommand() {
  console.log(chalk.yellow('Pulling updates from remote repository...'));
  try {
    const output = await makeHarnessRequest('run_command', { command: 'git pull' });
    console.log(chalk.green('\n--- Git Output ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Git pull failed: ${e.message}`));
  }
}

async function handleBranchCommand(args) {
  const branchName = args[0];
  const command = branchName ? `git checkout ${branchName}` : 'git branch';
  console.log(chalk.yellow(branchName ? `Switching to branch ${branchName}...` : 'Listing git branches...'));
  try {
    const output = await makeHarnessRequest('run_command', { command });
    console.log(chalk.green('\n--- Git Output ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Git branch command failed: ${e.message}`));
  }
}

async function handleStatusCommand() {
  console.log(chalk.yellow('Checking Git status...'));
  try {
    const output = await makeHarnessRequest('run_command', { command: 'git status' });
    console.log(chalk.green('\n--- Git Status ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Git status failed: ${e.message}`));
  }
}

async function handleStashCommand() {
  console.log(chalk.yellow('Stashing current git changes...'));
  try {
    const output = await makeHarnessRequest('run_command', { command: 'git stash' });
    console.log(chalk.green('\n--- Git Output ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Git stash failed: ${e.message}`));
  }
}

// 6. Environment & Workspace Commands
function handleSettingsCommand() {
  const configValues = config.getConfig();
  console.log(chalk.magenta.bold('\n--- Configuration Settings ---'));
  Object.keys(configValues).forEach(k => {
    if (k === 'api_keys') {
      console.log(`${chalk.cyan(k)}: { ${Object.keys(configValues[k]).map(key => `${key}: ******`).join(', ')} }`);
    } else {
      console.log(`${chalk.cyan(k)}: ${configValues[k]}`);
    }
  });
  console.log('');
}

async function handleThemeCommand(args) {
  const options = ['classic', 'fire', 'forest', 'sunset', 'hacker'];
  let selectedTheme = '';
  if (args.length === 0) {
    selectedTheme = await askSelection(chalk.magenta.bold('Select Styling Theme:'), options, config.getConfig().theme || 'classic', '/theme');
  } else {
    selectedTheme = args[0].toLowerCase();
  }
  if (!selectedTheme) return;
  if (!options.includes(selectedTheme)) {
    console.log(chalk.red(`Error: Unknown theme '${selectedTheme}'. Available: ${options.join(', ')}`));
    return;
  }
  config.updateConfig('theme', selectedTheme);
  setTemporaryMessage(chalk.green('Styling theme updated to: ') + chalk.green.bold(selectedTheme.toUpperCase()));
}

function handleExtensionsCommand() {
  console.log(chalk.magenta.bold('\n--- Installed Extensions ---'));
  console.log(`${chalk.green('✓')} Git Integration (Core) - v1.0.0`);
  console.log(`${chalk.green('✓')} Workspace File Explorer - v1.2.1`);
  console.log(`${chalk.green('✓')} Prettier Code Formatter - v2.1.0`);
  console.log(`${chalk.green('✓')} Model Selector & Autocomplete - v0.9.5`);
  console.log(`${chalk.green('✓')} Multi-Agent Orchestrator - v1.5.0`);
  console.log(`${chalk.green('✓')} Debugger & Self-Healer Loop - v1.1.2`);
  console.log('');
}

function handleRestartCommand() {
  console.log(chalk.yellow('\nInitiating A.N.A.N.D restart...'));
  restoreTerminalSync();
  process.exit(42);
}

// 7. Utility & Misc Commands
async function handleSnippetCommand() {
  const snippets = {
    'express-server': `import express from 'express';\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(express.json());\n\napp.get('/', (req, res) => {\n  res.send('Hello from A.N.A.N.D server!');\n});\n\napp.listen(PORT, () => {\n  console.log(\`Server is running on port \${PORT}\`);\n});`,
    'python-flask': `from flask import Flask, jsonify\napp = Flask(__name__)\n\n@app.route("/")\ndef hello():\n    return jsonify({"message": "Hello from A.N.A.N.D Flask server!"})\n\nif __name__ == "__main__":\n    app.run(port=5000)`,
    'quicksort-js': `function quicksort(arr) {\n  if (arr.length <= 1) return arr;\n  const pivot = arr[arr.length - 1];\n  const left = [];\n  const right = [];\n  for (let i = 0; i < arr.length - 1; i++) {\n    if (arr[i] < pivot) left.push(arr[i]);\n    else right.push(arr[i]);\n  }\n  return [...quicksort(left), pivot, ...quicksort(right)];\n}`,
    'gitignore': `node_modules/\n.env\n*.log\nconfig.json\nexports/\n.DS_Store`,
    'readme-template': `# Project Name\n\nProject description goes here.\n\n## Installation\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Usage\n\`\`\`bash\nnpm start\n\`\`\``
  };

  const choice = await askSelection(chalk.magenta.bold('Select Snippet to insert:'), Object.keys(snippets), null, '/snippet');
  if (!choice) return;

  if (!currentFile) {
    console.log(chalk.red('Error: No active file open to insert snippet. Open or create a file first using /new or /open.'));
    return;
  }

  console.log(chalk.yellow(`Inserting snippet '${choice}' into ${currentFile}...`));
  try {
    await makeHarnessRequest('write_file', { path: currentFile, content: snippets[choice] });
    console.log(chalk.green('Snippet inserted successfully!'));
  } catch (e) {
    console.log(chalk.red(`Error inserting snippet: ${e.message}`));
  }
}

async function handleCmdCommand(args) {
  if (args.length === 0) {
    const cmd = await askRawInput('Enter custom command to run: ');
    if (!cmd) return;
    args = cmd.split(' ');
  }
  const commandToRun = args.join(' ');
  console.log(chalk.yellow(`Running custom command: ${commandToRun}...`));
  try {
    const output = await makeHarnessRequest('run_command', { command: commandToRun });
    console.log(chalk.green('\n--- Command Output ---'));
    console.log(output);
  } catch (e) {
    console.log(chalk.red(`Error executing command: ${e.message}`));
  }
}

function handleLogCommand() {
  console.log(chalk.magenta.bold('\n--- Recent Chatbot Logs ---'));
  try {
    if (fs.existsSync(debugLogPath)) {
      const logContent = fs.readFileSync(debugLogPath, 'utf-8');
      const lines = logContent.split('\n').filter(line => line.trim() !== '');
      const last20 = lines.slice(-20);
      last20.forEach(line => console.log(chalk.gray(line)));
    } else {
      console.log(chalk.yellow('No log file found.'));
    }
  } catch (e) {
    console.log(chalk.red(`Error reading logs: ${e.message}`));
  }
  console.log('');
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

  // Trigger background models fetch on provider change
  (async () => {
    try {
      const apiKey = config.getApiKey(providerName);
      if (apiKey || localProviders.includes(providerName)) {
        const provider = ProviderManager.getProvider(providerName, apiKey);
        await provider.listModels();
      }
    } catch (e) {
      // Ignore background fetch errors
    }
  })();
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
    if (firstMessageSent) {
      writeToChat(chalk.yellow('No history in this session.'));
    } else {
      console.log(chalk.yellow('No history in this session.'));
    }
    return;
  }

  let output = chalk.magenta.bold('\n--- Session History ---\n');
  messages.forEach(msg => {
    const role = msg.role.toUpperCase();
    const color = role === 'USER' ? chalk.cyan : role === 'ASSISTANT' ? chalk.green : chalk.magenta;
    output += color(`${role}:`) + ` ${msg.content}\n\n`;
  });

  if (firstMessageSent) {
    writeToChat(output);
  } else {
    console.log(output);
  }
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
  
  // Populate model context cache in the background on startup
  (async () => {
    try {
      const cfg = config.getConfig();
      const providerName = cfg.provider || 'gemini';
      const apiKey = config.getApiKey(providerName);
      const localProviders = ['ollama', 'lmstudio', 'localai', 'vllm', 'koboldcpp', 'llamacpp', 'textgenwebui', 'gpt4all', 'continue', 'tabby'];
      if (apiKey || localProviders.includes(providerName)) {
        const provider = ProviderManager.getProvider(providerName, apiKey);
        await provider.listModels();
      }
    } catch (e) {
      // Ignore background fetch errors
    }
  })();

  drawWelcomeScreen();
  const session = new ChatSession();
  mainSession = session;

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
        
        const { finalPrompt } = processUserPromptWithAttachments(`Please start the autonomous goal: "${activeGoal}"`);
        session.addMessage('user', finalPrompt);
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
        
        const { finalPrompt } = processUserPromptWithAttachments(`Please start the autonomous loop task: "${activeLoop}"`);
        session.addMessage('user', finalPrompt);
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
        chatViewportLines = [];
        chatScrollOffset = 0;
        lastRenderedPanelRows = {};
        cachedWorkspaceFiles = null;
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
          
          const { finalPrompt } = processUserPromptWithAttachments(text);
          session.addMessage('user', finalPrompt);
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
        let commandToRun = args.join(' ');
        if (!commandToRun) {
          if (currentFile) {
            const ext = path.extname(currentFile);
            if (ext === '.js') {
              commandToRun = `node "${currentFile}"`;
            } else if (ext === '.py') {
              commandToRun = `python "${currentFile}"`;
            } else {
              console.log(chalk.red(`Cannot auto-run file with extension ${ext}. Please specify execution command.`));
              continue;
            }
          } else {
            commandToRun = await askRawInput('Enter command to run: ');
          }
        }
        if (!commandToRun) continue;
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

      // 1. File & Project Commands
      if (cmd === '/new') {
        await handleNewCommand(args);
        continue;
      }
      if (cmd === '/open') {
        await handleOpenCommand(args);
        continue;
      }
      if (cmd === '/save') {
        await handleSaveCommand();
        continue;
      }
      if (cmd === '/rename') {
        await handleRenameCommand(args);
        continue;
      }
      if (cmd === '/delete') {
        await handleDeleteCommand(args);
        continue;
      }
      if (cmd === '/close') {
        handleCloseCommand();
        continue;
      }

      // 2. Navigation Commands
      if (cmd === '/goto') {
        await handleGotoCommand(args);
        continue;
      }
      if (cmd === '/search') {
        await handleSearchCommand(args);
        continue;
      }
      if (cmd === '/explorer') {
        handleExplorerCommand();
        continue;
      }

      // 3. Code Assistance Commands
      if (cmd === '/build') {
        await handleBuildCommand();
        continue;
      }
      if (cmd === '/format') {
        await handleFormatCommand();
        continue;
      }
      if (cmd === '/fix') {
        const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
        await handleFixCommand(provider, systemPrompt, session);
        continue;
      }
      if (cmd === '/debug') {
        await handleDebugCommand();
        continue;
      }

      // 4. AI / Agent Commands
      if (cmd === '/ask') {
        const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
        await handleAskCommand(args, providerName, modelName, provider, systemPrompt, session);
        continue;
      }
      if (cmd === '/explain') {
        const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
        await handleExplainCommand(providerName, modelName, provider, systemPrompt, session);
        continue;
      }
      if (cmd === '/generate') {
        const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
        await handleGenerateCommand(args, provider, systemPrompt, session);
        continue;
      }
      if (cmd === '/test') {
        const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
        await handleTestCommand(args, provider, systemPrompt, session);
        continue;
      }
      if (cmd === '/doc') {
        const provider = ProviderManager.getProvider(providerName, config.getApiKey(providerName));
        await handleDocCommand(args, provider, systemPrompt, session);
        continue;
      }

      // 5. Version Control Commands
      if (cmd === '/clone') {
        await handleCloneCommand(args);
        continue;
      }
      if (cmd === '/commit') {
        await handleCommitCommand(args);
        continue;
      }
      if (cmd === '/push') {
        await handlePushCommand();
        continue;
      }
      if (cmd === '/pull') {
        await handlePullCommand();
        continue;
      }
      if (cmd === '/branch') {
        await handleBranchCommand(args);
        continue;
      }
      if (cmd === '/status') {
        await handleStatusCommand();
        continue;
      }
      if (cmd === '/stash') {
        await handleStashCommand();
        continue;
      }

      // 6. Environment & Workspace Commands
      if (cmd === '/settings') {
        handleSettingsCommand();
        continue;
      }
      if (cmd === '/theme') {
        await handleThemeCommand(args);
        continue;
      }
      if (cmd === '/extensions') {
        handleExtensionsCommand();
        continue;
      }
      if (cmd === '/restart') {
        handleRestartCommand();
        continue;
      }

      // 7. Utility & Misc Commands
      if (cmd === '/snippet') {
        await handleSnippetCommand();
        continue;
      }
      if (cmd === '/cmd') {
        await handleCmdCommand(args);
        continue;
      }
      if (cmd === '/log') {
        handleLogCommand();
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
      
      if (cmd === '/search-web') {
        if (args.length === 0) {
          console.log(chalk.red('Error: Search query required. Usage: /search-web <query>'));
          continue;
        }
        const query = args.join(' ');
        console.log(chalk.yellow(`Searching the web for: "${query}"...`));
        try {
          const output = await makeHarnessRequest('search_web', { query });
          console.log(chalk.green('\n--- Search Results ---'));
          console.log(output);
        } catch (e) {
          console.log(chalk.red(`\nError: ${e.message}`));
        }
        continue;
      }
      
      if (cmd === '/browse-url') {
        if (args.length === 0) {
          console.log(chalk.red('Error: URL required. Usage: /browse-url <url>'));
          continue;
        }
        const url = args[0];
        console.log(chalk.yellow(`Browsing URL: ${url}...`));
        try {
          const output = await makeHarnessRequest('browse_url', { url });
          console.log(chalk.green('\n--- Page Content ---'));
          console.log(output);
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

    const { finalPrompt } = processUserPromptWithAttachments(userInput);
    session.addMessage('user', finalPrompt);
    lastTokenUsage.promptTokens = (lastTokenUsage.promptTokens || 0) + estimateTokens(finalPrompt);
    lastTokenUsage.totalTokens = lastTokenUsage.promptTokens + lastTokenUsage.completionTokens;
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
