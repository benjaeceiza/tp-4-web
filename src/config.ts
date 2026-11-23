import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 3000,
  catalogBaseUrl: process.env.CATALOG_BASE_URL || 'https://dummyjson.com/products',
  catalogTimeoutMs: Number(process.env.CATALOG_TIMEOUT_MS) || 2500,
  catalogDelayMs: Number(process.env.CATALOG_DELAY_MS) || 0,
};