import { Request, Response } from 'express';
import { appState } from '../services/state';

// Conjunto de todas las pantallas (TV/proyectores) conectadas actualmente
const sseClients = new Set<Response>();

/**
 * Envía un evento SSE a una respuesta HTTP abierta.
 */
function sendSseEvent(res: Response, eventName: string, data: unknown): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Endpoint GET /events para que la Pantalla se suscriba con EventSource.
 */
export function handleSseConnection(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 1. Registrar la pantalla conectada
  sseClients.add(res);

  // 2. Enviar el estado actual apenas se conecta (sin esperar a que alguien vote)
  sendSseEvent(res, 'state_update', appState.getScreenPayload());

  // 3. Liberar recursos cuando se cierra la pestaña de la pantalla
  req.on('close', () => {
    sseClients.delete(res);
    res.end();
  });
}

/**
 * Notifica a todas las pantallas conectadas el nuevo ranking y cantidad de participantes.
 */
export function broadcastToScreens(): void {
  if (sseClients.size === 0) return;

  const payload = appState.getScreenPayload();
  for (const client of sseClients) {
    sendSseEvent(client, 'state_update', payload);
  }
}