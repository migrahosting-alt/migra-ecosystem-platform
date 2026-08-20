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

import { slashCommandsFor } from './composerModel.js';
import { ICON_PATHS } from './icons.js';
import { agentScript } from './script/agent.js';
import { chatScript } from './script/chat.js';
import { composerScript } from './script/composer.js';
import { contextPanelsScript } from './script/contextPanels.js';
import { coreScript } from './script/core.js';
import { regionsScript } from './script/regions.js';
import { workspaceScript } from './script/workspace.js';

const SLASH_TOKEN = 'SLASH_COMMANDS_JSON';
const ICONS_TOKEN = 'ICON_PATHS_JSON';

/**
 * Inject the shared static metadata into a fragment.
 *
 * The slash catalogue is baked in per MODE. Filtering it in the client instead
 * would ship the engineering entries to every install and rely on the webview to
 * hide them, which is a display rule, not a boundary.
 */
export function injectStaticData(fragment: string, developerMode = false): string {
  return fragment
    .replace(SLASH_TOKEN, JSON.stringify(slashCommandsFor(developerMode)))
    .replace(ICONS_TOKEN, JSON.stringify(ICON_PATHS));
}

export function shellScript(developerMode = false): string {
  const fragments = [
    '(function () {',
    "'use strict';",
    coreScript(),
    regionsScript(),
    contextPanelsScript(),
    chatScript(),
    agentScript(),
    workspaceScript(),
    composerScript(),
    '})();',
  ];
  return injectStaticData(fragments.join('\n'), developerMode);
}
