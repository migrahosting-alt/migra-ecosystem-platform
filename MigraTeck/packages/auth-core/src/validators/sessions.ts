import { z } from "zod";
import { uuidSchema } from "./shared.js";

export const sessionIdSchema = z.object({
  id: uuidSchema,
});
