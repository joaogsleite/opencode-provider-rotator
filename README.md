# Opencode Provider Rotator

Global opencode plugin that rotates across multiple OpenRouter and Google Gemini API keys. When a provider returns a retryable limit or outage response, the plugin temporarily blocks that key and retries the same request with the next configured key.

## Global Setup

Install the plugin in your global opencode config directory:

```sh
mkdir -p ~/.config/opencode/plugins
cp provider-rotator.ts ~/.config/opencode/plugins/provider-rotator.ts
```

Then add your provider configuration to `~/.config/opencode/opencode.jsonc`.

For OpenRouter:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "options": {
        "rotatorKeys": [
          "your-first-openrouter-key",
          "your-second-openrouter-key",
        ],
        "apiKey": "opencode-provider-rotator",
      },
    },
  },
}
```

You can also keep keys out of the config file and read them from an environment variable:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "options": {
        "rotatorKeysEnv": "OPENROUTER_API_KEYS",
        "apiKey": "opencode-provider-rotator",
      },
    },
  },
}
```

Then start opencode with:

```sh
export OPENROUTER_API_KEYS="your-first-openrouter-key,your-second-openrouter-key"
opencode
```

Use OpenRouter models normally, for example `openrouter/anthropic/claude-sonnet-4.5`.

For Google Gemini:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "google": {
      "options": {
        "rotatorKeys": [
          "your-first-gemini-key",
          "your-second-gemini-key",
        ],
        "apiKey": "opencode-provider-rotator",
      },
    },
  },
}
```

You can also keep Gemini keys out of the config file and read them from an environment variable:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "google": {
      "options": {
        "rotatorKeysEnv": "GEMINI_API_KEYS",
        "apiKey": "opencode-provider-rotator",
      },
    },
  },
}
```

Then start opencode with:

```sh
export GEMINI_API_KEYS="your-first-gemini-key,your-second-gemini-key"
opencode
```

Use Google Gemini models normally, for example `google/gemini-2.5-pro`.

## Configuration

opencode auto-loads `~/.config/opencode/plugins/provider-rotator.ts` at startup. The global `opencode.jsonc` enables the provider with a placeholder key; the plugin replaces the request auth header with one of your real keys.

Plugin options:

- `rotatorKeys`: array of provider API keys, or a comma/newline-separated string.
- `rotatorKeysEnv`: optional environment variable containing additional keys. Defaults to `OPENROUTER_API_KEYS` for OpenRouter and `GEMINI_API_KEYS` for Google Gemini.
- `rotatorBlockedForMs`: how long to skip a key after a retryable failure. Defaults to one hour.
- `rotatorRetryStatuses`: HTTP statuses that trigger rotation. OpenRouter defaults to `402`, `408`, `409`, `425`, `429`, `500`, `502`, `503`, and `504`. Google Gemini defaults to `408`, `409`, `425`, `429`, `500`, `502`, `503`, and `504`.
- `rotatorRetryErrorCodes`: provider error codes that trigger rotation when present. OpenRouter defaults to `insufficient_credits`, `rate_limit_exceeded`, `quota_exceeded`, and `context_length_exceeded`. Google Gemini defaults to `ABORTED`, `DEADLINE_EXCEEDED`, `INTERNAL`, `RESOURCE_EXHAUSTED`, and `UNAVAILABLE`.

This plugin supports the Google Generative AI provider used by `google/*` models. It does not rotate Google Vertex AI credentials for `google-vertex/*` models.

Restart opencode after changing the plugin or config; opencode loads plugins only at startup.
