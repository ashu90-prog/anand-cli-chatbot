import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.cli-chatbot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  system_prompt: 'You are a helpful assistant.',
  api_keys: {}
};

function ensureConfig() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  }
}

export function getConfig() {
  ensureConfig();
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return DEFAULT_CONFIG;
  }
}

export function updateConfig(key, value) {
  ensureConfig();
  const config = getConfig();
  config[key] = value;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving config:', e);
  }
}

export function getApiKey(provider) {
  const envVarName = `${provider.toUpperCase()}_API_KEY`;
  const envKey = process.env[envVarName];
  if (envKey) return envKey;

  const config = getConfig();
  return config.api_keys?.[provider] || '';
}

export function saveApiKey(provider, apiKey) {
  ensureConfig();
  const config = getConfig();
  if (!config.api_keys) config.api_keys = {};
  config.api_keys[provider] = apiKey;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving API key:', e);
  }
}
