import { config } from '../config';
import { ProposalRejectReason } from '../types/messages';

export interface CatalogProductData {
  id: number;
  title: string;
  price: number;
  thumbnail: string;
}

export type CatalogFetchResult =
  | { ok: true; product: CatalogProductData }
  | { ok: false; id: number; reason: ProposalRejectReason; message: string };

/**
 * Consulta un único producto en DummyJSON con timeout y soporte de delay simulado.
 */
export async function fetchProductFromCatalog(id: number): Promise<CatalogFetchResult> {
  const baseUrl = config.catalogBaseUrl.replace(/\/+$/, '');
  const delayQuery = config.catalogDelayMs > 0 ? `?delay=${config.catalogDelayMs}` : '';
  const url = `${baseUrl}/${id}${delayQuery}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.catalogTimeoutMs),
    });

    if (response.status === 404) {
      return {
        ok: false,
        id,
        reason: 'not_found',
        message: `El producto #${id} no existe en el catálogo.`,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        id,
        reason: 'catalog_error',
        message: `El catálogo respondió con error HTTP ${response.status} para el producto #${id}.`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (
      typeof data.id !== 'number' ||
      typeof data.title !== 'string' ||
      typeof data.price !== 'number'
    ) {
      return {
        ok: false,
        id,
        reason: 'catalog_error',
        message: `Datos incompletos del catálogo para el producto #${id}.`,
      };
    }

    const thumbnail =
      typeof data.thumbnail === 'string'
        ? data.thumbnail
        : Array.isArray(data.images) && typeof data.images[0] === 'string'
          ? data.images[0]
          : '';

    return {
      ok: true,
      product: {
        id: data.id,
        title: data.title,
        price: data.price,
        thumbnail,
      },
    };
  } catch (err: unknown) {
    // AbortSignal.timeout lanza un DOMException con name === 'TimeoutError' (o 'AbortError')
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return {
        ok: false,
        id,
        reason: 'timeout',
        message: `El catálogo no respondió a tiempo (máx ${config.catalogTimeoutMs}ms) para el producto #${id}.`,
      };
    }

    return {
      ok: false,
      id,
      reason: 'catalog_error',
      message: `No se pudo conectar con el catálogo para el producto #${id}.`,
    };
  }
}

/**
 * Consulta múltiples productos en simultáneo (en paralelo).
 */
export async function fetchManyProductsFromCatalog(ids: number[]): Promise<CatalogFetchResult[]> {
  return Promise.all(ids.map((id) => fetchProductFromCatalog(id)));
}