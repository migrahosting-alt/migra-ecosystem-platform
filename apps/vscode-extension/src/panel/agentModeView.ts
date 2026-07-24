import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  AgentModeCommandProposalRequest,
  AgentModeCommandRunView,
  AgentModeState,
} from '@migrapilot/protocol';
import { MigraAiClient } from '../services/migraAiClient.js';
import { AgentModeSessionGate, agentModeHistoryDetailLines, agentModeHistorySummaryLines, agentModeRecoveryControlState, renderPreviewLines } from './agentModeModel.js';
export { agentModeStatusText, renderPreviewLines } from './agentModeModel.js';

const ACTIVE_RUN_KEY = 'migrapilot.agentMode.activeCommandRun';

export interface AgentModeViewDeps {
  client: MigraAiClient;
  workspaceRoot(): string | undefined;
  authorizeWorkspace(root: string): Promise<string>;
  memento: vscode.Memento;
  output: vscode.OutputChannel;
  onMode(enabled: boolean, state: AgentModeState): void;
}

export class MigraPilotAgentModeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'migrapilot.agentMode';
  private view?: vscode.WebviewView;
  private readonly gate = new AgentModeSessionGate();
  private state: AgentModeState = 'IDLE';
  private current?: AgentModeCommandRunView;

  constructor(private readonly extensionUri: vscode.Uri, private readonly deps: AgentModeViewDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.gate.reset();
    this.state = 'IDLE';
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: unknown) => void this.onMessage(message));
    view.onDidDispose(() => {
      this.view = undefined;
      this.gate.reset();
      this.state = 'IDLE';
      this.deps.onMode(false, 'IDLE');
    });
    this.postMode();
    const storedRun = this.deps.memento.get<string>(ACTIVE_RUN_KEY);
    if (storedRun) void this.reconcile(storedRun);
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${MigraPilotAgentModeViewProvider.viewType}.focus`);
  }

  enter(): void {
    this.gate.enter();
    this.setState(this.current?.state ?? 'IDLE');
  }

  exit(): void {
    this.gate.reset();
    this.setState('IDLE');
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = (raw ?? {}) as Record<string, unknown>;
    if (message.type === 'enter') return this.enter();
    if (message.type === 'exit') return this.exit();
    if (!this.gate.enabled) {
      this.postError('Enter Agent Mode explicitly before proposing or controlling a command.');
      return;
    }
    if (message.type === 'propose') {
      await this.proposeFromMessage(message);
      return;
    }
    if (message.type === 'history') {
      try {
        const history = await this.deps.client.listAgentModeRunHistory({ limit: 10 });
        const lines = history.runs.flatMap((run) => [...agentModeHistorySummaryLines(run), '']);
        void this.view?.webview.postMessage({ type: 'history', text: lines.join('\n') || 'No Agent run history for this workspace.' });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Agent run history request failed.';
        this.postError(detail);
      }
      return;
    }
    const runId = this.current?.runId;
    if (!runId) {
      this.postError('No authoritative command run is active.');
      return;
    }
    if (message.type === 'approve' || message.type === 'reject') {
      const fingerprint = this.current?.preview?.fingerprint;
      if (!fingerprint) return this.postError('The authoritative preview fingerprint is unavailable.');
      if (message.type === 'approve') {
        const preview = this.current?.preview;
        if (!preview) return this.postError('The authoritative preview is unavailable.');
        const detail = renderPreviewLines(preview).join('\n');
        const choice = await vscode.window.showWarningMessage(
          'Approve this Agent Mode Git recipe once?',
          { modal: true, detail },
          'Approve once',
        );
        if (choice !== 'Approve once') return;
      }
      await this.perform(() => this.deps.client.decideAgentModeCommand(runId, message.type as 'approve' | 'reject', fingerprint));
      return;
    }
    if (message.type === 'cancel') {
      await this.perform(() => this.deps.client.cancelAgentModeCommand(runId));
      return;
    }
    if (message.type === 'recovery') {
      try {
        const status = await this.deps.client.getAgentModeRunRecoveryStatus(runId);
        void this.view?.webview.postMessage({ type: 'recovery', status });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Recovery status request failed.';
        this.postError(detail);
      }
      return;
    }
    if (message.type === 'historyDetail') {
      try {
        const detail = await this.deps.client.getAgentModeRunHistory(runId);
        void this.view?.webview.postMessage({ type: 'history', text: agentModeHistoryDetailLines(detail).join('\n') });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Agent run evidence request failed.';
        this.postError(detail);
      }
      return;
    }
    if (message.type === 'exportEvidence') {
      try {
        const exported = await this.deps.client.exportAgentModeRunEvidence(runId);
        void this.view?.webview.postMessage({ type: 'history', text: `Evidence export manifest\nRun: ${exported.runId}\nSHA-256: ${exported.manifest.digest}\nBytes: ${exported.manifest.canonicalBytes}` });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Agent run evidence export failed.';
        this.postError(detail);
      }
      return;
    }
    if (message.type === 'repropose') {
      const current = this.current;
      if (!current) return this.postError('No authoritative command run is active.');
      const recovery = agentModeRecoveryControlState(current);
      if (!recovery.freshProposal) return this.postError('This run is not eligible for a fresh recovery proposal.');
      const choice = await vscode.window.showWarningMessage(
        'Create a fresh Agent Mode proposal from this terminal run?',
        { modal: true, detail: 'This does not resume or execute the previous run. It creates a new server proposal that must be reviewed and approved again.' },
        'Create fresh proposal',
      );
      if (choice !== 'Create fresh proposal') return;
      try {
        const proposed = await this.performWithResult(() => this.deps.client.reproposeAgentModeCommand(runId, { requestId: randomUUID(), reason: 'Operator requested a fresh proposal from the prior terminal run.' }));
        const fingerprint = proposed.preview?.fingerprint;
        if (proposed.state === 'AWAITING_APPROVAL' && fingerprint) {
          await this.performWithResult(() => this.deps.client.markAgentModePreviewDisplayed(proposed.runId, fingerprint));
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Recovery proposal request failed.';
        this.deps.output.appendLine(`[agent-mode] ${detail}`);
        this.postError(detail);
      }
      return;
    }
    if (message.type === 'reconcile') await this.reconcile(runId);
  }

  private async proposeFromMessage(message: Record<string, unknown>): Promise<void> {
    const rootPath = this.deps.workspaceRoot();
    if (!rootPath) return this.postError('Open a workspace folder before entering an Agent Mode command lifecycle.');
    if (message.recipe !== 'git.status' && message.recipe !== 'git.diff') return this.postError('The requested recipe is unavailable in Stage 2B.');
    if (typeof message.reason !== 'string' || message.reason.trim().length < 1 || message.reason.length > 500) return this.postError('Provide a bounded reason for the recipe.');
    const authorizedRoot = await this.deps.authorizeWorkspace(rootPath);
    const request: AgentModeCommandProposalRequest = {
      rootPath: authorizedRoot,
      recipe: String(message.recipe ?? '') as AgentModeCommandProposalRequest['recipe'],
      reason: String(message.reason ?? '').trim(),
    };
    this.setState('PLANNING');
    try {
      const proposed = await this.performWithResult(() => this.deps.client.proposeAgentModeCommand(request));
      const fingerprint = proposed.preview?.fingerprint;
      if (proposed.state === 'AWAITING_APPROVAL' && fingerprint) {
        await this.performWithResult(() => this.deps.client.markAgentModePreviewDisplayed(proposed.runId, fingerprint));
      }
    } catch (error) {
      this.setState('FAILED');
      const detail = error instanceof Error ? error.message : 'Agent Mode request failed.';
      this.deps.output.appendLine(`[agent-mode] ${detail}`);
      this.postError(detail);
    }
  }

  private async reconcile(runId: string): Promise<void> {
    await this.perform(() => this.deps.client.getAgentModeCommand(runId));
  }

  private async perform(action: () => Promise<AgentModeCommandRunView>): Promise<void> {
    try {
      await this.performWithResult(action);
    } catch (error) {
      this.setState('FAILED');
      const message = error instanceof Error ? error.message : 'Agent Mode request failed.';
      this.deps.output.appendLine(`[agent-mode] ${message}`);
      this.postError(message);
    }
  }

  private async performWithResult(action: () => Promise<AgentModeCommandRunView>): Promise<AgentModeCommandRunView> {
    const view = await action();
    this.current = view;
    await this.deps.memento.update(ACTIVE_RUN_KEY, view.runId);
    this.setState(view.state);
    void this.view?.webview.postMessage({ type: 'run', view });
    return view;
  }

  private setState(state: AgentModeState): void {
    this.state = state;
    this.deps.onMode(this.gate.enabled, state);
    this.postMode();
  }

  private postMode(): void {
    void this.view?.webview.postMessage({ type: 'mode', enabled: this.gate.enabled, state: this.state });
  }

  private postError(message: string): void {
    void this.view?.webview.postMessage({ type: 'error', message: message.slice(0, 500) });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString('base64url');
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
body{font-family:var(--vscode-font-family);padding:12px;color:var(--vscode-foreground)}
.badge{display:inline-block;padding:4px 8px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-weight:700}.off{opacity:.65}
label{display:block;margin-top:10px;font-size:12px}input,textarea{width:100%;padding:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}button{margin:8px 6px 0 0;padding:6px 10px}pre{white-space:pre-wrap;word-break:break-word;background:var(--vscode-textCodeBlock-background);padding:10px}.danger{color:var(--vscode-errorForeground)}#controls,#proposal{display:none}
</style></head><body>
<h2>Agent Mode — Command Approval</h2><p id="mode" class="badge off">OFF</p>
<div><button id="enter">Enter Agent Mode</button><button id="exit">Exit Agent Mode</button></div>
		<section id="proposal"><label>Server-owned recipe<select id="recipe"><option value="git.status">Git status</option><option value="git.diff">Git diff</option></select></label><label>Reason<textarea id="reason">Run the selected hardened Git inspection recipe.</textarea></label><button id="propose">Create server proposal</button></section>
<section id="run"><h3>Authoritative state</h3><pre id="details">No proposal.</pre><div id="controls"><button id="approve">Approve once</button><button id="reject">Reject</button><button id="cancel">Cancel</button><button id="reconcile">Reconcile</button><button id="recovery">Recovery status</button><button id="repropose">Create fresh proposal</button><button id="historyDetail">Inspect evidence</button><button id="exportEvidence">Export evidence manifest</button></div><button id="history">Run history</button><pre id="historyBox">History is evidence only. It cannot approve, resume, or execute.</pre><p id="error" class="danger"></p></section>
<script nonce="${nonce}">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);let current;
$('enter').onclick=()=>vscode.postMessage({type:'enter'});$('exit').onclick=()=>vscode.postMessage({type:'exit'});
	$('propose').onclick=()=>vscode.postMessage({type:'propose',recipe:$('recipe').value,reason:$('reason').value});
for(const id of ['approve','reject','cancel','reconcile','recovery','repropose','history','historyDetail','exportEvidence']) $(id).onclick=()=>vscode.postMessage({type:id});
	addEventListener('message',({data})=>{if(data.type==='mode'){ $('mode').textContent=data.enabled?'ON · '+data.state:'OFF';$('mode').className='badge'+(data.enabled?'':' off');$('proposal').style.display=data.enabled?'block':'none';}if(data.type==='error')$('error').textContent=data.message;if(data.type==='history')$('historyBox').textContent=data.text;if(data.type==='recovery'&&current){current.recovery={classification:data.status.recoveryClass,eligible:data.status.eligible,reason:data.status.explanation,sourceRunId:data.status.lineage.sourceRunId,successorRunId:data.status.lineage.successorRunId};render(current,data.status);}if(data.type==='run'){current=data.view;$('error').textContent='';render(current);}});
function render(v,status){$('controls').style.display='block';const p=v.preview;const lines=['State: '+v.state,'Run: '+v.runId,'Request: '+v.requestId];if(p){lines.push('Recipe: '+p.recipe,'Policy: '+p.policyVersion,'Execution identity: '+p.executionIdentity,'Environment policy: '+p.environmentPolicy,'Workspace material: '+p.workspaceMaterialFingerprint,'Snapshot: '+p.snapshotId,'Live source: '+p.sourceWorkspace,'Executable: '+p.executable,...p.arguments.map((a,i)=>'Arg '+(i+1)+': '+a),'Working directory: '+p.cwd,'Timeout: '+p.timeoutMs+' ms','Output limit: '+p.outputLimitBytes+' bytes','Mutation: '+p.mutationClassification,'Network: '+p.networkPolicy,'Can modify files: '+p.canModifyFiles,'Reason: '+p.reason,'Fingerprint: '+p.fingerprint,'Expires: '+new Date(p.expiresAt).toISOString(),...p.expectedEffects.map(e=>'Expected effect: '+e),...p.environment.map(e=>'Environment '+e.key+': '+e.value),...p.warnings.map(w=>'Warning: '+w));}if(v.approval){lines.push('Approval lifecycle: '+v.approval.lifecycle);if(v.approval.invalidationReason)lines.push('Approval invalidation: '+v.approval.invalidationReason);}if(v.recovery){lines.push('Recovery: '+v.recovery.classification,'Recovery eligible: '+v.recovery.eligible);if(v.recovery.reason)lines.push('Recovery reason: '+v.recovery.reason);if(v.recovery.sourceRunId)lines.push('Recovery source: '+v.recovery.sourceRunId);if(v.recovery.successorRunId)lines.push('Recovery successor: '+v.recovery.successorRunId);}if(status)lines.push('Recovery recommendation: '+status.recommendedAction);if(v.result)lines.push('Exit code: '+v.result.exitCode,'stdout: '+v.result.stdout,'stderr: '+v.result.stderr);if(v.error)lines.push('Failure: '+v.error.code+' — '+v.error.message);$('details').textContent=lines.join('\n');$('approve').disabled=v.state!=='AWAITING_APPROVAL';$('reject').disabled=v.state!=='AWAITING_APPROVAL';$('cancel').disabled=!['PLANNING','AWAITING_APPROVAL','APPROVED','EXECUTING'].includes(v.state);$('repropose').disabled=!(v.recovery&&v.recovery.eligible);}
</script></body></html>`;
  }
}
