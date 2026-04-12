import { pilotProxy } from "@/lib/server/pilotProxy";
export const POST = pilotProxy("/api/ops/approvals/reject", "POST");
