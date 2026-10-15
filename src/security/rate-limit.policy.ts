// Per client IP and controller handler. Durations are in milliseconds.
export const RATE_LIMITS = {
  api: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
  login: { limit: 10, ttl: 60_000, blockDuration: 60_000 },
  email: { limit: 5, ttl: 60_000, blockDuration: 60_000 },
  token: { limit: 10, ttl: 60_000, blockDuration: 60_000 },
  refresh: { limit: 30, ttl: 60_000, blockDuration: 60_000 },
  password: { limit: 5, ttl: 60_000, blockDuration: 60_000 },
} as const;
