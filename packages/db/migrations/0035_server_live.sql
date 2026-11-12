-- Master plan A2 and A4: what a bound node sees of its server (ADR 0046).
-- One current row per server for power and players, and one row per account that was
-- refused at the door ("asking to join"). The node reports; nothing here changes a server.
CREATE TABLE minecraft_server_live(
 organization_id uuid NOT NULL,server_id uuid NOT NULL,node_id uuid NOT NULL,
 power text NOT NULL CHECK(power IN ('on','off','starting','unknown')),
 online integer CHECK(online IS NULL OR (online>=0 AND online<=10000)),
 max_players integer CHECK(max_players IS NULL OR (max_players>=0 AND max_players<=10000)),
 players jsonb CHECK(players IS NULL OR (jsonb_typeof(players)='array' AND octet_length(players::text)<=4096)),
 reported_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,server_id),
 FOREIGN KEY(organization_id,server_id) REFERENCES minecraft_servers(organization_id,id),
 FOREIGN KEY(organization_id,node_id) REFERENCES minecraft_nodes(organization_id,id),
 CHECK(power='on' OR (online IS NULL AND players IS NULL))
);
ALTER TABLE minecraft_server_live ENABLE ROW LEVEL SECURITY;
ALTER TABLE minecraft_server_live FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON minecraft_server_live USING(organization_id=(SELECT nullif(current_setting('app.organization_id',true),'')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting('app.organization_id',true),'')::uuid));
GRANT SELECT,INSERT,UPDATE ON minecraft_server_live TO craftlayer_runtime;

-- A knock is the account the server itself refused: allowing it adds exactly that account.
CREATE TABLE minecraft_server_knocks(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,server_id uuid NOT NULL,
 account_uuid uuid NOT NULL,name text NOT NULL CHECK(name ~ '^[\x20-\x7e]{1,64}$'),
 edition text NOT NULL CHECK(edition IN ('bedrock','java')),
 xuid text CHECK(xuid IS NULL OR xuid ~ '^[0-9]{1,20}$'),
 first_at timestamptz NOT NULL,last_at timestamptz NOT NULL,attempts integer NOT NULL CHECK(attempts>0),
 state text NOT NULL DEFAULT 'asking' CHECK(state IN ('asking','allowed','ignored')),
 decided_by uuid,decided_at timestamptz,action_id uuid,
 UNIQUE(organization_id,id),UNIQUE(organization_id,server_id,account_uuid),
 FOREIGN KEY(organization_id,server_id) REFERENCES minecraft_servers(organization_id,id),
 FOREIGN KEY(organization_id,decided_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,action_id) REFERENCES minecraft_server_actions(organization_id,id),
 CHECK((edition='bedrock')=(xuid IS NOT NULL)),CHECK(last_at>=first_at),
 CHECK((state='asking')=(decided_at IS NULL)),CHECK((decided_at IS NULL)=(decided_by IS NULL)),
 CHECK(action_id IS NULL OR state='allowed')
);
CREATE INDEX minecraft_server_knocks_asking ON minecraft_server_knocks(organization_id,server_id,last_at DESC) WHERE state='asking';
CREATE FUNCTION server_knock_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Knocks are retained' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.server_id,NEW.account_uuid,NEW.edition,NEW.xuid,NEW.first_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.server_id,OLD.account_uuid,OLD.edition,OLD.xuid,OLD.first_at)
 THEN RAISE EXCEPTION 'Knock identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION server_knock_guard() FROM PUBLIC;
CREATE TRIGGER minecraft_server_knocks_guard BEFORE UPDATE OR DELETE ON minecraft_server_knocks FOR EACH ROW EXECUTE FUNCTION server_knock_guard();
ALTER TABLE minecraft_server_knocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE minecraft_server_knocks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON minecraft_server_knocks USING(organization_id=(SELECT nullif(current_setting('app.organization_id',true),'')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting('app.organization_id',true),'')::uuid));
GRANT SELECT,INSERT,UPDATE ON minecraft_server_knocks TO craftlayer_runtime;
