export class BaseProvider {
  listModels() {
    throw new Error('Not implemented');
  }
  async *generateStream(systemPrompt, messages, model) {
    throw new Error('Not implemented');
  }
}

export class GeminiProvider extends BaseProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
  }

  async listModels() {
    if (!this.apiKey) {
      return ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    }
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.models) {
          return data.models
            .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
            .map(m => m.name.replace('models/', ''));
        }
      }
    } catch (e) {
      // Fallback below
    }
    return ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  }

  async *generateStream(systemPrompt, messages, model) {
    if (!this.apiKey) {
      throw new Error('Google Gemini API Key is not configured. Set GEMINI_API_KEY env var.');
    }

    const modelName = model.replace('models/', '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?key=${this.apiKey}`;
    
    const contents = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const payload = { contents };
    if (systemPrompt) {
      payload.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const textMarker = '"text": "';
        const idx = buffer.indexOf(textMarker);
        if (idx === -1) break;

        const startPos = idx + textMarker.length;
        let endPos = startPos;
        while (endPos < buffer.length) {
          if (buffer[endPos] === '"' && buffer[endPos - 1] !== '\\') {
            break;
          }
          endPos++;
        }

        if (endPos >= buffer.length) break; // String not fully loaded

        const escapedText = buffer.substring(startPos, endPos);
        let text = escapedText;
        try {
          text = JSON.parse(`"${escapedText}"`);
        } catch (e) {
          text = escapedText
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
        }
        
        yield text;
        buffer = buffer.substring(endPos + 1);
      }
    }
  }
}

export class OpenAIProvider extends BaseProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
  }

  async listModels() {
    if (!this.apiKey) {
      return ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'gpt-4-turbo'];
    }
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.data) {
          return data.data
            .map(m => m.id)
            .filter(id => id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.startsWith('chatgpt'))
            .sort();
        }
      }
    } catch (e) {
      // Fallback
    }
    return ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'gpt-4-turbo'];
  }

  async *generateStream(systemPrompt, messages, model) {
    if (!this.apiKey) {
      throw new Error('OpenAI API Key is not configured. Set OPENAI_API_KEY env var.');
    }

    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    formattedMessages.push(...messages);

    const payload = {
      model,
      messages: formattedMessages,
      stream: true
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataContent = line.slice(6).trim();
          if (dataContent === '[DONE]') break;
          try {
            const data = JSON.parse(dataContent);
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) yield content;
          } catch (e) {
            // Ignore parse errors on partial streams
          }
        }
      }
    }
  }
}

export class AnthropicProvider extends BaseProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
  }

  async listModels() {
    if (!this.apiKey) {
      return ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'];
    }
    try {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.data) {
          return data.data.map(m => m.id);
        }
      }
    } catch (e) {
      // Fallback
    }
    return ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'];
  }

  async *generateStream(systemPrompt, messages, model) {
    if (!this.apiKey) {
      throw new Error('Anthropic API Key is not configured. Set ANTHROPIC_API_KEY env var.');
    }

    const payload = {
      model,
      messages,
      stream: true,
      max_tokens: 4096
    };
    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataContent = line.slice(6).trim();
          try {
            const data = JSON.parse(dataContent);
            if (data.type === 'content_block_delta') {
              const text = data.delta?.text || '';
              if (text) yield text;
            }
          } catch (e) {
            // Ignore partial errors
          }
        }
      }
    }
  }
}

export class OllamaProvider extends BaseProvider {
  constructor() {
    super();
    this.baseUrl = 'http://localhost:11434';
  }

  async listModels() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        return data.models?.map(m => m.name) || ['llama3', 'mistral', 'phi3'];
      }
      return ['llama3', 'mistral', 'phi3'];
    } catch (e) {
      return ['llama3', 'mistral', 'phi3'];
    }
  }

  async *generateStream(systemPrompt, messages, model) {
    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    formattedMessages.push(...messages);

    const payload = {
      model,
      messages: formattedMessages,
      stream: true
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama error (${response.status}): ${errText}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            const content = data.message?.content || '';
            if (content) yield content;
          } catch (e) {
            // Ignore partial errors
          }
        }
      }
    }
  }
}

