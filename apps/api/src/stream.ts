import { createServer } from 'node:http';
import { ParsedStreamSupervisor } from './services/stream-supervisor.js';

const parsedPort = Number(process.env.PORT);
const HEALTH_PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 8080;

const supervisor = new ParsedStreamSupervisor();
await supervisor.start();

const healthServer = createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  const healthy = supervisor.isHealthy();
  response.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ ok: healthy }));
});
healthServer.listen(HEALTH_PORT, '0.0.0.0', () => {
  console.log(`Stream worker health endpoint listening on port ${HEALTH_PORT}`);
});

const shutdown = () => {
  supervisor.stop();
  healthServer.close(() => {
    process.exitCode = 0;
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
