export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  CONFIG: 2,
  AUTH: 3,
  SMTP: 4,
  STORAGE: 5,
  DRY_RUN_WOULD_SEND: 10,
} as const;
