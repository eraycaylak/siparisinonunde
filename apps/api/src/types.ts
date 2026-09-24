// Fastify tip genişletmeleri.

import type { PlatformRole, SessionKind, TenantRole } from '@siparis/core';
import type { Database, Sql } from '@siparis/db';
import type { Config } from './config';
import type { BranchEventHub } from './lib/sse';

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isPlatformAdmin: boolean;
  platformRole: PlatformRole | null;
}

export interface AuthSession {
  id: string;
  kind: SessionKind;
  expiresAt: Date;
  readOnly: boolean;
  impersonatorUserId: string | null;
  tenantId: string | null;
}

/** 14 §5: request.auth */
export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
  /** Seçili tenant (üyelik doğrulanmış) */
  tenantId: string | null;
  role: TenantRole | null;
  /** Üyelik şube kısıtı (null = tüm şubeler) */
  branchId: string | null;
  isPlatformAdmin: boolean;
  readOnly: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
    sql: Sql;
    branchEvents: BranchEventHub;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
