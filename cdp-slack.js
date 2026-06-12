const http = require('http');
const WebSocket = require('ws');

// Get tabs
function getTabs() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

// Create new tab
function newTab(url) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:9222/json/new?${encodeURIComponent(url)}`, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

class CDPSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id && this.pending.has(msg.id)) {
        const {resolve, reject} = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  
  ready() {
    return new Promise(r => this.ws.on('open', r));
  }
  
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, {resolve, reject});
      this.ws.send(JSON.stringify({id, method, params}));
    });
  }
  
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {expression: expr, awaitPromise: true});
    return r.result;
  }
  
  close() { this.ws.close(); }
}

async function main() {
  const tabs = await getTabs();
  const mainTab = tabs.find(t => t.type === 'page') || tabs[0];
  console.log('Using tab:', mainTab.url);
  
  const cdp = new CDPSession(mainTab.webSocketDebuggerUrl);
  await cdp.ready();
  
  // Navigate to Slack API
  await cdp.send('Page.navigate', {url: 'https://api.slack.com/apps/A0B11871KJR/slash-commands'});
  await new Promise(r => setTimeout(r, 3000));
  
  const title = await cdp.eval('document.title');
  const url = await cdp.eval('window.location.href');
  console.log('Title:', JSON.stringify(title));
  console.log('URL:', JSON.stringify(url));
  
  cdp.close();
}

main().catch(console.error);
