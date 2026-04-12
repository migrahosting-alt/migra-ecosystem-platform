import { pilotProxy } from "@/lib/server/pilotProxy";
export const GET = pilotProxy("/api/brands");
export const POST = pilotProxy("/api/brands", "POST");
