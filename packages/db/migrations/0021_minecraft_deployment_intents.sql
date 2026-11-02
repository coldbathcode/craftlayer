-- Durable reference-only controller intake. No claim, lease or physical dispatch exists here.
ALTER TABLE minecraft_reservation_operations ADD CONSTRAINT minecraft_reservation_operations_binding UNIQUE(organization_id,reservation_id,id);
CREATE TABLE minecraft_deployment_intents(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,node_id uuid NOT NULL,
 reservation_id uuid NOT NULL,dispatch_operation_id uuid NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending_qualification' CHECK(state='pending_qualification'),
 execution_enabled boolean NOT NULL DEFAULT false CHECK(NOT execution_enabled),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,id),UNIQUE(organization_id,reservation_id),UNIQUE(organization_id,actor_id,request_key),
 FOREIGN KEY(organization_id,project_id,environment_id,node_id,reservation_id) REFERENCES minecraft_reservations(organization_id,project_id,environment_id,node_id,id),
 FOREIGN KEY(organization_id,reservation_id,dispatch_operation_id) REFERENCES minecraft_reservation_operations(organization_id,reservation_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX minecraft_deployment_intents_project ON minecraft_deployment_intents(organization_id,project_id,created_at DESC);
CREATE INDEX minecraft_deployment_intents_actor ON minecraft_deployment_intents(organization_id,actor_id,created_at DESC);
CREATE INDEX minecraft_deployment_intents_dispatch ON minecraft_deployment_intents(organization_id,dispatch_operation_id);
CREATE FUNCTION minecraft_deployment_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r minecraft_reservations; BEGIN
 SELECT * INTO r FROM minecraft_reservations WHERE organization_id=NEW.organization_id AND id=NEW.reservation_id FOR SHARE;
 IF r.id IS NULL OR r.state<>'allocated' OR r.actor_id<>NEW.actor_id OR r.session_id<>NEW.session_id OR NOT EXISTS(
  SELECT 1 FROM minecraft_reservation_operations o WHERE o.organization_id=NEW.organization_id AND o.reservation_id=r.id AND o.id=NEW.dispatch_operation_id AND o.kind='dispatch' AND o.actor_id=NEW.actor_id AND o.session_id=NEW.session_id
 ) THEN RAISE EXCEPTION 'Invalid deployment intent binding' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER minecraft_deployment_intent_guard BEFORE INSERT ON minecraft_deployment_intents FOR EACH ROW EXECUTE FUNCTION minecraft_deployment_intent_guard();
REVOKE ALL ON FUNCTION minecraft_deployment_intent_guard() FROM PUBLIC;
CREATE TABLE minecraft_deployment_intent_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,intent_id uuid NOT NULL,schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,intent_id),FOREIGN KEY(organization_id,intent_id) REFERENCES minecraft_deployment_intents(organization_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_deployment_intents','minecraft_deployment_intent_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION management_immutable()',t);
 END LOOP; END $$;
GRANT SELECT,INSERT ON minecraft_deployment_intents,minecraft_deployment_intent_outbox TO craftlayer_runtime;
