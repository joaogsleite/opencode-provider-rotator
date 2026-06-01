import type { Config, Plugin, PluginInput } from "@opencode-ai/plugin";

type RotatorOptions = {
  keysEnv?: string;
  blockedForMs?: number;
  retryStatuses?: number[];
  retryErrorCodes?: string[];
};

type PluginOptions = RotatorOptions & {
  google?: RotatorOptions;
  openrouter?: RotatorOptions;
};

type RotatorConfig = {
  rotatorKeys?: string[] | string;
  rotatorKeysEnv?: string;
  rotatorBlockedForMs?: number;
  rotatorRetryStatuses?: number[];
  rotatorRetryErrorCodes?: string[];
  apiKey?: string;
  fetch?: typeof fetch;
};

type Account = {
  key: string;
  blockedUntil: number;
};

type ProviderDefinition = {
  id: "google" | "openrouter";
  name: string;
  service: string;
  defaultKeysEnv: string;
  defaultEnabled: boolean;
  retryStatuses: number[];
  retryErrorCodes: string[];
  applyKey: (headers: Headers, key: string) => void;
  readError: (response: Response) => Promise<ProviderError>;
};

type ProviderError = {
  code?: string;
  message?: string;
};

const PLACEHOLDER_API_KEY = "opencode-provider-rotator";
const DEFAULT_BLOCKED_FOR_MS = 60 * 60 * 1000;
const OPENROUTER_RETRY_STATUSES = [
  402, 408, 409, 425, 429, 500, 502, 503, 504,
];
const OPENROUTER_RETRY_ERROR_CODES = [
  "insufficient_credits",
  "rate_limit_exceeded",
  "quota_exceeded",
  "context_length_exceeded",
];
const GOOGLE_RETRY_STATUSES = [408, 409, 425, 429, 500, 502, 503, 504];
const GOOGLE_RETRY_ERROR_CODES = [
  "ABORTED",
  "DEADLINE_EXCEEDED",
  "INTERNAL",
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
];

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

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

async function readOpenRouterError(response: Response): Promise<ProviderError> {
  try {
    const body = await response.clone().json();
    const code = body?.error?.code ?? body?.code;
    const message = body?.error?.message ?? body?.message;
    return {
      code: asString(code),
      message: asString(message),
    };
  } catch {
    return {};
  }
}

async function readGoogleError(response: Response): Promise<ProviderError> {
  try {
    const body = await response.clone().json();
    const code = body?.error?.status ?? body?.status ?? body?.error?.code;
    const message = body?.error?.message ?? body?.message;
    return {
      code: asString(code),
      message: asString(message),
    };
  } catch {
    return {};
  }
}

const PROVIDERS: ProviderDefinition[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    service: "openrouter-rotator",
    defaultKeysEnv: "OPENROUTER_API_KEYS",
    defaultEnabled: true,
    retryStatuses: OPENROUTER_RETRY_STATUSES,
    retryErrorCodes: OPENROUTER_RETRY_ERROR_CODES,
    applyKey: (headers, key) => {
      headers.set("Authorization", `Bearer ${key}`);
    },
    readError: readOpenRouterError,
  },
  {
    id: "google",
    name: "Google Gemini",
    service: "google-gemini-rotator",
    defaultKeysEnv: "GEMINI_API_KEYS",
    defaultEnabled: false,
    retryStatuses: GOOGLE_RETRY_STATUSES,
    retryErrorCodes: GOOGLE_RETRY_ERROR_CODES,
    applyKey: (headers, key) => {
      headers.set("x-goog-api-key", key);
    },
    readError: readGoogleError,
  },
];

function matchesRetryErrorCode(code: string, retryErrorCodes: string[]) {
  return (
    retryErrorCodes.includes(code) ||
    retryErrorCodes.includes(code.toLowerCase()) ||
    retryErrorCodes.includes(code.toUpperCase())
  );
}

function hasRotatorConfig(rotator: RotatorConfig | undefined) {
  return (
    rotator?.rotatorKeys !== undefined ||
    rotator?.rotatorKeysEnv !== undefined ||
    rotator?.rotatorBlockedForMs !== undefined ||
    rotator?.rotatorRetryStatuses !== undefined ||
    rotator?.rotatorRetryErrorCodes !== undefined
  );
}

function getPluginOption<T extends keyof RotatorOptions>(
  pluginOptions: PluginOptions | undefined,
  provider: ProviderDefinition,
  key: T,
) {
  const providerOptions = pluginOptions?.[provider.id];
  if (providerOptions?.[key] !== undefined) return providerOptions[key];
  if (provider.id === "openrouter") return pluginOptions?.[key];
  return undefined;
}

