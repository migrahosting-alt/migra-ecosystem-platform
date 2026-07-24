import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

export const ALLOWED_ORIGINS = [
  'https://pilot.migrateck.com',
  'https://migrateck.com',
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3377', 'http://localhost:3399', 'http://localhost:3000']
    : []),
];

export async function registerMigraPilotCors(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: (origin, cb) => {
      // Do not throw here. Throwing from @fastify/cors bypasses the Agent route
      // authorization guard and is handled as a generic 500. Returning false
      // omits CORS headers and lets local Agent routes return their stable 403.
      cb(null, !origin || ALLOWED_ORIGINS.includes(origin));
    },
    credentials: true,
  });
}
