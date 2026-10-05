import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { migrate } from './database/db.js';
import { httpError, router } from './http/routes.js';
import { reloadSchedules } from './scheduler/engine.js';
import { seed } from './seed.js';

migrate();
seed();
reloadSchedules();

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: ['http://127.0.0.1:5174', 'http://localhost:5174'] }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', router);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const body = httpError(error);
  res.status(body.status).json({ error: body.error });
});

app.listen(config.port, config.host, () => {
  console.log(`AI Task Automation Center API on http://${config.host}:${config.port}`);
});
