// --- MODELOS DE DOMINIO ---

export interface ProductItem {
    id: number;
    title: string;
    price: number;
    thumbnail: string;
    proposedBy: string; // Nombre del participante que lo propuso
    votes: string[];    // Lista de nombres de participantes que lo votaron
}

export type ProposalRejectReason =
    | 'not_found'        // El producto no existe en DummyJSON (404)
    | 'timeout'          // El catálogo tardó más que CATALOG_TIMEOUT_MS
    | 'already_exists'   // Ya estaba en la lista compartida
    | 'catalog_error';   // Otro error de red o HTTP 500 del catálogo

export interface ProposalRejection {
    id: number;
    reason: ProposalRejectReason;
    message: string;
}

// --- MENSAJES CLIENTE -> SERVIDOR (WebSocket) ---

export type ClientMessage =
    | { type: 'join'; name: string }
    | { type: 'propose'; productIds: number[] }
    | { type: 'vote'; productId: number }     // Vota o retira el voto (toggle) o podemos separarlo en vote / unvote
    | { type: 'unvote'; productId: number }
    | { type: 'remove'; productId: number };

// --- MENSAJES SERVIDOR -> CLIENTE (WebSocket) ---

export type ServerMessage =
    // Confirmación al entrar + estado inicial completo
    | {
        type: 'welcome';
        name: string;
        participants: string[];
        products: ProductItem[];
    }
    // Actualización global cuando cambia la lista de productos o participantes
    | {
        type: 'state_update';
        participants: string[];
        products: ProductItem[];
    }
    // Respuesta privada a quien hizo una propuesta (con los agregados y los fallos parciales)
    | {
        type: 'proposal_result';
        added: number[];
        rejected: ProposalRejection[];
    }
    // Error privado cuando un mensaje es inválido o una acción no está permitida
    | {
        type: 'error';
        code: string;
        message: string;
    };

// --- EVENTOS SERVIDOR -> PANTALLA (SSE) ---

export interface ScreenStatePayload {
    participantCount: number;
    participants: string[];
    products: Array<{
        id: number;
        title: string;
        price: number;
        thumbnail: string;
        proposedBy: string;
        voteCount: number;
    }>;
}