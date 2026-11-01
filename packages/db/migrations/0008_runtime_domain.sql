-- Chapter 03: simulation is deliberately distinct from a real Minecraft world.
ALTER TABLE environments DROP CONSTRAINT environments_type_check;
ALTER TABLE environments ADD CONSTRAINT environments_type_check CHECK(type IN ('minecraft','coding','research','simulation'));
CREATE TABLE runtime_agents(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,
 name varchar(120) NOT NULL CHECK(length(trim(name))>0),adapter text NOT NULL CHECK(adapter='simulation'),
 state text NOT NULL DEFAULT 'idle' CHECK(state IN ('provisioning','idle','assigned','busy','stopping','offline','error','disabled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id) REFERENCES environments(organization_id,project_id,id)
);
CREATE TABLE runtime_groups(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,name varchar(120) NOT NULL CHECK(length(trim(name))>0),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(organization_id,id),UNIQUE(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id) REFERENCES environments(organization_id,project_id,id)
);
CREATE TABLE runtime_group_agents(
 organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,group_id uuid NOT NULL,agent_id uuid NOT NULL,
 PRIMARY KEY(organization_id,group_id,agent_id),
 FOREIGN KEY(organization_id,project_id,environment_id,group_id) REFERENCES runtime_groups(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id,agent_id) REFERENCES runtime_agents(organization_id,project_id,environment_id,id)
);
CREATE INDEX runtime_group_agents_agent ON runtime_group_agents(organization_id,agent_id);
CREATE TABLE runtime_templates(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),family_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 name varchar(120) NOT NULL,adapter text NOT NULL CHECK(adapter='simulation'),hash char(64) NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),graph jsonb NOT NULL CHECK(octet_length(graph::text)<=262144),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,id,hash),UNIQUE(organization_id,family_id,version),FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE runtime_missions(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,group_id uuid NOT NULL,template_id uuid NOT NULL,
 name varchar(120) NOT NULL,template_hash char(64) NOT NULL,snapshot jsonb NOT NULL CHECK(octet_length(snapshot::text)<=262144),created_by uuid NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','queued','running','paused','blocked','cancelling','succeeded','failed','cancelled')),
 reason text NOT NULL DEFAULT 'none',version integer NOT NULL DEFAULT 1 CHECK(version>0),generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
 execution_grant jsonb,execution_digest char(64),deadline timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id,group_id) REFERENCES runtime_groups(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,template_id,template_hash) REFERENCES runtime_templates(organization_id,id,hash),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX runtime_missions_scope ON runtime_missions(organization_id,environment_id,state,created_at DESC,id);