function normalizeRotatorOptions(
  rotator: RotatorConfig | undefined,
  provider: ProviderDefinition,
  pluginOptions: PluginOptions | undefined,
): Required<RotatorOptions> {
  const pluginKeysEnv = getPluginOption(pluginOptions, provider, "keysEnv");
  const pluginBlockedForMs = getPluginOption(
    pluginOptions,
    provider,
    "blockedForMs",
  );
  const pluginRetryStatuses = getPluginOption(
    pluginOptions,
    provider,
    "retryStatuses",
  );
  const pluginRetryErrorCodes = getPluginOption(
    pluginOptions,
    provider,
    "retryErrorCodes",
  );

  return {
    keysEnv:
      rotator?.rotatorKeysEnv ??
      (typeof pluginKeysEnv === "string" ? pluginKeysEnv : provider.defaultKeysEnv),
    blockedForMs:
      typeof rotator?.rotatorBlockedForMs === "number"
        ? rotator.rotatorBlockedForMs
        : typeof pluginBlockedForMs === "number"
          ? pluginBlockedForMs
          : DEFAULT_BLOCKED_FOR_MS,
    retryStatuses: Array.isArray(rotator?.rotatorRetryStatuses)
      ? rotator.rotatorRetryStatuses.filter(
          (status): status is number => typeof status === "number",
        )
      : Array.isArray(pluginRetryStatuses)
        ? pluginRetryStatuses.filter(
            (status): status is number => typeof status === "number",
          )
        : provider.retryStatuses,
    retryErrorCodes: Array.isArray(rotator?.rotatorRetryErrorCodes)
      ? rotator.rotatorRetryErrorCodes.filter(
          (code): code is string => typeof code === "string",
        )
      : Array.isArray(pluginRetryErrorCodes)
        ? pluginRetryErrorCodes.filter(
            (code): code is string => typeof code === "string",
          )
        : provider.retryErrorCodes,
  };
}

function createRotatingFetch(
  accounts: Account[],
  options: Required<RotatorOptions>,
  provider: ProviderDefinition,
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
      provider.applyKey(headers, account.key);

      try {
        const response = await fetch(input, { ...init, headers });
        if (!options.retryStatuses.includes(response.status)) return response;

        const error = await provider.readError(response);
        if (
          error.code &&
          !matchesRetryErrorCode(error.code, options.retryErrorCodes)
        )
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

async function configureProvider(
  cfg: Config,
  client: PluginInput["client"],
  pluginOptions: PluginOptions | undefined,
  provider: ProviderDefinition,
) {
  cfg.provider ??= {};

  const existingOptions = cfg.provider[provider.id]?.options as
    | RotatorConfig
    | undefined;
  const options = normalizeRotatorOptions(
    existingOptions,
    provider,
    pluginOptions,
  );
  const envKeys = parseKeys(process.env[options.keysEnv]);
  const shouldConfigure =
    provider.defaultEnabled || hasRotatorConfig(existingOptions) || envKeys.length > 0;

  if (!shouldConfigure) return;

  cfg.provider[provider.id] ??= {};
  cfg.provider[provider.id].options ??= {};

  const rotator = cfg.provider[provider.id].options as RotatorConfig;
  const accounts = [...normalizeKeys(rotator.rotatorKeys), ...envKeys].map(
    (key) => ({
      key,
      blockedUntil: 0,
    }),
  );

  delete rotator.rotatorKeys;
  delete rotator.rotatorKeysEnv;
  delete rotator.rotatorBlockedForMs;
  delete rotator.rotatorRetryStatuses;
  delete rotator.rotatorRetryErrorCodes;

  if (accounts.length === 0) {
    await client.app.log({
      body: {
        service: provider.service,
        level: "warn",
        message: `${options.keysEnv} is empty; ${provider.name} key rotation is disabled`,
      },
    });
    return;
  }

  rotator.apiKey ??= PLACEHOLDER_API_KEY;
  rotator.fetch = createRotatingFetch(accounts, options, provider);

  await client.app.log({
    body: {
      service: provider.service,
      level: "info",
      message: `Loaded ${accounts.length} ${provider.name} accounts from ${options.keysEnv}`,
    },
  });
}

export const OpenRouterRotator: Plugin = async ({ client }, pluginOptions) => {
  return {
    config: async (cfg) => {
      for (const provider of PROVIDERS)
        await configureProvider(
          cfg,
          client,
          pluginOptions as PluginOptions | undefined,
          provider,
        );
    },
  };
};
