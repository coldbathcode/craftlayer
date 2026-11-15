-- Master plan G2: OpenAI-compatible provider connections (Kong AI Gateway and others).
-- The endpoint, its models and its full price table are declared by the instance
-- operator in the protected provider policy file; the row only binds an organization
-- to that endpoint and holds the sealed credential, exactly like OpenRouter.
ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_kind_check;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_kind_check CHECK(kind IN ('ollama','openrouter','openai_compatible'));
