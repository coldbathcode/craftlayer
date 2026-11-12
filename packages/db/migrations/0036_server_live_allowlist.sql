-- Master plan B2: the host also reports the names on the server's allowlist, so a
-- family screen can show who can join (ADR 0046). Kept when a report cannot read it.
ALTER TABLE minecraft_server_live ADD COLUMN allowed jsonb CHECK(allowed IS NULL OR (jsonb_typeof(allowed)='array' AND octet_length(allowed::text)<=8192));
