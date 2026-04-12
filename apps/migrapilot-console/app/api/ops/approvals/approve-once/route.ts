import { pilotProxy } from "@/lib/server/pilotProxy";
export const POST = pilotProxy("/api/ops/approvals/approve-once", "POST");
