import http from 'http';
import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { handleSseConnection } from './handlers/sse';
import { setupWebSocketServer } from './handlers/ws';

const app = express();

// 1. Servir los archivos estáticos del frontend desde la carpeta "public"
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// 2. Endpoint de Server-Sent Events (SSE) para la Pantalla
app.get('/events', handleSseConnection);

// 3. Crear un único servidor HTTP que une Express y WebSocket en el mismo puerto
const server = http.createServer(app);

// 4. Montar el servidor WebSocket sobre el mismo servidor HTTP (en la ruta /ws)
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocketServer(wss);

// 5. Iniciar el servidor
server.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  console.log(`- Participantes (WebSocket): http://localhost:${config.port}/`);
  console.log(`- Pantalla en vivo (SSE):    http://localhost:${config.port}/screen.html`);
  console.log(
    `- Catálogo: ${config.catalogBaseUrl} (timeout: ${config.catalogTimeoutMs}ms, delay simulado: ${config.catalogDelayMs}ms)`
  );
});