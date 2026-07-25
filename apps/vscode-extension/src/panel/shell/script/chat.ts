// MigraPilot Shell — webview script: conversation surface (§6).
//
// The markdown renderer, streaming pipeline, tool-activity rows and message
// actions are MIGRATED from the proven chat view so streaming, code fences,
// tables, copy-to-clipboard and duplicate-response suppression keep their exact
// existing behaviour. What changed is presentation and structure, not the turn
// pipeline.

export function chatScript(): string {
  return String.raw`
let currentBody = null;
let currentRaw = '';

function escapeMd(value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMarkdown(text) {
  let html = /<[a-z][\s\S]*>/i.test(text) ? text : escapeMd(text);
  html = html.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" title="$2">$1</a>');
  /* Workspace file references render as inline chips (§6). */
  html = html.replace(/(^|[\s(])((?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]{1,6})(:\d+)?/gi,
    function (m, pre, path, line) { return pre + '<span class="fileref">' + path + (line || '') + '</span>'; });
  return html;
}

function renderMarkdown(text) {
  const blocks = [];
  let processed = String(text == null ? '' : text).replace(/\x60\x60\x60(\w*)?\n([\s\S]*?)\x60\x60\x60/g, function (m, lang, code) {
    const index = blocks.length;
    blocks.push('<pre><code>' + escapeMd(code) + '</code><button class="copybtn" data-copy-code="1">Copy</button></pre>');
    return '%%CB_' + index + '%%';
  });

  processed = processed.replace(/(^|\n)(\|.+\|\n)(\|[-:|\s]+\|\n)((?:\|.+\|\n?)*)/gm, function (m, pre, headerLine, sep, bodyLines) {
    const headers = headerLine.trim().split('|').filter((c) => c.trim());
    let out = '<table><thead><tr>';
    for (const header of headers) out += '<th>' + escapeMd(header.trim()) + '</th>';
    out += '</tr></thead><tbody>';
    for (const row of bodyLines.trim().split('\n').filter(Boolean)) {
      out += '<tr>';
      for (const cell of row.split('|').filter((c) => c.trim())) out += '<td>' + escapeMd(cell.trim()) + '</td>';
      out += '</tr>';
    }
    return pre + out + '</tbody></table>';
  });

  const lines = processed.split('\n');
  let html = '';
  let inList = false;
  let listType = '';
  for (const rawLine of lines) {
    const line = rawLine;
    const cb = line.trim().match(/^%%CB_(\d+)%%$/);
    if (cb) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      html += blocks[parseInt(cb[1], 10)];
      continue;
    }
    if (/^###\s/.test(line)) { if (inList) { html += '</' + listType + '>'; inList = false; } html += '<h3>' + inlineMarkdown(line.slice(4)) + '</h3>'; continue; }
    if (/^##\s/.test(line)) { if (inList) { html += '</' + listType + '>'; inList = false; } html += '<h2>' + inlineMarkdown(line.slice(3)) + '</h2>'; continue; }
    if (/^#\s/.test(line)) { if (inList) { html += '</' + listType + '>'; inList = false; } html += '<h1>' + inlineMarkdown(line.slice(2)) + '</h1>'; continue; }
    if (/^(---+|\*\*\*+|___+)$/.test(line.trim())) { if (inList) { html += '</' + listType + '>'; inList = false; } html += '<hr>'; continue; }
    if (/^>\s?/.test(line)) { if (inList) { html += '</' + listType + '>'; inList = false; } html += '<blockquote>' + inlineMarkdown(line.replace(/^>\s?/, '')) + '</blockquote>'; continue; }
    if (/^\s*[-*+]\s/.test(line)) {
      if (!inList || listType !== 'ul') { if (inList) html += '</' + listType + '>'; html += '<ul>'; inList = true; listType = 'ul'; }
      html += '<li>' + inlineMarkdown(line.replace(/^\s*[-*+]\s/, '')) + '</li>';
      continue;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      if (!inList || listType !== 'ol') { if (inList) html += '</' + listType + '>'; html += '<ol>'; inList = true; listType = 'ol'; }
      html += '<li>' + inlineMarkdown(line.replace(/^\s*\d+\.\s/, '')) + '</li>';
      continue;
    }
    if (inList) { html += '</' + listType + '>'; inList = false; }
    if (line.trim() === '') continue;
    html += '<p>' + inlineMarkdown(line) + '</p>';
  }
  if (inList) html += '</' + listType + '>';
  html = html.replace(/%%CB_(\d+)%%/g, function (m, n) { return blocks[parseInt(n, 10)] || m; });
  return html;
}

/* Clipboard in a webview iframe frequently rejects; fall back to execCommand. */
function copyToClipboard(text) {
  const value = text == null ? '' : String(text);
  const fallback = () => {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (err) { return false; }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(() => true, fallback);
    }
  } catch (err) { /* fall through */ }
  return Promise.resolve(fallback());
}

function timeLabel() {
  const now = new Date();
  let hours = now.getHours();
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return hours + ':' + String(now.getMinutes()).padStart(2, '0') + ' ' + suffix;
}

function showThread() {
  const welcome = $('welcome');
  const thread = $('thread');
  if (welcome) welcome.style.display = 'none';
  if (thread) thread.classList.add('active');
}

function resetThread() {
  const welcome = $('welcome');
  const thread = $('thread');
  if (thread) { thread.innerHTML = ''; thread.classList.remove('active'); }
  if (welcome) welcome.style.display = '';
  setHtml('chat-agent', '');
  messages = [];
  currentBody = null;
  currentRaw = '';
}

function addUserMessage(text, skipSave) {
  showThread();
  const element = document.createElement('div');
  element.className = 'msg user';
  element.innerHTML =
    '<div class="msg-head"><span class="av" aria-hidden="true">U</span><span>You</span><span class="ts">' + esc(timeLabel()) + '</span></div>'
    + '<div class="msg-body">' + escapeMd(text) + '</div>';
  const thread = $('thread');
  if (thread) thread.appendChild(element);
  scrollThread();
  if (!skipSave) {
    messages.push({ role: 'user', text: text });
    saveTranscript();
    renderInlineProposal();
  }
}

function startAssistantMessage() {
  showThread();
  const element = document.createElement('div');
  element.className = 'msg assistant';
  element.innerHTML =
    '<div class="msg-head"><span class="av" aria-hidden="true">MP</span><span>MigraPilot</span><span class="ts">' + esc(timeLabel()) + '</span></div>'
    + '<div class="msg-body"></div>';
  const thread = $('thread');
  if (thread) thread.appendChild(element);
  currentBody = element.querySelector('.msg-body');
  currentRaw = '';
  scrollThread();
  return currentBody;
}

function addToolActivity(data) {
  if (!currentBody) startAssistantMessage();
  const state = (data && data.status) || 'running';
  const name = (data && (data.toolName || data.name)) || 'tool';
  const element = document.createElement('div');
  element.className = 'tool';
  element.innerHTML = (state === 'running' ? '<span class="spinner"></span>' : svg('check'))
    + '<span class="tname">' + esc(name) + '</span><span class="tstate">' + esc(state) + '</span>';
  currentBody.appendChild(element);
  scrollThread();
}

function addError(text) {
  const element = document.createElement('div');
  element.className = 'errbox';
  element.setAttribute('role', 'alert');
  /* Bounded: never a stack trace or raw backend body (§14). */
  element.textContent = String(text || 'MigraPilot could not complete the request.').slice(0, 400);
  if (currentBody) currentBody.appendChild(element);
  else startAssistantMessage().appendChild(element);
  scrollThread();
}

function scrollThread() {
  const main = $('main');
  if (!main) return;
  requestAnimationFrame(() => { main.scrollTop = main.scrollHeight; });
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function saveTranscript() {
  vscode.postMessage({ type: 'saveState', messages: messages });
  vscode.setState({ messages: messages, tab: activeTab });
}

function restoreTranscript(list) {
  messages = Array.isArray(list) ? list : [];
  const thread = $('thread');
  if (thread) thread.innerHTML = '';
  currentBody = null;
  if (!messages.length) {
    resetThread();
    return;
  }
  showThread();
  for (const message of messages) {
    if (message.role === 'user') addUserMessage(message.text, true);
    else if (message.role === 'assistant') {
      const body = startAssistantMessage();
      body.innerHTML = renderMarkdown(message.text);
    }
  }
  /* State and transcript arrive independently, so the inline governance card is
   * re-evaluated whenever the transcript changes. */
  renderInlineProposal();
  scrollThread();
}

function setStreaming(value) {
  streaming = value;
  const send = $('csend');
  const stop = $('cstop');
  if (send) { send.style.display = value ? 'none' : ''; send.disabled = value; }
  if (stop) stop.classList.toggle('show', value);
  showHint(value ? 'Streaming a response — press Escape to stop.' : '', 'info');
  if (!value) dispatching = false;
}

/* Delegated copy handler for generated code blocks. */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy-code]');
  if (!button) return;
  const pre = button.parentElement;
  const code = pre && pre.querySelector('code');
  if (!code) return;
  copyToClipboard(code.textContent).then((ok) => {
    button.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, 1400);
  });
});
`;
}
