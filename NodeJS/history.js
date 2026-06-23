import fs from 'fs';
import path from 'path';

export class ChatSession {
  constructor() {
    this.messages = [];
  }

  addMessage(role, content) {
    this.messages.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });
  }

  getMessages() {
    return this.messages.map(m => ({ role: m.role, content: m.content }));
  }

  clear() {
    this.messages = [];
  }

  exportToMarkdown(filename = null) {
    const exportDir = path.resolve('exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[-:T.]/g, '_').slice(0, 15);
      filename = `chat_session_${timestamp}.md`;
    }

    const filepath = path.join(exportDir, filename);
    let mdContent = `# Chat Session Export - ${new Date().toLocaleString()}\n\n`;

    for (const msg of this.messages) {
      const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
      mdContent += `### **${role}**\n${msg.content}\n\n---\n\n`;
    }

    fs.writeFileSync(filepath, mdContent, 'utf-8');
    return filepath;
  }
}
