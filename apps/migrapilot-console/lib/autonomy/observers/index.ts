import { healthObserver } from "./health";
import { hidsEdrObserver } from "./hids-edr";
import { inventoryObserver } from "./inventory";
import { repoObserver } from "./repo";

import type { ObserverFn } from "../types";

export const autonomyObservers: ObserverFn[] = [repoObserver, inventoryObserver, healthObserver, hidsEdrObserver];
