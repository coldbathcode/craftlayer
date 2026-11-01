CREATE TABLE provider_budget_limits(organization_id uuid NOT NULL REFERENCES organizations(id),scope_kind text NOT NULL CHECK(scope_kind IN ('organization','user','project','mission','task')),scope_id uuid NOT NULL,version integer NOT NULL DEFAULT 0,limits jsonb NOT NULL CHECK(pg_column_size(limits)<=4096),active_count integer NOT NULL DEFAULT 0 CHECK(active_count>=0),PRIMARY KEY(organization_id,scope_kind,scope_id),CHECK(scope_kind<>'organization' OR scope_id=organization_id));
CREATE TABLE provider_budget_windows(organization_id uuid NOT NULL,scope_kind text NOT NULL,scope_id uuid NOT NULL,window_start timestamptz NOT NULL,
reserved_calls numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_calls>=0),
reserved_input_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_input_tokens>=0),
reserved_output_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_output_tokens>=0),
reserved_total_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_total_tokens>=0),
reserved_micro_usd numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_micro_usd>=0),
used_calls numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_calls>=0),
used_input_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_input_tokens>=0),
used_output_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_output_tokens>=0),
used_total_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_total_tokens>=0),
used_micro_usd numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_micro_usd>=0),
PRIMARY KEY(organization_id,scope_kind,scope_id,window_start),FOREIGN KEY(organization_id,scope_kind,scope_id) REFERENCES provider_budget_limits(organization_id,scope_kind,scope_id));
CREATE TABLE provider_instance_active(id boolean PRIMARY KEY DEFAULT true CHECK(id=true),active_count integer NOT NULL DEFAULT 0 CHECK(active_count>=0));
CREATE TABLE provider_instance_windows(window_start timestamptz PRIMARY KEY,reserved_calls numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_calls>=0),
reserved_input_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_input_tokens>=0),
reserved_output_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_output_tokens>=0),
reserved_total_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_total_tokens>=0),
reserved_micro_usd numeric(38,0) NOT NULL DEFAULT 0 CHECK(reserved_micro_usd>=0),
used_calls numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_calls>=0),
used_input_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_input_tokens>=0),
used_output_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_output_tokens>=0),
used_total_tokens numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_total_tokens>=0),
used_micro_usd numeric(38,0) NOT NULL DEFAULT 0 CHECK(used_micro_usd>=0));
CREATE TABLE provider_requests(id uuid PRIMARY KEY,organization_id uuid NOT NULL,request_id uuid NOT NULL,user_id uuid NOT NULL,project_id uuid NOT NULL,mission_id uuid,task_id uuid,input_hash char(64) NOT NULL,state text NOT NULL DEFAULT 'claimed' CHECK(state IN ('claimed','complete','blocked','uncertain')),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id),UNIQUE(organization_id,request_id),FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id),FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),CHECK(task_id IS NULL OR mission_id IS NOT NULL));
CREATE TABLE usage_reservations(id uuid PRIMARY KEY,organization_id uuid NOT NULL,request_pk uuid NOT NULL,attempt integer NOT NULL CHECK(attempt BETWEEN 0 AND 2),connection_id uuid NOT NULL,connection_version integer NOT NULL,model_id varchar(180) NOT NULL,pricing jsonb NOT NULL,policy_epoch char(64) NOT NULL,window_start timestamptz NOT NULL,state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','dispatched','settled','uncertain','released')),input_max numeric(38,0) NOT NULL CHECK(input_max>=0),output_max numeric(38,0) NOT NULL CHECK(output_max>=0),tool_max integer NOT NULL DEFAULT 0,max_cost numeric(38,0) NOT NULL CHECK(max_cost>=0),charged_input numeric(38,0),charged_output numeric(38,0),charged_cost numeric(38,0),usage_quality text CHECK(usage_quality IN ('observed','estimated','unknown')),provider_request_id varchar(200),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id),UNIQUE(organization_id,request_pk,attempt),FOREIGN KEY(organization_id,request_pk) REFERENCES provider_requests(organization_id,id),FOREIGN KEY(organization_id,connection_id) REFERENCES provider_connections(organization_id,id));
CREATE INDEX usage_reservations_org_state ON usage_reservations(organization_id,state,created_at);
CREATE TABLE reservation_budget_links(organization_id uuid NOT NULL,reservation_id uuid NOT NULL,scope_kind text NOT NULL,scope_id uuid NOT NULL,window_start timestamptz NOT NULL,PRIMARY KEY(organization_id,reservation_id,scope_kind,scope_id),FOREIGN KEY(organization_id,reservation_id) REFERENCES usage_reservations(organization_id,id),FOREIGN KEY(organization_id,scope_kind,scope_id,window_start) REFERENCES provider_budget_windows(organization_id,scope_kind,scope_id,window_start));
CREATE TABLE usage_ledger(id bigserial PRIMARY KEY,organization_id uuid NOT NULL,reservation_id uuid NOT NULL,event text NOT NULL CHECK(event IN ('reserve','dispatch','settle','release','uncertain','reconcile','adjust')),usage_quality text NOT NULL CHECK(usage_quality IN ('observed','estimated','unknown')),spend_quality text NOT NULL CHECK(spend_quality IN ('estimated','unknown')),reserved_delta jsonb NOT NULL CHECK(pg_column_size(reserved_delta)<=4096),used_delta jsonb NOT NULL CHECK(pg_column_size(used_delta)<=4096),receipt_hash char(64),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(organization_id,reservation_id) REFERENCES usage_reservations(organization_id,id));
CREATE INDEX usage_ledger_org_cursor ON usage_ledger(organization_id,id);
ALTER TABLE provider_budget_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_budget_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON provider_budget_limits USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE provider_budget_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_budget_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON provider_budget_windows USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE provider_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON provider_requests USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON usage_reservations USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE reservation_budget_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_budget_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON reservation_budget_links USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON usage_ledger USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE provider_instance_active ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_instance_active FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_budget_scope ON provider_instance_active USING(current_setting('app.provider_budget',true)='enabled') WITH CHECK(current_setting('app.provider_budget',true)='enabled');
ALTER TABLE provider_instance_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_instance_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_budget_scope ON provider_instance_windows USING(current_setting('app.provider_budget',true)='enabled') WITH CHECK(current_setting('app.provider_budget',true)='enabled');
GRANT SELECT,INSERT,UPDATE ON provider_budget_limits,provider_budget_windows,provider_requests,usage_reservations,provider_instance_active,provider_instance_windows TO craftlayer_runtime;
GRANT SELECT,INSERT ON reservation_budget_links,usage_ledger TO craftlayer_runtime;
GRANT USAGE ON SEQUENCE usage_ledger_id_seq TO craftlayer_runtime;
