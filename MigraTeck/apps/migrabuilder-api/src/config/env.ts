import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3200),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().default("http://localhost:3201"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  host: parsed.data.HOST,
  databaseUrl: parsed.data.DATABASE_URL,
  jwtSecret: parsed.data.JWT_SECRET,
  jwtPublicKey: parsed.data.JWT_PUBLIC_KEY,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((s) => s.trim()),
};
