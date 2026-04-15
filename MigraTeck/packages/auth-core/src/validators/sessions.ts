import { z } from "zod";
import { uuidSchema } from "./shared";

export const sessionIdSchema = z.object({
  id: uuidSchema,
});