export class NvidiaProvider extends BaseProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
  }

  async listModels() {
    if (!this.apiKey) {
      return [
        'meta/llama-3.1-405b-instruct',
        'meta/llama-3.1-70b-instruct',
        'meta/llama-3.1-8b-instruct',
        'nvidia/llama-3.1-nemotron-70b-instruct',
        'mistralai/mixtral-8x22b-instruct-v0.1'
      ];
    }
    try {
      const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.data) {
          return data.data
            .map(m => m.id)
            .sort();
        }
      }
    } catch (e) {
      // Fallback
    }
    return [
      'meta/llama-3.1-405b-instruct',
      'meta/llama-3.1-70b-instruct',
      'meta/llama-3.1-8b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'mistralai/mixtral-8x22b-instruct-v0.1'
    ];
  }

  async *generateStream(systemPrompt, messages, model) {
    if (!this.apiKey) {
      throw new Error('NVIDIA API Key is not configured. Set NVIDIA_API_KEY env var.');
    }

    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    formattedMessages.push(...messages);

    const payload = {
      model,
      messages: formattedMessages,
      stream: true
    };

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA API error (${response.status}): ${errText}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataContent = line.slice(6).trim();
          if (dataContent === '[DONE]') break;
          try {
            const data = JSON.parse(dataContent);
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) yield content;
          } catch (e) {
            // Ignore partial errors
          }
        }
      }
    }
  }
}

export class OpenAICompatibleProvider extends BaseProvider {
  constructor(apiKey, baseUrl, defaultModels) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.defaultModels = defaultModels;
  }

  async listModels() {
    const isLocal = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1') || this.baseUrl.includes('::1');
    if (!this.apiKey && !isLocal) {
      return this.defaultModels;
    }
    try {
      const headers = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      const response = await fetch(`${this.baseUrl}/models`, { headers });
      if (response.ok) {
        const data = await response.json();
        if (data.data) {
          return data.data
            .map(m => m.id)
            .sort();
        }
      }
    } catch (e) {
      // Fallback below
    }
    return this.defaultModels;
  }

  async *generateStream(systemPrompt, messages, model) {
    const isLocal = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1') || this.baseUrl.includes('::1');
    if (!this.apiKey && !isLocal) {
      throw new Error(`API Key is not configured for this provider. Configure it via /provider command.`);
    }

    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    formattedMessages.push(...messages);

    const payload = {
      model,
      messages: formattedMessages,
      stream: true
    };

    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error (${response.status}): ${errText}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        const cleaned = line.trim();
        if (cleaned.startsWith('data: ')) {
          const dataContent = cleaned.slice(6).trim();
          if (dataContent === '[DONE]') break;
          try {
            const data = JSON.parse(dataContent);
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) yield content;
          } catch (e) {
            // Ignore partial errors
          }
        }
      }
    }
  }
}