CREATE TABLE runtime_tasks(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,mission_id uuid NOT NULL,node_key varchar(40) NOT NULL,
 definition jsonb NOT NULL CHECK(octet_length(definition::text)<=16384),required boolean NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','leased','running','retry_wait','blocked','cancel_requested','succeeded','failed','skipped','cancelled')),
 reason text NOT NULL DEFAULT 'dependencies',attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),fence integer NOT NULL DEFAULT 0 CHECK(fence>=0),
 verified boolean NOT NULL DEFAULT false,result jsonb CHECK(result IS NULL OR octet_length(result::text)<=8192),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,mission_id,id),UNIQUE(organization_id,mission_id,node_key),
 CHECK(state<>'succeeded' OR (verified AND result IS NOT NULL)),FOREIGN KEY(organization_id,mission_id) REFERENCES runtime_missions(organization_id,id)
);
CREATE INDEX runtime_tasks_ready ON runtime_tasks(organization_id,next_attempt_at,created_at,id) WHERE state IN ('ready','retry_wait');
CREATE INDEX runtime_tasks_mission ON runtime_tasks(organization_id,mission_id);
CREATE TABLE runtime_dependencies(
 organization_id uuid NOT NULL,mission_id uuid NOT NULL,task_id uuid NOT NULL,prerequisite_id uuid NOT NULL,required boolean NOT NULL,
 PRIMARY KEY(organization_id,mission_id,task_id,prerequisite_id),CHECK(task_id<>prerequisite_id),
 FOREIGN KEY(organization_id,mission_id,task_id) REFERENCES runtime_tasks(organization_id,mission_id,id),
 FOREIGN KEY(organization_id,mission_id,prerequisite_id) REFERENCES runtime_tasks(organization_id,mission_id,id)
);
CREATE INDEX runtime_dependencies_prerequisite ON runtime_dependencies(organization_id,mission_id,prerequisite_id);
CREATE TABLE runtime_attempts(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,mission_id uuid NOT NULL,task_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,agent_id uuid NOT NULL,worker_id uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),fence integer NOT NULL CHECK(fence>0),state text NOT NULL CHECK(state IN ('leased','running','succeeded','failed','uncertain','released','cancel_requested')),
 lease_expires_at timestamptz NOT NULL,started_at timestamptz NOT NULL,finished_at timestamptz,
 tool_calls integer NOT NULL DEFAULT 0 CHECK(tool_calls BETWEEN 0 AND 10),runtime_ms integer NOT NULL DEFAULT 0 CHECK(runtime_ms BETWEEN 0 AND 20000),
 UNIQUE(organization_id,id),UNIQUE(organization_id,mission_id,task_id,id),UNIQUE(organization_id,task_id,fence),
 FOREIGN KEY(organization_id,mission_id,task_id) REFERENCES runtime_tasks(organization_id,mission_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id,agent_id) REFERENCES runtime_agents(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id,mission_id) REFERENCES runtime_missions(organization_id,project_id,environment_id,id)
);
CREATE UNIQUE INDEX runtime_attempts_active_task ON runtime_attempts(organization_id,task_id) WHERE state IN ('leased','running','uncertain','cancel_requested');
CREATE UNIQUE INDEX runtime_attempts_active_agent ON runtime_attempts(organization_id,agent_id) WHERE state IN ('leased','running','uncertain','cancel_requested');
CREATE INDEX runtime_attempts_expiry ON runtime_attempts(organization_id,lease_expires_at) WHERE state IN ('leased','running','cancel_requested');
CREATE TABLE runtime_events(
 sequence bigserial PRIMARY KEY,id uuid NOT NULL UNIQUE,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,mission_id uuid,
 type varchar(64) NOT NULL,payload jsonb NOT NULL CHECK(octet_length(payload::text)<=4096),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,environment_id) REFERENCES environments(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id,mission_id) REFERENCES runtime_missions(organization_id,project_id,environment_id,id)
);
CREATE INDEX runtime_events_scope ON runtime_events(organization_id,environment_id,sequence);
CREATE TABLE runtime_action_receipts(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,mission_id uuid NOT NULL,task_id uuid NOT NULL,attempt_id uuid NOT NULL,action_key char(64) NOT NULL,
 action_hash char(64) NOT NULL,state text NOT NULL CHECK(state IN ('prepared','confirmed','uncertain','rejected')),result jsonb CHECK(octet_length(result::text)<=8192),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,action_key),FOREIGN KEY(organization_id,mission_id,task_id) REFERENCES runtime_tasks(organization_id,mission_id,id),
 FOREIGN KEY(organization_id,mission_id,task_id,attempt_id) REFERENCES runtime_attempts(organization_id,mission_id,task_id,id)
);
CREATE INDEX runtime_receipts_attempt ON runtime_action_receipts(organization_id,attempt_id);
CREATE TABLE runtime_approvals(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,mission_id uuid NOT NULL,task_id uuid NOT NULL,action_hash char(64) NOT NULL,requester_id uuid NOT NULL,approver_id uuid,
 generation integer NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','consumed')),expires_at timestamptz NOT NULL,
 UNIQUE(organization_id,id),UNIQUE(organization_id,task_id,generation,action_hash),CHECK(approver_id IS NULL OR approver_id<>requester_id),
 FOREIGN KEY(organization_id,mission_id,task_id) REFERENCES runtime_tasks(organization_id,mission_id,id),
 FOREIGN KEY(organization_id,requester_id) REFERENCES memberships(organization_id,user_id),FOREIGN KEY(organization_id,approver_id) REFERENCES memberships(organization_id,user_id)
);
CREATE FUNCTION runtime_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable runtime snapshot' USING ERRCODE='23514'; END $$;
CREATE TRIGGER runtime_template_immutable BEFORE UPDATE OR DELETE ON runtime_templates FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
CREATE FUNCTION runtime_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[];
BEGIN
 IF TG_TABLE_NAME='runtime_missions' THEN
  IF (NEW.snapshot,NEW.template_hash,NEW.created_by,NEW.organization_id,NEW.environment_id,NEW.group_id,NEW.template_id,NEW.project_id) IS DISTINCT FROM (OLD.snapshot,OLD.template_hash,OLD.created_by,OLD.organization_id,OLD.environment_id,OLD.group_id,OLD.template_id,OLD.project_id) THEN RAISE EXCEPTION 'Immutable mission scope/snapshot' USING ERRCODE='23514'; END IF;
  IF NEW.version<OLD.version OR NEW.generation<OLD.generation THEN RAISE EXCEPTION 'Runtime version regressed' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.definition,NEW.required,NEW.organization_id,NEW.mission_id,NEW.node_key) IS DISTINCT FROM (OLD.definition,OLD.required,OLD.organization_id,OLD.mission_id,OLD.node_key) THEN RAISE EXCEPTION 'Immutable task scope/definition' USING ERRCODE='23514'; END IF;
  IF NEW.fence<OLD.fence OR NEW.attempt_count<OLD.attempt_count THEN RAISE EXCEPTION 'Runtime fence regressed' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='runtime_missions' AND NEW.state='succeeded' AND OLD.state<>'succeeded' THEN
  IF NOT EXISTS(SELECT 1 FROM runtime_tasks WHERE organization_id=NEW.organization_id AND mission_id=NEW.id)
    OR EXISTS(SELECT 1 FROM runtime_tasks WHERE organization_id=NEW.organization_id AND mission_id=NEW.id AND (state NOT IN ('succeeded','failed','skipped','cancelled') OR (required AND (state<>'succeeded' OR NOT verified))))
    OR EXISTS(SELECT 1 FROM runtime_attempts WHERE organization_id=NEW.organization_id AND mission_id=NEW.id AND state IN ('leased','running','uncertain','cancel_requested'))
  THEN RAISE EXCEPTION 'Unverified mission completion' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.state=OLD.state THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='runtime_missions' THEN
  allowed:=CASE OLD.state
   WHEN 'draft' THEN ARRAY['queued','cancelled']
   WHEN 'queued' THEN ARRAY['running','paused','blocked','cancelling','cancelled','failed']
   WHEN 'running' THEN ARRAY['paused','blocked','cancelling','succeeded','failed']
   WHEN 'paused' THEN ARRAY['queued','blocked','cancelling','cancelled','failed']
   WHEN 'blocked' THEN ARRAY['queued','paused','cancelling','cancelled','failed']
   WHEN 'cancelling' THEN ARRAY['cancelled','blocked']
   ELSE ARRAY[]::text[] END;
 ELSE
  allowed:=CASE OLD.state
   WHEN 'pending' THEN ARRAY['ready','blocked','skipped','cancelled']
   WHEN 'ready' THEN ARRAY['leased','blocked','cancelled']
   WHEN 'leased' THEN ARRAY['running','ready','blocked','cancel_requested']
   WHEN 'running' THEN ARRAY['succeeded','failed','retry_wait','blocked','cancel_requested']
   WHEN 'retry_wait' THEN ARRAY['ready','blocked','cancelled']
   WHEN 'blocked' THEN ARRAY['pending','ready','failed','cancelled']
   WHEN 'cancel_requested' THEN ARRAY['cancelled','blocked']
   ELSE ARRAY[]::text[] END;
 END IF;
 IF NOT NEW.state=ANY(allowed) THEN RAISE EXCEPTION 'Invalid runtime transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER runtime_mission_transition BEFORE UPDATE ON runtime_missions FOR EACH ROW EXECUTE FUNCTION runtime_transition();
