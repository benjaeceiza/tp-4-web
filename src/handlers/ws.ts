import { WebSocket, WebSocketServer } from 'ws';
import { appState } from '../services/state';
import { ClientMessage, ServerMessage } from '../types/messages';
import { broadcastToScreens } from './sse';

// Mapa de cada socket conectado -> nombre del participante (null si aún no hizo 'join')
const connectedClients = new Map<WebSocket, string | null>();

/**
 * Envía un mensaje tipado a un único cliente WebSocket si su conexión sigue abierta.
 */
function sendToClient(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Envía un error privado solo al participante que mandó el mensaje inválido o fallido.
 */
function sendError(ws: WebSocket, code: string, message: string): void {
  sendToClient(ws, { type: 'error', code, message });
}

/**
 * Sincroniza a TODOS los participantes (que ya hicieron join) y a TODAS las pantallas SSE.
 */
function broadcastStateUpdate(): void {
  const updateMsg: ServerMessage = {
    type: 'state_update',
    participants: appState.getParticipants(),
    products: appState.getSortedProducts(),
  };

  const serialized = JSON.stringify(updateMsg);

  for (const [clientWs, participantName] of connectedClients.entries()) {
    // Solo enviamos actualizaciones de la lista a quienes ya ingresaron con nombre
    if (participantName !== null && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(serialized);
    }
  }

  // También actualizamos las pantallas conectadas por SSE
  broadcastToScreens();
}

/**
 * Valida estrictamente el texto crudo recibido por WebSocket.
 * Garantiza que ningún mensaje malformado desde la consola tire abajo el servidor.
 */
function parseAndValidateClientMessage(
  rawData: string
): { ok: true; msg: ClientMessage } | { ok: false; code: string; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return {
      ok: false,
      code: 'INVALID_JSON',
      message: 'El mensaje enviado no es un JSON válido.',
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'INVALID_FORMAT',
      message: 'El mensaje debe ser un objeto JSON.',
    };
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== 'string') {
    return {
      ok: false,
      code: 'MISSING_TYPE',
      message: 'El mensaje debe incluir un campo "type" de tipo string.',
    };
  }

  switch (obj.type) {
    case 'join': {
      if (typeof obj.name !== 'string') {
        return {
          ok: false,
          code: 'INVALID_PAYLOAD',
          message: 'El mensaje "join" requiere un campo "name" de tipo string.',
        };
      }
      return { ok: true, msg: { type: 'join', name: obj.name } };
    }

    case 'propose': {
      if (!Array.isArray(obj.productIds)) {
        return {
          ok: false,
          code: 'INVALID_PAYLOAD',
          message: 'El mensaje "propose" requiere un arreglo "productIds".',
        };
      }
      if (obj.productIds.length < 1 || obj.productIds.length > 10) {
        return {
          ok: false,
          code: 'OUT_OF_RANGE',
          message: 'Debés proponer entre 1 y 10 productos por vez.',
        };
      }
      const allValidIds = obj.productIds.every(
        (id) => typeof id === 'number' && Number.isInteger(id) && id > 0
      );
      if (!allValidIds) {
        return {
          ok: false,
          code: 'INVALID_PRODUCT_ID',
          message: 'Todos los IDs de "productIds" deben ser números enteros positivos.',
        };
      }
      return {
        ok: true,
        msg: { type: 'propose', productIds: obj.productIds as number[] },
      };
    }

    case 'vote':
    case 'unvote':
    case 'remove': {
      if (
        typeof obj.productId !== 'number' ||
        !Number.isInteger(obj.productId) ||
        obj.productId <= 0
      ) {
        return {
          ok: false,
          code: 'INVALID_PRODUCT_ID',
          message: `El mensaje "${obj.type}" requiere un "productId" entero positivo.`,
        };
      }
      return {
        ok: true,
        msg: { type: obj.type, productId: obj.productId },
      };
    }

    default:
      return {
        ok: false,
        code: 'UNKNOWN_TYPE',
        message: `Tipo de mensaje desconocido: "${obj.type}".`,
      };
  }
}

/**
 * Configura los eventos del servidor WebSocket.
 */
export function setupWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    connectedClients.set(ws, null);

    ws.on('message', async (data) => {
      const rawText = data.toString();
      const validation = parseAndValidateClientMessage(rawText);

      if (!validation.ok) {
        sendError(ws, validation.code, validation.message);
        return;
      }

      const msg = validation.msg;
      const currentName = connectedClients.get(ws) ?? null;

      // Caso 1: El usuario quiere entrar con un nombre ('join')
      if (msg.type === 'join') {
        if (currentName !== null) {
          sendError(ws, 'ALREADY_JOINED', `Ya ingresaste como "${currentName}".`);
          return;
        }

        const joinResult = appState.addParticipant(msg.name);
        if (!joinResult.ok) {
          sendError(ws, joinResult.code, joinResult.message);
          return;
        }

        connectedClients.set(ws, joinResult.name);

        // Enviar estado completo inicial al nuevo participante
        sendToClient(ws, {
          type: 'welcome',
          name: joinResult.name,
          participants: appState.getParticipants(),
          products: appState.getSortedProducts(),
        });

        // Avisar a todos los demás y a la pantalla que entró alguien nuevo
        broadcastStateUpdate();
        return;
      }

      // Para cualquier otra acción ('propose', 'vote', 'unvote', 'remove'), debe haber hecho 'join' primero
      if (currentName === null) {
        sendError(
          ws,
          'UNAUTHORIZED',
          'Debés ingresar con un nombre (mensaje "join") antes de realizar acciones.'
        );
        return;
      }

      // Caso 2: Proponer productos (asíncrono, no bloquea a otros clientes)
      if (msg.type === 'propose') {
        const result = await appState.proposeProducts(currentName, msg.productIds);

        // Si mientras esperaba al catálogo cerró la pestaña, no enviamos nada al socket cerrado
        if (connectedClients.has(ws)) {
          sendToClient(ws, {
            type: 'proposal_result',
            added: result.added,
            rejected: result.rejected,
          });
        }

        // Solo difundimos al resto si efectivamente se agregó al menos un producto
        if (result.added.length > 0) {
          broadcastStateUpdate();
        }
        return;
      }

      // Caso 3: Votar un producto
      if (msg.type === 'vote') {
        const res = appState.voteProduct(currentName, msg.productId);
        if (!res.ok) {
          sendError(ws, res.code, res.message);
          return;
        }
        broadcastStateUpdate();
        return;
      }

      // Caso 4: Retirar el voto
      if (msg.type === 'unvote') {
        const res = appState.unvoteProduct(currentName, msg.productId);
        if (!res.ok) {
          sendError(ws, res.code, res.message);
          return;
        }
        broadcastStateUpdate();
        return;
      }

      // Caso 5: Quitar un producto de la lista
      if (msg.type === 'remove') {
        const res = appState.removeProduct(currentName, msg.productId);
        if (!res.ok) {
          sendError(ws, res.code, res.message);
          return;
        }
        broadcastStateUpdate();
        return;
      }
    });

    // Cuando el participante cierra la pestaña o pierde conexión
    ws.on('close', () => {
      const name = connectedClients.get(ws);
      connectedClients.delete(ws);

      if (name) {
        appState.removeParticipant(name);
        broadcastStateUpdate();
      }
    });

    ws.on('error', () => {
      // Evitar que un error de socket cierre el proceso de Node
    });
  });
}