export const PROVIDERS_CONFIG = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: ['google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet']
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModels: ['llama-3.3-70b-specdec', 'llama-3.3-70b-versatile', 'llama3-70b-8192', 'gemma2-9b-it']
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    defaultModels: ['deepseek-chat', 'deepseek-coder']
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    defaultModels: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x22B-Instruct-v0.1', 'Qwen/Qwen2.5-72B-Instruct']
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModels: ['mistral-tiny', 'mistral-small', 'mistral-medium', 'mistral-large-latest']
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    defaultModels: ['grok-2-1212', 'grok-2-vision-1212', 'grok-beta']
  },
  perplexity: {
    baseUrl: 'https://api.perplexity.ai',
    defaultModels: ['sonar-reasoning', 'sonar']
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModels: ['llama3.1-8b', 'llama3.1-70b']
  },
  sambanova: {
    baseUrl: 'https://api.sambanova.ai/v1',
    defaultModels: ['Meta-Llama-3.1-8B-Instruct', 'Meta-Llama-3.1-70B-Instruct', 'Meta-Llama-3.1-405B-Instruct']
  },
  deepinfra: {
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    defaultModels: ['meta-llama/Meta-Llama-3-70B-Instruct', 'mistralai/Mixtral-8x22B-Instruct-v0.1']
  },
  fireworks: {
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModels: ['accounts/fireworks/models/llama-v3-70b-instruct', 'accounts/fireworks/models/mixtral-8x22b-instruct']
  },
  novita: {
    baseUrl: 'https://api.novita.ai/v1/openai',
    defaultModels: ['meta-llama/llama-3-70b-instruct', 'mistralai/mystral-7b-instruct']
  },
  lepton: {
    baseUrl: 'https://api.lepton.ai/v1',
    defaultModels: ['llama3-70b', 'mixtral-8x22b']
  },
  hyperbolic: {
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    defaultModels: ['meta-llama/Meta-Llama-3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct']
  },
  nebius: {
    baseUrl: 'https://api.studio.nebius.ai/v1',
    defaultModels: ['meta-llama/Meta-Llama-3.1-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct']
  },
  friendli: {
    baseUrl: 'https://api.friendli.ai/v1',
    defaultModels: ['meta-llama-3-70b-instruct']
  },
  runpod: {
    baseUrl: 'https://api.runpod.ai/v1',
    defaultModels: ['llama3-70b-instruct']
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    defaultModels: ['local-model']
  },
  localai: {
    baseUrl: 'http://localhost:8080/v1',
    defaultModels: ['local-model']
  },
  vllm: {
    baseUrl: 'http://localhost:8000/v1',
    defaultModels: ['local-model']
  },
  koboldcpp: {
    baseUrl: 'http://localhost:5001/v1',
    defaultModels: ['local-model']
  },
  opencodezen: {
    baseUrl: 'https://api.opencodezen.com/v1',
    defaultModels: ['opencodezen-chat', 'opencodezen-coder']
  },
  llamaapi: {
    baseUrl: 'https://api.llama-api.com',
    defaultModels: ['llama3-70b']
  },
  anyscale: {
    baseUrl: 'https://api.endpoints.anyscale.com/v1',
    defaultModels: ['meta-llama/Meta-Llama-3-70B-Instruct']
  },
  monsterapi: {
    baseUrl: 'https://api.monsterapi.ai/v1',
    defaultModels: ['meta-llama/Meta-Llama-3-70B-Instruct']
  },
  openpipe: {
    baseUrl: 'https://api.openpipe.ai/v1',
    defaultModels: ['openpipe-model']
  },
  huggingface: {
    baseUrl: 'https://api-inference.huggingface.co/v1',
    defaultModels: ['meta-llama/Meta-Llama-3-70B-Instruct']
  },
  lambdalabs: {
    baseUrl: 'https://api.lambdalabs.com/v1',
    defaultModels: ['llama3-70b-instruct']
  },
  octoai: {
    baseUrl: 'https://text.octoai.run/v1',
    defaultModels: ['meta-llama-3-70b-instruct']
  },
  ai21: {
    baseUrl: 'https://api.ai21.com/studio/v1',
    defaultModels: ['jamba-instruct']
  },
  scale: {
    baseUrl: 'https://api.scale.com/v1',
    defaultModels: ['llama3-70b-instruct']
  },
  gooseai: {
    baseUrl: 'https://api.goose.ai/v1',
    defaultModels: ['gpt-neo-20b']
  },
  alibaba: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModels: ['qwen-max', 'qwen-plus', 'qwen-turbo']
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModels: ['glm-4', 'glm-4-air', 'glm-4-flash']
  },
  moonshot: {
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModels: ['moonshot-v1-8k', 'moonshot-v1-32k']
  },
  minimax: {
    baseUrl: 'https://api.minimax.chat/v1',
    defaultModels: ['abab6.5-chat', 'abab6-chat']
  },
  yi: {
    baseUrl: 'https://api.01.ai/v1',
    defaultModels: ['yi-large', 'yi-medium']
  },
  baichuan: {
    baseUrl: 'https://api.baichuan-ai.com/v1',
    defaultModels: ['Baichuan3-Turbo', 'Baichuan2-Turbo']
  },
  doubao: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModels: ['doubao-pro-4k', 'doubao-lite-4k']
  },
  stepfun: {
    baseUrl: 'https://api.stepfun.com/v1',
    defaultModels: ['step-1-8k', 'step-1-32k']
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModels: ['deepseek-ai/DeepSeek-V2.5', 'THUDM/glm-4-9b-chat']
  },
  textsynth: {
    baseUrl: 'https://textsynth.com/api/v1',
    defaultModels: ['llama3-8b']
  },
  api2d: {
    baseUrl: 'https://api.api2d.com/v1',
    defaultModels: ['gpt-4o-mini']
  },
  linkai: {
    baseUrl: 'https://api.link-ai.chat/v1',
    defaultModels: ['gpt-4o-mini']
  },
  oneapi: {
    baseUrl: 'https://api.oneapi.com/v1',
    defaultModels: ['gpt-4o-mini']
  },
  newapi: {
    baseUrl: 'https://api.newapi.com/v1',
    defaultModels: ['gpt-4o-mini']
  },
  opencode: {
    baseUrl: 'https://api.opencode.com/v1',
    defaultModels: ['opencode-chat']
  },
  openchat: {
    baseUrl: 'https://api.openchat.com/v1',
    defaultModels: ['openchat-model']
  },
  cloudl: {
    baseUrl: 'https://api.cloudl.com/v1',
    defaultModels: ['cloudl-chat']
  },
  deepgpt: {
    baseUrl: 'https://api.deepgpt.com/v1',
    defaultModels: ['gpt-4o-mini']
  },
  llamacloud: {
    baseUrl: 'https://api.llamacloud.com/v1',
    defaultModels: ['llama3-70b']
  },
  aimlapi: {
    baseUrl: 'https://api.aimlapi.com/v1',
    defaultModels: ['meta-llama/Llama-3-70b-chat-hf', 'gpt-4o-mini', 'claude-3-5-sonnet']
  },
  glider: {
    baseUrl: 'https://api.glider.ai/v1',
    defaultModels: ['glider-model']
  },
  openlayer: {
    baseUrl: 'https://api.openlayer.com/v1',
    defaultModels: ['openlayer-model']
  },
  databricks: {
    baseUrl: 'https://api.databricks.com/v1',
    defaultModels: ['databricks-meta-llama-3-1-70b']
  },
  workersai: {
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/default/ai/v1',
    defaultModels: ['llama-3']
  },
  portkey: {
    baseUrl: 'https://api.portkey.ai/v1',
    defaultModels: ['portkey-model']
  },
  llamacpp: {
    baseUrl: 'http://localhost:8080/v1',
    defaultModels: ['local-model']
  },
  textgenwebui: {
    baseUrl: 'http://localhost:5000/v1',
    defaultModels: ['local-model']
  },
  gpt4all: {
    baseUrl: 'http://localhost:4891/v1',
    defaultModels: ['local-model']
  },
  mlflow: {
    baseUrl: 'http://localhost:5000/api/2.0/mlflow/gateway',
    defaultModels: ['gateway-model']
  },
  langchainlocal: {
    baseUrl: 'http://localhost:8000/v1',
    defaultModels: ['local-model']
  },
  ollamaremote: {
    baseUrl: 'http://remote-ollama-host:11434/v1',
    defaultModels: ['llama3']
  },
  runpodserverless: {
    baseUrl: 'https://api.runpod.ai/v1/serverless',
    defaultModels: ['llama3-70b']
  },
  awsbedrockcompatible: {
    baseUrl: 'http://localhost:8000/v1',
    defaultModels: ['meta.llama3-70b-instruct-v1:0']
  },
  azureopenaicompatible: {
    baseUrl: 'http://localhost:8080/v1',
    defaultModels: ['gpt-4o']
  },
  custom: {
    baseUrl: 'http://localhost:8080/v1',
    defaultModels: ['custom-model']
  },
  openrouterfree: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: ['meta-llama/llama-3-8b-instruct:free', 'mistralai/mistral-7b-instruct:free']
  },
  openrouterbeta: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: ['openrouter/auto']
  },
  router: {
    baseUrl: 'https://api.router.ai/v1',
    defaultModels: ['router-model']
  },
  feather: {
    baseUrl: 'https://api.feather.ai/v1',
    defaultModels: ['feather-model']
  },
  sensenova: {
    baseUrl: 'https://api.sensetime.com/v1',
    defaultModels: ['sensenova-model']
  },
  hunyuan: {
    baseUrl: 'https://api.hunyuan.tencent.com/v1',
    defaultModels: ['hunyuan-model']
  },
  spark: {
    baseUrl: 'https://api.xfyun.cn/v1',
    defaultModels: ['spark-model']
  },
  baiduqianfan: {
    baseUrl: 'https://api.baidu.com/v1',
    defaultModels: ['ernie-bot']
  },
  copilot: {
    baseUrl: 'https://api.github.com',
    defaultModels: ['copilot-chat']
  },
  tabby: {
    baseUrl: 'http://localhost:8080/v1',
    defaultModels: ['tabby-model']
  },
  continue: {
    baseUrl: 'http://localhost:5092/v1',
    defaultModels: ['local-model']
  },
  cursor: {
    baseUrl: 'https://api.cursor.sh/v1',
    defaultModels: ['cursor-model']
  },
  ghostcoder: {
    baseUrl: 'http://localhost:8000/v1',
    defaultModels: ['ghostcoder-model']
  },
  codegpt: {
    baseUrl: 'https://api.codegpt.co/v1',
    defaultModels: ['codegpt-model']
  },
  codeium: {
    baseUrl: 'https://api.codeium.com/v1',
    defaultModels: ['codeium-model']
  },
  supermaven: {
    baseUrl: 'https://api.supermaven.com/v1',
    defaultModels: ['supermaven-model']
  },
  sourcegraphcody: {
    baseUrl: 'https://api.sourcegraph.com/v1',
    defaultModels: ['cody-model']
  },
  blackbox: {
    baseUrl: 'https://api.blackbox.ai/v1',
    defaultModels: ['blackbox-model']
  },
  phind: {
    baseUrl: 'https://api.phind.com/v1',
    defaultModels: ['phind-model']
  },
  you: {
    baseUrl: 'https://api.you.com/v1',
    defaultModels: ['you-model']
  },
  duckduckgo: {
    baseUrl: 'https://api.duckduckgo.com/v1',
    defaultModels: ['ddg-model']
  },
  brave: {
    baseUrl: 'https://api.brave.com/v1',
    defaultModels: ['brave-model']
  },
  kling: {
    baseUrl: 'https://api.kling.ai/v1',
    defaultModels: ['kling-model']
  },
  luma: {
    baseUrl: 'https://api.luma.ai/v1',
    defaultModels: ['luma-model']
  },
  runway: {
    baseUrl: 'https://api.runwayml.com/v1',
    defaultModels: ['runway-model']
  },
  sora: {
    baseUrl: 'https://api.sora.com/v1',
    defaultModels: ['sora-model']
  },
  midjourneycompatible: {
    baseUrl: 'https://api.midjourney.com/v1',
    defaultModels: ['mj-model']
  },
  stablediffusioncompatible: {
    baseUrl: 'https://api.stability.ai/v1',
    defaultModels: ['sd-model']
  },
  elevenlabscompatible: {
    baseUrl: 'https://api.elevenlabs.io/v1',
    defaultModels: ['elevenlabs-model']
  },
  voci: {
    baseUrl: 'https://api.voci.ai/v1',
    defaultModels: ['voci-model']
  },
  assemblyai: {
    baseUrl: 'https://api.assemblyai.com/v1',
    defaultModels: ['assemblyai-model']
  },
  deepgram: {
    baseUrl: 'https://api.deepgram.com/v1',
    defaultModels: ['deepgram-model']
  },
  whispercompatible: {
    baseUrl: 'https://api.whisper.com/v1',
    defaultModels: ['whisper-model']
  },
  glhf: {
    baseUrl: 'https://api.glhf.chat/v1',
    defaultModels: ['hf:meta-llama/Llama-3-8B-Instruct']
  },
  hyperbolicfree: {
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    defaultModels: ['meta-llama/Llama-3-8B-Instruct']
  },
  openrouterfreetier: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: ['meta-llama/llama-3-8b-instruct:free']
  },
  cohere: {
    baseUrl: 'https://api.cohere.com/v1',
    defaultModels: ['command-r-plus', 'command-r']
  },
  writer: {
    baseUrl: 'https://api.writer.com/v1',
    defaultModels: ['palmyra-x']
  },
  groqfree: {
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModels: ['llama3-8b-8192']
  }
};

export class ProviderManager {
  static getProvider(name, apiKey = '') {
    const providerName = name.toLowerCase();
    
    switch (providerName) {
      case 'gemini':
        return new GeminiProvider(apiKey);
      case 'openai':
        return new OpenAIProvider(apiKey);
      case 'anthropic':
        return new AnthropicProvider(apiKey);
      case 'nvidia':
        return new NvidiaProvider(apiKey);
      case 'ollama':
        return new OllamaProvider();
    }

    const customConfig = PROVIDERS_CONFIG[providerName];
    if (customConfig) {
      return new OpenAICompatibleProvider(apiKey, customConfig.baseUrl, customConfig.defaultModels);
    }

    throw new Error(`Unknown provider: ${name}. Supported: gemini, openai, anthropic, nvidia, ollama, and 100+ custom OpenAI-compatible providers (like openrouter, groq, etc.).`);
  }
}

