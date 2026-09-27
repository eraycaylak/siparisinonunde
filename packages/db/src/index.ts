// @siparis/db — şema, istemci, migration ve seed yardımcıları.
export * from './client';
export * from './schema/index';
export * from './helpers';
export { runMigrations, listMigrationFiles, MIGRATIONS_DIR } from './migrate';
export { resetDatabase, dropSchema, assertResettable, isResettableDbName } from './reset';
export { hashPasswordForSeed, resolveSeedPassword, seedPasswordMatches, SEED_PASSWORD_MIN_LENGTH } from './seed-password';
export {
  seedDemo,
  seedAdminOnly,
  resolveSeedMode,
  assertSeedAllowed,
  SEED_MODES,
  DEMO,
  LEGACY_DEMO_EMAILS,
  type SeedOptions,
  type SeedResult,
  type SeedMode,
  type AdminSeedOptions,
  type AdminSeedResult,
} from './seed';
export {
  ensureProductionFlags,
  productionFlagDefaults,
  isSmsConfigured,
  countDemoTenants,
  flagOutcomeNote,
  FLAG_DESCRIPTIONS,
  type FlagOutcome,
  type ProductionFlagKey,
  type ProductionFlagOptions,
} from './bootstrap';
