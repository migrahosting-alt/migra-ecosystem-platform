// MigraPilot Shell — webview script: composer (§11) and the host message loop.
//
// Behaviour preserved from the existing chat view: Enter sends / Shift+Enter
// newlines, drag-and-drop + paste attachments, text documents inlined into the
// prompt, images forwarded as vision attachments, local voice recording relayed
// through the host, slash palette, and the routing selector.
//
// Two independent duplicate-submit guards: `dispatching` here, and an in-flight
// refusal on the host. A double dispatch must never reach the backend.

export function composerScript(): string {
  return String.raw`
let pendingFiles = [];
let paletteOpen = false;
let paletteIndex = 0;
let paletteMatches = [];
let voiceSupported = false;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 6;
const MAX_INLINE_CHARS = 60000;
const TEXT_EXT = /\.(txt|md|markdown|json|jsonc|csv|tsv|ya?ml|toml|ini|env|log|xml|html?|css|scss|js|jsx|ts|tsx|py|rb|go|rs|java|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|sql|graphql|gql|svg|conf|dockerfile|makefile|diff|patch)$/i;

const SLASH = SLASH_COMMANDS_JSON;

function classifyFile(file) {
  if ((file.type || '').startsWith('image/')) return 'image';
  if (TEXT_EXT.test(file.name) || (file.type || '').startsWith('text/')) return 'text';
  if (/json|xml|yaml|csv|javascript|typescript/.test(file.type || '')) return 'text';
  return 'binary';
}

function addFiles(list) {
  for (const file of list) {
    if (pendingFiles.length >= MAX_FILES) break;
    if (file.size > MAX_FILE_BYTES) {
      vscode.postMessage({ type: 'info', text: '"' + file.name + '" is larger than 8 MB and was not attached.' });
      continue;
    }
    const kind = classifyFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      const entry = { name: file.name, size: file.size, type: file.type, kind: kind };
      if (kind === 'text') entry.text = String(reader.result || '');
      else entry.dataUrl = reader.result;
      pendingFiles.push(entry);
      renderChips();
      vscode.postMessage({ type: 'attachmentsChanged', files: pendingFiles.map((f) => ({ name: f.name, kind: f.kind })) });
    };
    if (kind === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  }
}

function renderChips() {
  const chips = $('chips');
  if (!chips) return;
  chips.innerHTML = '';
  chips.classList.toggle('has', pendingFiles.length > 0);
  pendingFiles.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    const preview = file.kind === 'image' && file.dataUrl ? '<img src="' + esc(file.dataUrl) + '" alt="" />' : '';
    chip.innerHTML = preview + '<span class="cname">' + esc(file.name) + '</span>'
      + '<button aria-label="Remove ' + esc(file.name) + '">&times;</button>';
    chip.querySelector('button').addEventListener('click', () => {
      pendingFiles.splice(index, 1);
      renderChips();
      vscode.postMessage({ type: 'attachmentsChanged', files: pendingFiles.map((f) => ({ name: f.name, kind: f.kind })) });
    });
    chips.appendChild(chip);
  });
}

function autoResize() {
  const input = $('cinput');
  if (!input) return;
  const max = Math.max(120, Math.floor(window.innerHeight * 0.4));
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, max) + 'px';
}

/* ── Slash palette ─────────────────────────────────────────────────────── */

function openPalette(query) {
  const needle = String(query || '').replace(/^\//, '').toLowerCase();
  paletteMatches = SLASH.filter((command) =>
    !needle || command.name.slice(1).toLowerCase().indexOf(needle) === 0 || command.description.toLowerCase().indexOf(needle) >= 0);
  const palette = $('palette');
  const items = $('palette-items');
  if (!palette || !items) return;
  if (!paletteMatches.length) { closePalette(); return; }
  paletteIndex = 0;
  renderPalette();
  palette.classList.add('open');
  paletteOpen = true;
}

function renderPalette() {
  const items = $('palette-items');
  if (!items) return;
  let html = '';
  paletteMatches.forEach((command, index) => {
    html += '<button class="pitem" role="option" data-palette="' + esc(command.name) + '"'
      + ' aria-selected="' + (index === paletteIndex ? 'true' : 'false') + '">'
      + '<span class="pname">' + esc(command.name) + '</span>'
      + (command.args ? '<span class="pargs">' + esc(command.args) + '</span>' : '')
      + '<span class="pdesc">' + esc(command.description) + '</span></button>';
  });
  items.innerHTML = html;
}

/** Returns true when it actually closed something (so Escape can be chained). */
function closePalette() {
  const palette = $('palette');
  if (!palette || !paletteOpen) return false;
  palette.classList.remove('open');
  paletteOpen = false;
  return true;
}

function runSlash(name) {
  const command = SLASH.find((entry) => entry.name === name);
  closePalette();
  const input = $('cinput');
  if (!command) return;
  if (command.effect.kind === 'command') {
    if (input) input.value = '';
    vscode.postMessage({ type: 'command', command: command.effect.command });
    return;
  }
  if (command.effect.kind === 'shell') {
    if (input) input.value = '';
    const action = command.effect.action;
    if (action.indexOf('tab:') === 0) selectTab(action.slice(4));
    else vscode.postMessage({ type: 'shellAction', action: action });
    return;
  }
  if (input) {
    input.value = command.effect.prefix;
    input.focus();
    autoResize();
  }
}

/* ── Send ──────────────────────────────────────────────────────────────── */

function canSubmit(hasContent) {
  if (!SHELL || !SHELL.composer || !SHELL.composer.connected) return false;
  if (!hasContent) return false;
  if (streaming) return false;
  if (dispatching) return false;
  return true;
}

function send() {
  const input = $('cinput');
  if (!input) return;
  const text = input.value.trim();
  const hasContent = text.length > 0 || pendingFiles.length > 0;
  if (!canSubmit(hasContent)) {
    if (hasContent && SHELL && SHELL.composer && !SHELL.composer.connected) {
      showHint('MigraPilot is disconnected. Repair the connection before sending.', 'warn');
    }
    return;
  }
  dispatching = true;

  const images = pendingFiles.filter((file) => file.kind === 'image');
  const docs = pendingFiles.filter((file) => file.kind === 'text');
  const binaries = pendingFiles.filter((file) => file.kind === 'binary');

  let prompt = text;
  for (const doc of docs) {
    let body = doc.text || '';
    if (body.length > MAX_INLINE_CHARS) body = body.slice(0, MAX_INLINE_CHARS) + '\n… [truncated]';
    prompt += '\n\n--- Attached file: ' + doc.name + ' ---\n\x60\x60\x60\n' + body + '\n\x60\x60\x60';
  }
  for (const binary of binaries) prompt += '\n\n[Attached (not readable as text): ' + binary.name + ']';
  if (!text && images.length) prompt = 'Analyze the attached image(s).' + prompt;

  const summary = pendingFiles.length ? pendingFiles.map((file) => file.name).join('  ') : '';
  addUserMessage([text, summary].filter(Boolean).join('\n') || summary || text);

  currentBody = null;
  setStreaming(true);

  const route = $('croute');
  const value = route ? route.value : 'auto';
  const pinned = value.indexOf('model:') === 0 ? value.slice(6) : undefined;
  const provider = pinned ? undefined : (value === 'auto' ? undefined : value);
  const history = messages
    .slice(Math.max(0, messages.length - 12), Math.max(0, messages.length - 1))
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role, text: m.text }));

  vscode.postMessage({
    type: 'chat',
    text: prompt,
    files: images.length ? images.map((f) => ({ name: f.name, type: f.type, dataUrl: f.dataUrl })) : undefined,
    provider: provider,
    modelId: pinned,
    history: history
  });

  input.value = '';
  input.style.height = 'auto';
  pendingFiles = [];
  renderChips();
  input.focus();
}

/* ── Voice (record here, transcribe on the host) ────────────────────────── */

let recorder = null;
let stream = null;
let chunks = [];
let recording = false;
const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

function setMic(state) {
  const mic = $('cmic');
  if (!mic) return;
  mic.classList.toggle('recording', state === 'recording');
  mic.disabled = state === 'transcribing' || !voiceSupported || !canRecord;
  mic.title = !voiceSupported || !canRecord
    ? 'Voice input unavailable — no local speech service is configured'
    : state === 'recording' ? 'Recording… click to stop'
    : state === 'transcribing' ? 'Transcribing…'
    : 'Voice input — click to record';
  mic.setAttribute('aria-label', mic.title);
}

async function startRecording() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    vscode.postMessage({ type: 'info', text: 'Microphone access was denied or is unavailable.' });
    return;
  }
  chunks = [];
  let mime = '';
  if (window.MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
  else if (window.MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
  try { recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
  catch (err) { recorder = new MediaRecorder(stream); }
  recorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) chunks.push(event.data); };
  recorder.onstop = () => {
    (stream && stream.getTracks() ? stream.getTracks() : []).forEach((track) => track.stop());
    stream = null;
    if (!chunks.length) { setMic('idle'); return; }
    const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
    setMic('transcribing');
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      vscode.postMessage({ type: 'transcribe', audio: url.slice(url.indexOf(',') + 1), mime: blob.type });
    };
    reader.readAsDataURL(blob);
  };
  recorder.start();
  recording = true;
  setMic('recording');
}

function stopRecording() {
  recording = false;
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch (err) { /* already stopped */ }
  }
}

/* ── Wiring ────────────────────────────────────────────────────────────── */

function initComposer() {
  const input = $('cinput');
  const send$ = $('csend');
  const stop$ = $('cstop');
  const attach = $('cattach');
  const file = $('cfile');
  const mic = $('cmic');
  const cmd = $('ccmd');
  const context = $('ccontext');

  if (send$) send$.addEventListener('click', send);
  if (stop$) stop$.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  if (attach && file) attach.addEventListener('click', () => file.click());
  if (file) file.addEventListener('change', () => { if (file.files) addFiles(file.files); file.value = ''; });
  if (context) context.addEventListener('click', () => vscode.postMessage({ type: 'shellAction', action: 'addContext' }));
  if (cmd) cmd.addEventListener('click', () => { if (!closePalette()) openPalette(''); });
  if (mic) {
    mic.addEventListener('click', () => {
      if (!voiceSupported || !canRecord) {
        vscode.postMessage({ type: 'info', text: 'Voice input is unavailable — no local speech service is configured.' });
        return;
      }
      if (recording) stopRecording(); else void startRecording();
    });
  }
  setMic('idle');

  if (input) {
    input.addEventListener('input', () => {
      autoResize();
      const value = input.value;
      if (value.charAt(0) === '/' && value.indexOf(' ') < 0) openPalette(value);
      else closePalette();
    });

    input.addEventListener('keydown', (event) => {
      if (paletteOpen) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          paletteIndex = event.key === 'ArrowDown'
            ? (paletteIndex + 1) % paletteMatches.length
            : (paletteIndex - 1 + paletteMatches.length) % paletteMatches.length;
          renderPalette();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          const match = paletteMatches[paletteIndex];
          if (match) runSlash(match.name);
          return;
        }
        if (event.key === 'Escape') { event.preventDefault(); closePalette(); return; }
      }
      /* Enter sends; Shift+Enter inserts a newline (§11). */
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });

    input.addEventListener('paste', (event) => {
      const items = event.clipboardData && event.clipboardData.items;
      if (items) {
        const files = [];
        for (let i = 0; i < items.length; i += 1) {
          if (items[i].kind === 'file') {
            const asFile = items[i].getAsFile();
            if (asFile) files.push(asFile);
          }
        }
        if (files.length) { event.preventDefault(); addFiles(files); return; }
      }
      requestAnimationFrame(autoResize);
    });
  }

  document.addEventListener('click', (event) => {
    const item = event.target.closest('[data-palette]');
    if (item) runSlash(item.dataset.palette);
  });

  document.addEventListener('dragover', (event) => { event.preventDefault(); });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    if (event.dataTransfer && event.dataTransfer.files) addFiles(event.dataTransfer.files);
  });

  window.addEventListener('resize', autoResize);
}

function applyComposerState(composer) {
  if (!composer) return;
  voiceSupported = composer.voiceSupported === true;
  const input = $('cinput');
  const send$ = $('csend');
  if (input) input.disabled = !composer.connected;
  if (send$) send$.disabled = !composer.connected || streaming;
  setMic(recording ? 'recording' : 'idle');
  if (!composer.connected) showHint('MigraPilot is disconnected. Repair the connection to send a message.', 'warn');
  else if (!streaming) showHint('', 'info');
}

/* ── Host message loop ─────────────────────────────────────────────────── */

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;

  switch (message.type) {
    case 'state':
      SHELL = message.state;
      renderNavigation(SHELL.nav);
      renderContext(SHELL.context);
      renderAgentWorkspace(SHELL.agent);
      renderRunDiff(SHELL.diff);
      renderAuditTrail(SHELL.history, SHELL.detail);
      renderStatus(SHELL.status);
      applyComposerState(SHELL.composer);
      if (SHELL.tab && SHELL.tab !== activeTab) selectTab(SHELL.tab, { silent: true });
      break;

    case 'tab':
      selectTab(message.tab, { silent: true });
      break;

    case 'models': {
      const route = $('croute');
      if (!route || !Array.isArray(message.models)) break;
      const previous = route.value;
      let html = '<option value="auto">Auto</option>'
        + '<optgroup label="Auto by size">'
        + '<option value="cheap">Fast</option>'
        + '<option value="default">Balanced</option>'
        + '<option value="premium">Deep</option>'
        + '</optgroup>';
      const models = message.models.slice().sort((a, b) => {
        const ap = a.state === 'approved' ? 0 : 1;
        const bp = b.state === 'approved' ? 0 : 1;
        return ap - bp || (b.paramCount || 0) - (a.paramCount || 0);
      });
      if (models.length) {
        html += '<optgroup label="Local models">';
        for (const model of models) {
          const size = model.paramCount ? ' · ' + model.paramCount + 'B' : '';
          const badge = model.state && model.state !== 'approved' ? ' (' + model.state + ')' : '';
          html += '<option value="model:' + esc(model.id) + '">' + esc(model.id) + size + badge + '</option>';
        }
        html += '</optgroup>';
      }
      route.innerHTML = html;
      const keep = Array.prototype.some.call(route.options, (option) => option.value === previous);
      route.value = keep ? previous : 'auto';
      break;
    }

    case 'streamStart':
      selectTab('chat', { silent: true });
      startAssistantMessage();
      break;

    case 'token':
      if (!currentBody) startAssistantMessage();
      currentRaw += message.text;
      currentBody.innerHTML = renderMarkdown(currentRaw) + '<span class="cursor"></span>';
      scrollThread();
      break;

    case 'tool':
      addToolActivity(message.data || {});
      break;

    case 'statusUpdate':
      if (typeof message.text === 'string' && message.text.trim()) showHint(message.text, 'info');
      break;

    case 'error':
      addError(message.text);
      break;

    case 'streamEnd': {
      setStreaming(false);
      if (message.stopped && currentBody) currentRaw += ' [stopped]';
      const finalText = currentRaw;
      if (currentBody && finalText) {
        const last = messages[messages.length - 1];
        const duplicate = last && last.role === 'assistant' && normalizeText(last.text) === normalizeText(finalText);
        if (duplicate) {
          if (currentBody.parentElement) currentBody.parentElement.remove();
        } else {
          currentBody.innerHTML = renderMarkdown(finalText);
          messages.push({ role: 'assistant', text: finalText });
          saveTranscript();
        }
      }
      currentRaw = '';
      /* Focus returns to the composer after a turn (§15). */
      const input = $('cinput');
      if (input && activeTab === 'chat') input.focus();
      break;
    }

    case 'restore':
      restoreTranscript(message.messages);
      break;

    case 'newChat':
      resetThread();
      saveTranscript();
      break;

    case 'injectMessage': {
      const input = $('cinput');
      if (input && message.text) {
        input.value = message.text;
        autoResize();
        if (message.submit === false) input.focus();
        else send();
      }
      break;
    }

    case 'transcribeResult': {
      setMic('idle');
      const input = $('cinput');
      const text = String(message.text || '').trim();
      if (input && text) {
        input.value = input.value ? input.value.replace(/\s*$/, '') + ' ' + text : text;
        autoResize();
        input.focus();
      } else {
        vscode.postMessage({ type: 'info', text: 'No speech detected.' });
      }
      break;
    }

    case 'transcribeError':
      setMic('idle');
      showHint(message.text || 'Voice transcription is unavailable.', 'warn');
      break;

    case 'notice':
      showHint(message.text, message.level);
      break;
  }
});

/* ── Boot ──────────────────────────────────────────────────────────────── */

initTabs();
initDrawers();
initDelegates();
initKeyboard();
initComposer();
selectTab(activeTab, { silent: true });

const saved = vscode.getState();
if (saved && Array.isArray(saved.messages) && saved.messages.length) restoreTranscript(saved.messages);
if (saved && saved.tab) selectTab(saved.tab, { silent: true });

vscode.postMessage({ type: 'ready' });
const bootInput = $('cinput');
if (bootInput) bootInput.focus();
`;
}
