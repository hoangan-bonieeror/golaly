/**
 * @golaly/client — the part of talking to the API that is the same on every platform: the typed REST client,
 * errors, query keys. React hooks live in "@golaly/client/react".
 */
export { ApiError, FALLBACK_MESSAGES, GENERIC_ERROR, OFFLINE_ERROR } from "./errors";
export { createApiClient, CSRF_HEADER, type Api, type ApiClientConfig, type ClientAuth } from "./http";
export { keys } from "./keys";
export { qs } from "./qs";
