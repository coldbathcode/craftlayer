-- Metadata-only holds. Dispatch intent/uncertainty retain capacity until verified reconciliation.
CREATE TABLE minecraft_reservations(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,node_id uuid NOT NULL,
 deployment_id uuid NOT NULL UNIQUE,server_id uuid NOT NULL UNIQUE,world_id uuid NOT NULL UNIQUE,
 actor_id uuid NOT NULL,session_id uuid NOT NULL,name varchar(80) NOT NULL,template_id text NOT NULL CHECK(template_id='family-survival-v1'),
 plan_hash char(64) NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),template_hash char(64) NOT NULL CHECK(template_hash ~ '^[a-f0-9]{64}$'),policy_hash char(64) NOT NULL CHECK(policy_hash ~ '^[a-f0-9]{64}$'),admission_hash char(64) NOT NULL CHECK(admission_hash ~ '^[a-f0-9]{64}$'),
 node_version integer NOT NULL CHECK(node_version>0),credential_version integer NOT NULL CHECK(credential_version>0),
 cpu_milli integer NOT NULL CHECK(cpu_milli=2000),memory_mb integer NOT NULL CHECK(memory_mb=6144),disk_mb integer NOT NULL CHECK(disk_mb=20480),
 java_port integer NOT NULL CHECK(java_port BETWEEN 1024 AND 65535),bedrock_port integer NOT NULL CHECK(bedrock_port BETWEEN 1024 AND 65535),
 state text NOT NULL CHECK(state IN ('held','allocated','uncertain','released')),version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL,lease_expires_at timestamptz NOT NULL CHECK(lease_expires_at>created_at AND lease_expires_at<=created_at+interval '60 seconds'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,node_id,id),UNIQUE(organization_id,project_id,environment_id,node_id,id),
 FOREIGN KEY(organization_id,project_id,node_id) REFERENCES minecraft_nodes(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id) REFERENCES environments(organization_id,project_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX minecraft_reservations_node ON minecraft_reservations(organization_id,node_id,state,lease_expires_at) WHERE state<>'released';
CREATE INDEX minecraft_reservations_environment ON minecraft_reservations(organization_id,project_id,environment_id);
CREATE INDEX minecraft_reservations_actor ON minecraft_reservations(organization_id,actor_id);
CREATE TABLE minecraft_reservation_ports(
 organization_id uuid NOT NULL,node_id uuid NOT NULL,reservation_id uuid NOT NULL,protocol text NOT NULL CHECK(protocol IN ('tcp','udp')),port integer NOT NULL CHECK(port BETWEEN 1024 AND 65535),
 PRIMARY KEY(node_id,protocol,port),FOREIGN KEY(organization_id,node_id,reservation_id) REFERENCES minecraft_reservations(organization_id,node_id,id)
);
CREATE FUNCTION minecraft_reservation_port_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r minecraft_reservations; BEGIN
 SELECT * INTO r FROM minecraft_reservations WHERE organization_id=COALESCE(NEW.organization_id,OLD.organization_id) AND id=COALESCE(NEW.reservation_id,OLD.reservation_id);
 IF TG_OP='DELETE' THEN
  IF r.state<>'released' THEN RAISE EXCEPTION 'Allocated ports cannot be released' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF r.state<>'held' OR NEW.node_id<>r.node_id OR (NEW.protocol='tcp' AND NEW.port<>r.java_port) OR (NEW.protocol='udp' AND NEW.port<>r.bedrock_port) THEN RAISE EXCEPTION 'Invalid reservation port binding' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER minecraft_reservation_port_guard BEFORE INSERT OR DELETE ON minecraft_reservation_ports FOR EACH ROW EXECUTE FUNCTION minecraft_reservation_port_guard();
REVOKE ALL ON FUNCTION minecraft_reservation_port_guard() FROM PUBLIC;
CREATE INDEX minecraft_reservation_ports_parent ON minecraft_reservation_ports(organization_id,reservation_id);
CREATE TABLE minecraft_reservation_operations(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,node_id uuid NOT NULL,reservation_id uuid NOT NULL,
 actor_id uuid,session_id uuid,kind text NOT NULL CHECK(kind IN ('reserve','release','expire','dispatch','uncertain')),
 request_key uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,id),UNIQUE(organization_id,actor_id,kind,request_key),
 FOREIGN KEY(organization_id,project_id,environment_id,node_id,reservation_id) REFERENCES minecraft_reservations(organization_id,project_id,environment_id,node_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id),CHECK((kind='expire' AND actor_id IS NULL AND session_id IS NULL) OR (kind<>'expire' AND actor_id IS NOT NULL AND session_id IS NOT NULL))
);
CREATE INDEX minecraft_reservation_operations_parent ON minecraft_reservation_operations(organization_id,reservation_id);
CREATE INDEX minecraft_reservation_operations_recent ON minecraft_reservation_operations(organization_id,project_id,created_at DESC) WHERE kind='reserve';
CREATE TABLE minecraft_reservation_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,operation_id uuid NOT NULL,schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),created_at timestamptz NOT NULL,
 FOREIGN KEY(organization_id,operation_id) REFERENCES minecraft_reservation_operations(organization_id,id)
);
CREATE INDEX minecraft_reservation_outbox_operation ON minecraft_reservation_outbox(organization_id,operation_id);
CREATE TRIGGER minecraft_reservation_operations_immutable BEFORE UPDATE OR DELETE ON minecraft_reservation_operations FOR EACH ROW EXECUTE FUNCTION management_immutable();
CREATE TRIGGER minecraft_reservation_outbox_immutable BEFORE UPDATE OR DELETE ON minecraft_reservation_outbox FOR EACH ROW EXECUTE FUNCTION management_immutable();
CREATE FUNCTION minecraft_reservation_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['state','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version']) OR NEW.version<>OLD.version+1 OR OLD.state='released' OR NOT ((OLD.state='held' AND NEW.state IN ('allocated','released')) OR (OLD.state='allocated' AND NEW.state='uncertain')) THEN RAISE EXCEPTION 'Invalid reservation transition' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER minecraft_reservation_transition BEFORE UPDATE ON minecraft_reservations FOR EACH ROW EXECUTE FUNCTION minecraft_reservation_transition();
REVOKE ALL ON FUNCTION minecraft_reservation_transition() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_reservations','minecraft_reservation_ports','minecraft_reservation_operations','minecraft_reservation_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
 END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE ON minecraft_reservations TO craftlayer_runtime;
GRANT SELECT,INSERT,DELETE ON minecraft_reservation_ports TO craftlayer_runtime;
GRANT SELECT,INSERT ON minecraft_reservation_operations,minecraft_reservation_outbox TO craftlayer_runtime;
