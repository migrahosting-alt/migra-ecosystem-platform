// Runs INSIDE the extension host of a real VS Code, against the packaged VSIX.
// Drives MigraPilot through its REAL registered commands and records which
// internal capabilities actually fired.
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const OUT = process.env.BENCH_OUT;
const TASK = JSON.parse(process.env.BENCH_TASK);
const BRAIN = process.env.BENCH_BRAIN_URL;
const EXT_ID = 'migrateck.migrapilot-extension';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const evidence = { task: TASK.id, kind: TASK.kind, capabilities: [], steps: [], answer: '', errors: [], modelRouted: null };
const note = (step, detail) => evidence.steps.push({ at: Date.now(), step, detail });
const cap = (name) => { if (!evidence.capabilities.includes(name)) evidence.capabilities.push(name); };

exports.run = async function run() {
  const started = Date.now();
  try {
    const cfg = vscode.workspace.getConfiguration('migrapilot');
    await cfg.update('brainUrl', BRAIN, vscode.ConfigurationTarget.Global);
    await cfg.update('autoApplyChangeset', true, vscode.ConfigurationTarget.Global);
    // FINDING, recorded rather than hidden: the SHIPPED default is 30 000 ms, and
    // a 30B local coding model does not answer an Explain in 30 s from cold — the
    // first real-model run failed with `request_timeout`. The benchmark raises it
    // so it measures capability instead of re-measuring the timeout.
    await cfg.update('requestTimeoutMs', 900000, vscode.ConfigurationTarget.Global);
    evidence.timeoutRaisedFrom = 30000;
    evidence.effectiveTimeoutMs = vscode.workspace.getConfiguration('migrapilot').get('requestTimeoutMs');
    note('timeout', String(evidence.effectiveTimeoutMs));
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    note('activated', root);

    if (TASK.kind === 'explain') {
      // The product path: open the file, select the function, run the command.
      const doc = await vscode.workspace.openTextDocument(path.join(root, 'src/orders.js'));
      const editor = await vscode.window.showTextDocument(doc);
      const text = doc.getText();
      const from = doc.positionAt(text.indexOf('function submitOrder'));
      const to = doc.positionAt(text.indexOf('module.exports'));
      editor.selection = new vscode.Selection(from, to);
      note('selected', 'submitOrder in src/orders.js');
      cap('editor-selection');
      // The command renders its answer into an UNTITLED MARKDOWN document
      // (`openTextDocument({ language: 'markdown', content })`). Match on that,
      // not on a filename — the first attempt captured orders.js itself.
      const opened = new Promise((resolve) => {
        const sub = vscode.workspace.onDidOpenTextDocument((d) => {
          if (d.languageId === 'markdown' && d.isUntitled) { sub.dispose(); resolve(d); }
        });
        setTimeout(() => { sub.dispose(); resolve(undefined); }, 900000);
      });
      await vscode.commands.executeCommand('migrapilot.explainSelection');
      cap('explain-selection');
      const result = await opened;
      evidence.answer = result ? result.getText() : '';
      if (!result) evidence.errors.push('explainSelection produced no result document');
      note('explained', `${evidence.answer.length} chars`);
    }

    if (TASK.kind === 'review') {
      // Review is a reading task. This uses the PRODUCT'S OWN engine client from
      // the packaged payload — the same class the chat surface uses — so the run
      // exercises the shipped code path rather than a second implementation.
      // Require from the BUILT SOURCE tree, not the unzipped VSIX: the packaged
      // dist/*.js files import workspace deps that only resolve inside the
      // bundle, so requiring them standalone throws
      // "Cannot find module '@migrapilot/pilot-client'". Same compiled code,
      // resolvable location. (Harness bug — it cost this task a fair run.)
      const { MigraAiClient } = require(path.join(process.env.BENCH_SRC_DIST, 'services/migraAiClient.js'));
      const client = new MigraAiClient({ baseUrl: () => BRAIN, timeoutMs: () => 900000, log: () => {} });

      const overview = await client.runReadOnlyTool('git.overview', { rootPath: root });
      cap('git.overview');
      note('git', JSON.stringify(overview.counts ?? {}));

      let answer = '';
      for await (const frame of client.engineerStream({ rootPath: root, task: TASK.prompt })) {
        // The model the engine ACTUALLY routed to, taken from its own route frame.
        if (frame.event === 'route' && frame.data?.model) evidence.modelRouted = String(frame.data.model);
        if (frame.type === 'token' && typeof frame.data === 'string') answer += frame.data;
        else if (frame.data && typeof frame.data.text === 'string') answer += frame.data.text;
        if (frame.type === 'tool' && frame.data?.tool) cap(`tool:${frame.data.tool}`);
      }
      cap('engineer-turn');
      evidence.answer = answer;
      note('reviewed', `${answer.length} chars`);
    }

    if (TASK.kind === 'repair' || TASK.kind === 'feature' || TASK.kind === 'refactor') {
      // The real governed coding lane, driven through the registered command with
      // a scripted human: the task text, then one scope approval.
      let report = '';
      api.governedCoding.setUi(() => ({
        requestIssueText: async () => { cap('coding.issue'); return TASK.prompt; },
        presentScopeApproval: async (model) => {
          cap('coding.scope-approval');
          note('scope', JSON.stringify({ files: model?.files ?? model?.paths ?? null }).slice(0, 500));
          return 'approve';
        },
        presentCancellationChoice: async () => 'dismiss',
        showProgress: async (m) => { if (m?.message) note('progress', String(m.message).slice(0, 200)); },
        showFinalReport: async (m) => { report = JSON.stringify(m).slice(0, 4000); note('final', report.slice(0, 300)); },
        showError: async (m) => { evidence.errors.push(JSON.stringify(m).slice(0, 500)); },
      }));
      note('coding:start', TASK.id);
      await vscode.commands.executeCommand('migrapilot.governedCoding');
      cap('governed-coding');
      evidence.answer = report;

      // Verification is part of the product loop.
      const outcome = await vscode.commands.executeCommand('migrapilot.runTests');
      cap('test.run');
      note('tests', JSON.stringify(outcome?.kind === 'ran'
        ? { status: outcome.result.status, totals: outcome.result.totals }
        : { kind: outcome?.kind }));
      evidence.testOutcome = outcome?.kind === 'ran'
        ? { status: outcome.result.status, totals: outcome.result.totals, failures: outcome.result.failures }
        : { kind: outcome?.kind ?? 'none' };
    }
  } catch (error) {
    evidence.errors.push(String(error?.stack ?? error));
  } finally {
    evidence.wallMs = Date.now() - Date.parse(process.env.BENCH_STARTED ?? new Date().toISOString());
    fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  }
};
