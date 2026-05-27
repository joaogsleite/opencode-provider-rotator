# opencode OpenRouter Provider Rotator

Local opencode plugin that rotates across multiple OpenRouter API keys. When OpenRouter returns a retryable limit or outage response, the plugin temporarily blocks that key and retries the same request with the next configured key.

## Usage

Set your OpenRouter keys in `opencode.jsonc`:

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
        "apiKey": "opencode-openrouter-rotator",
      },
    },
  },
}
```

Or set them as a comma-separated or newline-separated environment variable before starting opencode:

```sh
export OPENROUTER_API_KEYS="your-first-openrouter-key,your-second-openrouter-key"
opencode
```

Use OpenRouter models normally, for example `openrouter/anthropic/claude-sonnet-4.5`.

## Configuration

opencode auto-loads `.opencode/plugins/openrouter-rotator.ts` at startup. The included `opencode.jsonc` enables the OpenRouter provider with a placeholder key; the plugin replaces the request `Authorization` header with one of your real keys.

Plugin options:

- `rotatorKeys`: array of OpenRouter API keys, or a comma/newline-separated string.
- `rotatorKeysEnv`: optional environment variable containing additional keys. Defaults to `OPENROUTER_API_KEYS`.
- `rotatorBlockedForMs`: how long to skip a key after a retryable failure. Defaults to one hour.
- `rotatorRetryStatuses`: HTTP statuses that trigger rotation. Defaults to `402`, `408`, `409`, `425`, `429`, `500`, `502`, `503`, and `504`.
- `rotatorRetryErrorCodes`: OpenRouter error codes that trigger rotation when present. Defaults to `insufficient_credits`, `rate_limit_exceeded`, `quota_exceeded`, and `context_length_exceeded`.

Restart opencode after changing the plugin or config; opencode loads plugins only at startup.
