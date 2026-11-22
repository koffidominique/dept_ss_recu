import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createAuthAndSystemRouter } from './server/routes/authAndSystem.ts';
import { createCatalogRouter } from './server/routes/catalog.ts';
import { createCommerceRouter } from './server/routes/commerce.ts';
import { createOrdersRouter } from './server/routes/orders.ts';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '16mb' }));

  app.use(createAuthAndSystemRouter());
  app.use(createCatalogRouter());
  app.use(createCommerceRouter());
  app.use(createOrdersRouter());

  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Route API introuvable.' });
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtml = path.join(distDir, 'index.html');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(indexHtml);
      });
    }
  }

  app.listen(port, host, () => {
    console.log(`DEPOTPRO ERP listening on http://${host}:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start DEPOTPRO server:', err);
  process.exit(1);
});
