-- Master plan G3 (ADR 0051, ADR 0053): AI players. A profile an adult owns, the worker
-- host that runs it, the owner's standing master tasks, bounded memory, the
-- conversation, per-player spending (reserved before every model call), and the last
-- status the worker reported. Nothing here touches a game server or a provider key.

-- A worker host runs AI player bodies. Its token is shown once; only the hash is kept.
CREATE TABLE ai_player_hosts(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),
 label varchar(80) NOT NULL CHECK(length(trim(label))>0),
 token_hash char(64) NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz,revoked_at timestamptz,revoked_by uuid,
 UNIQUE(organization_id,id)
);

CREATE TABLE ai_players(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,
 name varchar(32) NOT NULL CHECK(name ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$'),
 persona text NOT NULL DEFAULT '' CHECK(length(persona)<=2000),
 rules text NOT NULL DEFAULT '' CHECK(length(rules)<=2000),
 owner_user_id uuid NOT NULL,owner_membership_id uuid NOT NULL,
 connection_id uuid NOT NULL,model_id varchar(180) NOT NULL CHECK(length(model_id)>0),
 host_id uuid,
 game_host varchar(253) NOT NULL CHECK(game_host ~ '^[A-Za-z0-9.:_-]{1,253}$'),
 game_port integer NOT NULL CHECK(game_port BETWEEN 1 AND 65535),
 game_version varchar(16) NOT NULL DEFAULT '26.1' CHECK(game_version ~ '^[0-9]+(\.[0-9]+){1,2}$'),
 mc_username varchar(16) NOT NULL CHECK(mc_username ~ '^[A-Za-z0-9_]{3,16}$'),
 mc_auth text NOT NULL CHECK(mc_auth IN ('offline','microsoft')),
 -- In-game identities whose chat counts as the owner's instructions.
 instructors jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(instructors)='array' AND octet_length(instructors::text)<=2048),
 daily_limit_micro numeric(38,0) NOT NULL CHECK(daily_limit_micro>=0),
 total_limit_micro numeric(38,0) NOT NULL CHECK(total_limit_micro>=0),
 calls_per_hour integer NOT NULL DEFAULT 120 CHECK(calls_per_hour BETWEEN 1 AND 1200),
 desired_state text NOT NULL DEFAULT 'stopped' CHECK(desired_state IN ('running','stopped')),
 -- Set by Stop; only an adult clears it, and clearing never starts the player.
 stop_latched boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,name),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 FOREIGN KEY(organization_id,connection_id) REFERENCES provider_connections(organization_id,id),
 FOREIGN KEY(organization_id,host_id) REFERENCES ai_player_hosts(organization_id,id),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES memberships(organization_id,user_id),
 CHECK(NOT (stop_latched AND desired_state='running'))
);

-- Jobs the owner allows the player to do when nobody is instructing it.
CREATE TABLE ai_player_tasks(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,player_id uuid NOT NULL,
 title varchar(80) NOT NULL CHECK(length(trim(title))>0),
 goal text NOT NULL CHECK(length(trim(goal))>0 AND length(goal)<=500),
 priority integer NOT NULL CHECK(priority BETWEEN 1 AND 100),
 condition text NOT NULL DEFAULT 'always' CHECK(condition IN ('always','owner_online','day','night')),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,player_id) REFERENCES ai_players(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE ai_player_memories(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,player_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('fact','place','person','lesson','note','summary')),
 content text NOT NULL CHECK(length(trim(content))>0 AND length(content)<=500),
 tags text[] NOT NULL DEFAULT '{}' CHECK(cardinality(tags)<=8),
 x integer,y integer,z integer,
 source text NOT NULL CHECK(source IN ('owner','player')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz,
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,player_id) REFERENCES ai_players(organization_id,id) ON DELETE CASCADE,
 CHECK((x IS NULL AND y IS NULL AND z IS NULL) OR (x IS NOT NULL AND y IS NOT NULL AND z IS NOT NULL))
);
CREATE INDEX ai_player_memories_recent ON ai_player_memories(organization_id,player_id,created_at DESC);

-- The conversation and activity log. Instructions wait here until the worker takes them.
CREATE TABLE ai_player_messages(
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid NOT NULL,
 organization_id uuid NOT NULL,player_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('instruction','reply','event','decision','system')),
 channel text NOT NULL CHECK(channel IN ('dashboard','game','mcp','system','player')),
 author varchar(64) NOT NULL,
 body text NOT NULL CHECK(length(body)>0 AND length(body)<=2000),
 delivered_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,player_id) REFERENCES ai_players(organization_id,id) ON DELETE CASCADE,
 CHECK(delivered_at IS NULL OR direction='instruction')
);
CREATE INDEX ai_player_messages_player ON ai_player_messages(organization_id,player_id,seq);
CREATE INDEX ai_player_messages_pending ON ai_player_messages(organization_id,player_id) WHERE direction='instruction' AND delivered_at IS NULL;

-- Spending per player per UTC day. Reserved holds a call's worst case until it settles.
CREATE TABLE ai_player_spend_days(
 organization_id uuid NOT NULL,player_id uuid NOT NULL,day date NOT NULL,
 reserved_micro numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_micro>=0),
 used_micro numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_micro>=0),
 calls integer NOT NULL DEFAULT 0 CHECK(calls>=0),
 input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens>=0),
 output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
 PRIMARY KEY(organization_id,player_id,day),
 FOREIGN KEY(organization_id,player_id) REFERENCES ai_players(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE ai_player_calls(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,player_id uuid NOT NULL,day date NOT NULL,
 model_id varchar(180) NOT NULL,max_micro numeric(38,0) NOT NULL CHECK(max_micro>=0),
 charged_micro numeric(38,0) CHECK(charged_micro IS NULL OR charged_micro>=0),
 input_tokens integer,output_tokens integer,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','settled','released','uncertain')),
 created_at timestamptz NOT NULL DEFAULT now(),settled_at timestamptz,
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,player_id,day) REFERENCES ai_player_spend_days(organization_id,player_id,day) ON DELETE CASCADE
);
CREATE INDEX ai_player_calls_recent ON ai_player_calls(organization_id,player_id,created_at DESC);

-- What the worker last saw. Shown to the owner; never authority for anything.
CREATE TABLE ai_player_status(
 organization_id uuid NOT NULL,player_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('offline','connecting','online','sign_in_required','stopped','out_of_budget','error')),
 detail jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(detail)='object' AND octet_length(detail::text)<=4096),
 reported_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,player_id),
 FOREIGN KEY(organization_id,player_id) REFERENCES ai_players(organization_id,id) ON DELETE CASCADE
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ai_player_hosts','ai_players','ai_player_tasks','ai_player_memories','ai_player_messages','ai_player_spend_days','ai_player_calls','ai_player_status'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON ai_player_hosts,ai_players,ai_player_status,ai_player_spend_days,ai_player_calls TO craftlayer_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ai_player_tasks,ai_player_memories TO craftlayer_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ai_player_messages TO craftlayer_runtime;
GRANT DELETE ON ai_players TO craftlayer_runtime;
