import { pilotProxy } from "@/lib/server/pilotProxy";
export const POST = pilotProxy("/api/autonomy/tick", "POST");
