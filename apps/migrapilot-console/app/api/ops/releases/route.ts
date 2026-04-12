import { pilotProxy } from "@/lib/server/pilotProxy";
export const GET = pilotProxy("/api/ops/releases");
export const POST = pilotProxy("/api/ops/releases", "POST");
