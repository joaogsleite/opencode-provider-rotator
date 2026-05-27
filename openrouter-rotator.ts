import type { Plugin } from "@opencode-ai/plugin";

type RotatorOptions = {
  keysEnv?: string;
  blockedForMs?: number;
  retryStatuses?: number[];
  retryErrorCodes?: string[];
};

type OpenRouterRotatorConfig = {
  rotatorKeys?: string[] | string;
  rotatorKeysEnv?: string;
  rotatorBlockedForMs?: number;
  rotatorRetryStatuses?: number[];
  rotatorRetryErrorCodes?: string[];
};

type Account = {
  key: string;
  blockedUntil: number;
};

const DEFAULT_KEYS_ENV = "OPENROUTER_API_KEYS";
const DEFAULT_BLOCKED_FOR_MS = 60 * 60 * 1000;
const DEFAULT_RETRY_STATUSES = new Set([
  402, 408, 409, 425, 429, 500, 502, 503, 504,
]);
const DEFAULT_RETRY_ERROR_CODES = new Set([
  "insufficient_credits",
  "rate_limit_exceeded",
  "quota_exceeded",
  "context_length_exceeded",
]);

function parseKeys(value: string | undefined) {
  return (value ?? "")
    .split(/[\n,]/)
    .map((key) => key.trim())
    .filter(Boolean);
}

function normalizeKeys(value: string[] | string | undefined) {
  if (Array.isArray(value))
    return value.map((key) => key.trim()).filter(Boolean);
  return parseKeys(value);
}

function cloneHeaders(headers: HeadersInit | undefined) {
  return new Headers(headers);
}

async function readOpenRouterError(response: Response) {
  try {
    const body = await response.clone().json();
    const code = body?.error?.code ?? body?.code;
    const message = body?.error?.message ?? body?.message;
    return {
      code: typeof code === "string" ? code : undefined,
      message: typeof message === "string" ? message : undefined,
    };
  } catch {
    return {};
  }
}

function createRotatingFetch(
  accounts: Account[],
  options: Required<RotatorOptions>,
) {
  let cursor = 0;

  function nextAccount() {
    const now = Date.now();
    for (let attempts = 0; attempts < accounts.length; attempts += 1) {
      const index = (cursor + attempts) % accounts.length;
      const account = accounts[index];
      if (account.blockedUntil > now) continue;
      cursor = (index + 1) % accounts.length;
      return account;
    }

    const account = accounts[cursor % accounts.length];
    cursor = (cursor + 1) % accounts.length;
    return account;
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let lastResponse: Response | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < accounts.length; attempt += 1) {
      const account = nextAccount();
      const headers = cloneHeaders(init?.headers);
      headers.set("Authorization", `Bearer ${account.key}`);

      try {
        const response = await fetch(input, { ...init, headers });
        if (!options.retryStatuses.includes(response.status)) return response;

        const error = await readOpenRouterError(response);
        if (error.code && !options.retryErrorCodes.includes(error.code))
          return response;

        account.blockedUntil = Date.now() + options.blockedForMs;
        lastResponse = response;
      } catch (error) {
        account.blockedUntil = Date.now() + options.blockedForMs;
        lastError = error;
      }
    }

    if (lastResponse) return lastResponse;
    throw lastError;
  };
}

export const OpenRouterRotator: Plugin = async ({ client }, pluginOptions) => {
  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      cfg.provider.openrouter ??= {};
      cfg.provider.openrouter.options ??= {};

      const rotator = cfg.provider.openrouter
        .options as OpenRouterRotatorConfig;
      const keysEnv =
        rotator.rotatorKeysEnv ??
        (typeof pluginOptions?.keysEnv === "string"
          ? pluginOptions.keysEnv
          : DEFAULT_KEYS_ENV);
      const options: Required<RotatorOptions> = {
        keysEnv,
        blockedForMs:
          typeof rotator.rotatorBlockedForMs === "number"
            ? rotator.rotatorBlockedForMs
            : typeof pluginOptions?.blockedForMs === "number"
              ? pluginOptions.blockedForMs
              : DEFAULT_BLOCKED_FOR_MS,
        retryStatuses: Array.isArray(rotator.rotatorRetryStatuses)
          ? rotator.rotatorRetryStatuses.filter(
              (status): status is number => typeof status === "number",
            )
          : Array.isArray(pluginOptions?.retryStatuses)
            ? pluginOptions.retryStatuses.filter(
                (status): status is number => typeof status === "number",
              )
            : [...DEFAULT_RETRY_STATUSES],
        retryErrorCodes: Array.isArray(rotator.rotatorRetryErrorCodes)
          ? rotator.rotatorRetryErrorCodes.filter(
              (code): code is string => typeof code === "string",
            )
          : Array.isArray(pluginOptions?.retryErrorCodes)
            ? pluginOptions.retryErrorCodes.filter(
                (code): code is string => typeof code === "string",
              )
            : [...DEFAULT_RETRY_ERROR_CODES],
      };

      const accounts = [
        ...normalizeKeys(rotator.rotatorKeys),
        ...parseKeys(process.env[options.keysEnv]),
      ].map((key) => ({
        key,
        blockedUntil: 0,
      }));

      delete rotator.rotatorKeys;
      delete rotator.rotatorKeysEnv;
      delete rotator.rotatorBlockedForMs;
      delete rotator.rotatorRetryStatuses;
      delete rotator.rotatorRetryErrorCodes;

      if (accounts.length === 0) {
        await client.app.log({
          body: {
            service: "openrouter-rotator",
            level: "warn",
            message: `${options.keysEnv} is empty; OpenRouter key rotation is disabled`,
          },
        });
        return;
      }

      cfg.provider.openrouter.options.fetch = createRotatingFetch(
        accounts,
        options,
      );

      await client.app.log({
        body: {
          service: "openrouter-rotator",
          level: "info",
          message: `Loaded ${accounts.length} OpenRouter accounts from ${options.keysEnv}`,
        },
      });
    },
  };
};
