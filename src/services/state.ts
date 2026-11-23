import { ProductItem, ProposalRejection, ScreenStatePayload } from '../types/messages';
import { fetchManyProductsFromCatalog } from './catalog';

class AppState {
  // Mapa de nombreEnMinusculas -> nombreOriginal (para evitar "Juan" y "juan" repetidos)
  private participants = new Map<string, string>();

  // Mapa de productId -> ProductItem
  private products = new Map<number, ProductItem>();

  /**
   * Valida y registra un nuevo participante.
   * Regla: entre 2 y 20 caracteres, sin nombres repetidos (case-insensitive).
   */
  addParticipant(rawName: string): { ok: true; name: string } | { ok: false; code: string; message: string } {
    const name = rawName.trim();

    if (name.length < 2 || name.length > 20) {
      return {
        ok: false,
        code: 'INVALID_NAME',
        message: 'El nombre debe tener entre 2 y 20 caracteres.',
      };
    }

    const key = name.toLowerCase();
    if (this.participants.has(key)) {
      return {
        ok: false,
        code: 'NAME_TAKEN',
        message: `El nombre "${name}" ya está en uso por otro participante conectado.`,
      };
    }

    this.participants.set(key, name);
    return { ok: true, name };
  }

  /**
   * Elimina a un participante cuando cierra la pestaña o se desconecta.
   */
  removeParticipant(name: string): boolean {
    return this.participants.delete(name.toLowerCase());
  }

  /**
   * Devuelve la lista de nombres de participantes conectados.
   */
  getParticipants(): string[] {
    return Array.from(this.participants.values());
  }

  /**
   * Devuelve la lista de productos ordenada por cantidad de votos (de mayor a menor).
   * En caso de empate en votos, mantiene el orden por ID o llegada.
   */
  getSortedProducts(): ProductItem[] {
    return Array.from(this.products.values())
      .map((p) => ({ ...p, votes: [...p.votes] }))
      .sort((a, b) => b.votes.length - a.votes.length);
  }

  /**
   * Propone entre 1 y 10 productos en simultáneo.
   * Filtra los que ya existen antes de llamar al catálogo, y vuelve a verificar
   * al recibir la respuesta por si otro participante propuso el mismo ID al mismo tiempo.
   */
  async proposeProducts(
    proposedBy: string,
    rawIds: number[]
  ): Promise<{ added: number[]; rejected: ProposalRejection[] }> {
    const added: number[] = [];
    const rejected: ProposalRejection[] = [];

    // 1. Eliminar IDs duplicados dentro del mismo envío del cliente (ej. [1, 1])
    const uniqueIds: number[] = [];
    const seenInBatch = new Set<number>();

    for (const id of rawIds) {
      if (seenInBatch.has(id)) {
        rejected.push({
          id,
          reason: 'already_exists',
          message: `El producto #${id} fue enviado repetido en la misma propuesta.`,
        });
        continue;
      }
      seenInBatch.add(id);

      // 2. Si ya está en la lista antes de consultar al catálogo, rechazamos sin gastar red
      if (this.products.has(id)) {
        rejected.push({
          id,
          reason: 'already_exists',
          message: `El producto #${id} ya está en la lista.`,
        });
        continue;
      }

      uniqueIds.push(id);
    }

    // 3. Consultar al catálogo en simultáneo solo los IDs que no estaban en la lista
    if (uniqueIds.length > 0) {
      const results = await fetchManyProductsFromCatalog(uniqueIds);

      for (const res of results) {
        if (!res.ok) {
          rejected.push({
            id: res.id,
            reason: res.reason,
            message: res.message,
          });
          continue;
        }

        const { id, title, price, thumbnail } = res.product;

        // 4. Chequeo de concurrencia post-await:
        // ¿Otro participante agregó este mismo producto mientras esperábamos a DummyJSON?
        if (this.products.has(id)) {
          rejected.push({
            id,
            reason: 'already_exists',
            message: `El producto #${id} ("${title}") acaba de ser agregado por otro participante.`,
          });
          continue;
        }

        this.products.set(id, {
          id,
          title,
          price,
          thumbnail,
          proposedBy,
          votes: [],
        });
        added.push(id);
      }
    }

    return { added, rejected };
  }

  /**
   * Agrega el voto de un participante a un producto (máximo 1 vez por participante).
   */
  voteProduct(
    participantName: string,
    productId: number
  ): { ok: true } | { ok: false; code: string; message: string } {
    const product = this.products.get(productId);
    if (!product) {
      return {
        ok: false,
        code: 'PRODUCT_NOT_FOUND',
        message: `El producto #${productId} no está en la lista.`,
      };
    }

    if (product.votes.includes(participantName)) {
      return {
        ok: false,
        code: 'ALREADY_VOTED',
        message: `Ya votaste el producto "${product.title}".`,
      };
    }

    product.votes.push(participantName);
    return { ok: true };
  }

  /**
   * Retira el voto de un participante de un producto.
   */
  unvoteProduct(
    participantName: string,
    productId: number
  ): { ok: true } | { ok: false; code: string; message: string } {
    const product = this.products.get(productId);
    if (!product) {
      return {
        ok: false,
        code: 'PRODUCT_NOT_FOUND',
        message: `El producto #${productId} no está en la lista.`,
      };
    }

    const idx = product.votes.indexOf(participantName);
    if (idx === -1) {
      return {
        ok: false,
        code: 'NOT_VOTED',
        message: `No tenés ningún voto registrado en "${product.title}".`,
      };
    }

    product.votes.splice(idx, 1);
    return { ok: true };
  }

  /**
   * Quita un producto de la lista.
   * Regla elegida: Solo puede quitarlo el participante que lo propuso.
   */
  removeProduct(
    participantName: string,
    productId: number
  ): { ok: true } | { ok: false; code: string; message: string } {
    const product = this.products.get(productId);
    if (!product) {
      return {
        ok: false,
        code: 'PRODUCT_NOT_FOUND',
        message: `El producto #${productId} no está en la lista.`,
      };
    }

    if (product.proposedBy !== participantName) {
      return {
        ok: false,
        code: 'FORBIDDEN_REMOVE',
        message: `Solo ${product.proposedBy} (quien lo propuso) puede quitar "${product.title}".`,
      };
    }

    this.products.delete(productId);
    return { ok: true };
  }

  /**
   * Arma el payload resumido para la Pantalla (SSE).
   */
  getScreenPayload(): ScreenStatePayload {
    const participants = this.getParticipants();
    const sorted = this.getSortedProducts();

    return {
      participantCount: participants.length,
      participants,
      products: sorted.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        thumbnail: p.thumbnail,
        proposedBy: p.proposedBy,
        voteCount: p.votes.length,
      })),
    };
  }
}

export const appState = new AppState();