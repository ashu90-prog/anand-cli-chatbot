#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Helper: Decode HTML entities
export function decodeHtmlEntities(str) {
  let text = str;
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–'
  };
  for (const [entity, replacement] of Object.entries(entities)) {
    text = text.replaceAll(entity, replacement);
  }
  text = text.replace(/&#(x[0-9a-fA-F]+|[0-9]+);/g, (match, code) => {
    if (code.startsWith('x')) {
      return String.fromCharCode(parseInt(code.slice(1), 16));
    } else {
      return String.fromCharCode(parseInt(code, 10));
    }
  });
  return text;
}

// Reusable fast fetch with size limit and timeout
export async function fetchWithLimit(url, maxBytes = 250000, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      }
    });
    
    clearTimeout(id);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch page (Status: ${response.status} ${response.statusText})`);
    }
    
    const text = await response.text();
    if (text.length > maxBytes) {
      return text.substring(0, maxBytes);
    }
    return text;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Search web using DuckDuckGo HTML scraping with size limit and timeout
export async function searchWeb(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchWithLimit(url, 150000, 6000);
    
    const results = [];
    const resultRegex = /<a\s+[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a\s+[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      let link = match[1];
      if (link.includes('uddg=')) {
        const parts = link.split('uddg=');
        if (parts[1]) {
          link = decodeURIComponent(parts[1].split('&')[0]);
        }
      }
      const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '').trim());
      const snippet = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, '').trim());
      results.push({ title, link, snippet });
    }

    if (results.length === 0) {
      return `No results found for query: "${query}"`;
    }

    return results.map((r, i) => `${i + 1}. [${r.title}](${r.link})\n   ${r.snippet}`).join('\n\n');
  } catch (err) {
    return `Error performing web search: ${err.message}`;
  }
}

// Browse web page and parse to clean Markdown
export async function browseWeb(url) {
  try {
    const html = await fetchWithLimit(url, 250000, 8000);

    let text = html;
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    // Remove scripts, stylesheets, sidebars, headers, footers, etc.
    const tagsToRemove = ['script', 'style', 'head', 'svg', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript', 'form', 'button'];
    for (const tag of tagsToRemove) {
      const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
      text = text.replace(regex, '');
    }

    // Replace header tags with Markdown equivalents
    text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
    text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
    text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
    text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

    // Parse anchors: <a href="url">text</a> -> [text](url)
    text = text.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (match, href, content) => {
      const cleanContent = content.replace(/<[^>]+>/g, '').trim();
      if (!cleanContent) return '';
      let absoluteHref = href;
      try {
        absoluteHref = new URL(href, url).href;
      } catch (e) {}
      return ` [${cleanContent}](${absoluteHref}) `;
    });

    // Parse list items
    text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n* $1');

    // Strip out all remaining HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode all remaining HTML entities
    text = decodeHtmlEntities(text);

    // Normalize spacing and newlines
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n\s*\n+/g, '\n\n');
    text = text.trim();

    const maxChars = 12000;
    if (text.length > maxChars) {
      text = text.substring(0, maxChars) + `\n\n... [Content Truncated, total length: ${html.length} characters]`;
    }

    return text;
  } catch (err) {
    return `Error browsing page: ${err.message}`;
  }
}

// CLI Execution Logic
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`
🌐 webfetch.js - A.N.A.N.D Standalone Web Search & Browse Engine

Usage:
  node webfetch.js -s <query>      Perform search query on DuckDuckGo
  node webfetch.js -u <url>        Fetch webpage content and format as Markdown
  node webfetch.js search <q>      Search alias
  node webfetch.js browse <url>    Browse alias

Options:
  -h, --help                       Show this help menu
    `);
    process.exit(0);
  }

  const mode = args[0];
  const param = args.slice(1).join(' ');

  if (mode === '-s' || mode === 'search') {
    if (!param) {
      console.error('Error: Please provide a search query.');
      process.exit(1);
    }
    console.log(await searchWeb(param));
  } else if (mode === '-u' || mode === 'browse') {
    if (!param) {
      console.error('Error: Please provide a target URL.');
      process.exit(1);
    }
    console.log(await browseWeb(param));
  } else {
    console.error(`Unknown argument: "${mode}". Run with --help for instructions.`);
    process.exit(1);
  }
}

// Only execute CLI loop if run directly
import { fileURLToPath } from 'url';
try {
  const nodePath = fs.realpathSync(process.argv[1]);
  const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
  if (nodePath === modulePath) {
    main();
  }
} catch (e) {
  // If run via bundle or other means, do nothing
}
