const DEFAULT_E2E_BACKEND_API_URL = "http://127.0.0.1:18080";

export const E2E_BACKEND_API_URL = process.env.E2E_BACKEND_API_URL ?? DEFAULT_E2E_BACKEND_API_URL;

const parsedBackendURL = new URL(E2E_BACKEND_API_URL);

export const E2E_BACKEND_HOST = parsedBackendURL.hostname;
export const E2E_BACKEND_PORT = Number(parsedBackendURL.port || (parsedBackendURL.protocol === "https:" ? 443 : 80));
