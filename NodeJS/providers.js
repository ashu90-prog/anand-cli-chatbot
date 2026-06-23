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
      default:
        throw new Error(`Unknown provider: ${name}. Supported: gemini, openai, anthropic, nvidia, ollama.`);
    }
  }
}