CREATE TRIGGER runtime_task_transition BEFORE UPDATE ON runtime_tasks FOR EACH ROW EXECUTE FUNCTION runtime_transition();
ALTER TABLE runtime_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_agents FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_agents_scope ON runtime_agents USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_agents TO craftlayer_runtime;
ALTER TABLE runtime_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_groups_scope ON runtime_groups USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_groups TO craftlayer_runtime;
ALTER TABLE runtime_group_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_group_agents FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_group_agents_scope ON runtime_group_agents USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_group_agents TO craftlayer_runtime;
ALTER TABLE runtime_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_templates_scope ON runtime_templates USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON runtime_templates TO craftlayer_runtime;
ALTER TABLE runtime_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_missions FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_missions_scope ON runtime_missions USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_missions TO craftlayer_runtime;
ALTER TABLE runtime_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_tasks_scope ON runtime_tasks USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_tasks TO craftlayer_runtime;
ALTER TABLE runtime_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_dependencies_scope ON runtime_dependencies USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_dependencies TO craftlayer_runtime;
ALTER TABLE runtime_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_attempts_scope ON runtime_attempts USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_attempts TO craftlayer_runtime;
ALTER TABLE runtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_events FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_events_scope ON runtime_events USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON runtime_events TO craftlayer_runtime;
ALTER TABLE runtime_action_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_action_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_action_receipts_scope ON runtime_action_receipts USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_action_receipts TO craftlayer_runtime;
ALTER TABLE runtime_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_approvals_scope ON runtime_approvals USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_approvals TO craftlayer_runtime;
GRANT USAGE ON SEQUENCE runtime_events_sequence_seq TO craftlayer_runtime;
REVOKE ALL ON FUNCTION runtime_immutable(),runtime_transition() FROM PUBLIC;
