import fs from "node:fs";
import path from "node:path";

import type { MissionRecord } from "./types";

interface MissionState {
  missions: MissionRecord[];
}

const statePath = path.resolve(process.cwd(), ".data", "missions.json");

function ensureStateFile(): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  if (!fs.existsSync(statePath)) {
    const initial: MissionState = { missions: [] };
    fs.writeFileSync(statePath, JSON.stringify(initial, null, 2), "utf8");
  }
}

function readState(): MissionState {
  ensureStateFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as MissionState;
    return {
      missions: parsed.missions ?? []
    };
  } catch {
    return { missions: [] };
  }
}

function writeState(state: MissionState): void {
  ensureStateFile();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function createMission(record: MissionRecord): MissionRecord {
  const state = readState();
  state.missions.unshift(record);
  state.missions = state.missions.slice(0, 200);
  writeState(state);
  return record;
}

export function getMission(missionId: string): MissionRecord | null {
  return readState().missions.find((mission) => mission.missionId === missionId) ?? null;
}

export function listMissions(limit = 100): MissionRecord[] {
  return readState().missions.slice(0, limit);
}

export function updateMission(missionId: string, updater: (mission: MissionRecord) => MissionRecord): MissionRecord | null {
  const state = readState();
  const index = state.missions.findIndex((mission) => mission.missionId === missionId);
  if (index < 0) {
    return null;
  }
  const updated = updater(state.missions[index]);
  updated.updatedAt = new Date().toISOString();
  state.missions[index] = updated;
  writeState(state);
  return updated;
}
