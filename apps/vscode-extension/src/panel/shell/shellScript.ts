// MigraPilot Shell — composed webview script.
//
// The client is assembled from per-region fragments (core / regions / chat /
// agent / composer) so no single file owns the whole UI. The composed result is
// asserted to be valid JavaScript by a unit test, the same guarantee the Agent
// Mode webview script already has.
//
// The ONLY data baked into the script is static UI metadata — the slash-command
// catalogue and the icon set. Nothing from the backend, the workspace, or the
// activation is ever interpolated here.

import { SLASH_COMMANDS } from './composerModel.js';
import { ICON_PATHS } from './icons.js';
import { agentScript } from './script/agent.js';
import { chatScript } from './script/chat.js';
import { composerScript } from './script/composer.js';
import { contextPanelsScript } from './script/contextPanels.js';
import { coreScript } from './script/core.js';
import { regionsScript } from './script/regions.js';

const SLASH_TOKEN = 'SLASH_COMMANDS_JSON';
const ICONS_TOKEN = 'ICON_PATHS_JSON';

/** Inject the shared static metadata into a fragment. */
export function injectStaticData(fragment: string): string {
  return fragment
    .replace(SLASH_TOKEN, JSON.stringify(SLASH_COMMANDS))
    .replace(ICONS_TOKEN, JSON.stringify(ICON_PATHS));
}

export function shellScript(): string {
  const fragments = [
    '(function () {',
    "'use strict';",
    coreScript(),
    regionsScript(),
    contextPanelsScript(),
    chatScript(),
    agentScript(),
    composerScript(),
    '})();',
  ];
  return injectStaticData(fragments.join('\n'));
}
