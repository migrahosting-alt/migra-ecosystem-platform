import { pilotProxy } from "@/lib/server/pilotProxy";
export const POST = pilotProxy("/api/autonomy/run-mission", "POST");
