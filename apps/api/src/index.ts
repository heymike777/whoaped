import { serve, upgradeWebSocket } from '@hono/node-server';
import { WebSocketServer } from 'ws';

import { app } from './app.js';
import { activityRealtimeHub } from './realtime.js';

app.get('/realtime/activities', upgradeWebSocket(() => {
  let authenticated = false;
  let authenticationTimer: NodeJS.Timeout | undefined;
  return {
    onOpen(_event, ws) {
      authenticationTimer = setTimeout(() => {
        ws.close(4001, 'Authentication timeout');
      }, 10_000);
    },
    async onMessage(event, ws) {
      let message: { type?: string; token?: string };
      try {
        message = JSON.parse(String(event.data)) as { type?: string; token?: string };
      } catch {
        ws.close(4000, 'Invalid message');
        return;
      }

      if (!authenticated) {
        if (message.type !== 'auth' || !message.token) {
          ws.close(4001, 'Authentication required');
          return;
        }
        authenticated = await activityRealtimeHub.authenticateAndSubscribe(ws, message.token);
        if (authenticated && authenticationTimer) clearTimeout(authenticationTimer);
        return;
      }

      if (message.type === 'pong') return;
    },
    onClose(_event, ws) {
      if (authenticationTimer) clearTimeout(authenticationTimer);
      activityRealtimeHub.unsubscribe(ws);
    },
    onError(_event, ws) {
      if (authenticationTimer) clearTimeout(authenticationTimer);
      activityRealtimeHub.unsubscribe(ws);
    },
  };
}));

const port = Number(process.env.PORT ?? 8787);
const websocketServer = new WebSocketServer({ noServer: true });
const server = serve({ fetch: app.fetch, port, websocket: { server: websocketServer } }, (info) => {
  console.log(`WhoAped API listening on http://localhost:${info.port}`);
});

const shutdown = () => {
  activityRealtimeHub.stop().finally(() => {
    websocketServer.close();
    server.close();
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
