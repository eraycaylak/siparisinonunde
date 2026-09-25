// buildApp: Fastify + Zod type provider + çerez + hata biçimi + oturum + rotalar. Testler de bunu kullanır.

import './types';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { createDb, type DbHandle } from '@siparis/db';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { mkdirSync } from 'node:fs';
import type { DestinationStream } from 'pino';
import type { Config } from './config';
import { registerAllJobs } from './jobs/index';
import { logSerializers } from './lib/log';
import { BranchEventHub } from './lib/sse';
import { authPlugin } from './plugins/auth';
import { registerErrorHandler } from './plugins/error-handler';
import { impersonationAuditPlugin } from './plugins/impersonation-audit';
import adminRoutes from './routes/admin/index';
import authRoutes from './routes/auth';
import courierRoutes from './routes/courier/index';
import devRoutes from './routes/dev/index';
import healthRoutes from './routes/health';
import panelConversationRoutes from './routes/panel/conversations';
import panelCustomerRoutes from './routes/panel/customers';
import panelMenuRoutes from './routes/panel/menu';
import panelOnboardingRoutes from './routes/panel/onboarding';
import panelOrderRoutes from './routes/panel/orders';
import panelPushRoutes from './routes/panel/push';
import panelReportRoutes from './routes/panel/reports';
import panelSettingsRoutes from './routes/panel/settings';
import panelStaffRoutes from './routes/panel/staff';
import panelStreamRoutes from './routes/panel/stream';
import panelWhatsappRoutes from './routes/panel/whatsapp';
import publicRoutes from './routes/public/index';
import storeOrderRoutes from './routes/store/orders';
import storefrontRoutes from './routes/store/storefront';
import webhookWaRoutes from './routes/webhooks/wa';

export interface BuildAppOptions {
  config: Config;
  /** Verilmezse config.DATABASE_URL ile açılır ve app kapanınca kapatılır. */
  db?: DbHandle;
  /** false: log yok (testler); verilmezse config.LOG_LEVEL */
  logger?: FastifyServerOptions['logger'];
  /** Log çıktısı (testler; verilmezse stdout) */
  logStream?: DestinationStream;
}

export const API_PREFIX = '/api/v1';

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = opts;
  const ownsDb = !opts.db;
  const handle = opts.db ?? createDb(config.DATABASE_URL, { applicationName: 'siparis-api' });

  const logger: FastifyServerOptions['logger'] =
    opts.logger !== undefined
      ? opts.logger
      : {
          level: config.LOG_LEVEL,
          redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'], remove: true },
          // URL'deki telefon/arama metni ve yol belirteçleri maskeli
          serializers: logSerializers,
          ...(opts.logStream ? { stream: opts.logStream } : {}),
          ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } } : {}),
        };

  const app = Fastify({
    logger,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    forceCloseConnections: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);
  app.decorate('db', handle.db);
  app.decorate('sql', handle.sql);
  const hub = new BranchEventHub(handle.sql, app.log);
  app.decorate('branchEvents', hub);

  // SSE bağlantılarını sunucu kapanmadan önce bitir
  app.addHook('preClose', async () => {
    await hub.close();
  });
  app.addHook('onClose', async () => {
    if (ownsDb) await handle.close();
  });

  registerErrorHandler(app);
  await app.register(cookie);
  await app.register(authPlugin);
  // Destek erişimi: her panel isteği audit_log'a (05 A-09)
  await app.register(impersonationAuditPlugin);

  // İş işleyicileri ve sipariş olayı abonelikleri (API sürecinde de gerekli: transitionOrder kancaları)
  registerAllJobs();

  await app.register(healthRoutes, { prefix: API_PREFIX });
  await app.register(authRoutes, { prefix: `${API_PREFIX}/auth` });

  // Storefront (herkese açık)
  await app.register(storefrontRoutes, { prefix: `${API_PREFIX}/store` });
  await app.register(storeOrderRoutes, { prefix: `${API_PREFIX}/store` });

  // Panel (oturum + tenant)
  const panel = `${API_PREFIX}/panel`;
  await app.register(panelStreamRoutes, { prefix: panel });
  await app.register(panelOrderRoutes, { prefix: panel });
  await app.register(panelMenuRoutes, { prefix: panel });
  await app.register(panelSettingsRoutes, { prefix: panel });
  await app.register(panelStaffRoutes, { prefix: panel });
  await app.register(panelReportRoutes, { prefix: panel });
  await app.register(panelOnboardingRoutes, { prefix: panel });
  await app.register(panelCustomerRoutes, { prefix: panel });
  await app.register(panelConversationRoutes, { prefix: panel });
  await app.register(panelWhatsappRoutes, { prefix: panel });
  await app.register(panelPushRoutes, { prefix: panel });

  await app.register(courierRoutes, { prefix: `${API_PREFIX}/courier` });
  await app.register(adminRoutes, { prefix: `${API_PREFIX}/admin` });
  await app.register(publicRoutes, { prefix: `${API_PREFIX}/public` });
  await app.register(webhookWaRoutes, { prefix: `${API_PREFIX}/webhooks/wa` });
  // Kimlik doğrulamasız geliştirici uçları üretimde hiçbir koşulda açılmaz (loadConfig de reddeder)
  if (config.DEV_TOOLS && config.NODE_ENV !== 'production') {
    await app.register(devRoutes, { prefix: `${API_PREFIX}/dev` });
  }

  // Yüklenen görseller: /api/v1/uploads/*
  mkdirSync(config.uploadDirAbs, { recursive: true });
  await app.register(fastifyStatic, {
    root: config.uploadDirAbs,
    prefix: `${API_PREFIX}/uploads/`,
    decorateReply: false,
    index: false,
    list: false,
    maxAge: '1d',
  });

  return app;
}
