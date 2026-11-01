import type { ExecutionGrant } from "@craftlayer/auth";
import {
  missionSummary,
  runtimeEvent,
  runtimeEventPage,
  runtimeEventPayload,
  runtimeEventType,
} from "@craftlayer/contracts";
import type pg from "pg";
import { z } from "zod";
import { EventCursor } from "./cursor.js";
import { RuntimeRecovery } from "./recovery.js";
import { deny, digest, type MissionRow } from "./repository.js";

interface EventRow {
  sequence: string;
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  mission_id: string | null;
  type: string;
  payload: unknown;
  created_at: Date;
  aggregate_version: number;
}
type Page = z.infer<typeof runtimeEventPage>;
export class RuntimeEvents extends RuntimeRecovery {
  protected override async event(
    c: pg.PoolClient,
    m: Pick<
      MissionRow,
      "organization_id" | "project_id" | "environment_id" | "id"
    >,
    type: string,
    payload: Record<string, unknown>,
  ) {
    const current = await this.mission(c, m.organization_id, m.id);
    await c.query(
      "insert into runtime_events(id,organization_id,project_id,environment_id,mission_id,type,payload,created_at,aggregate_version) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8)",
      [
        m.organization_id,
        m.project_id,
        m.environment_id,
        m.id,
        runtimeEventType.parse(type),
        runtimeEventPayload.parse(payload),
        new Date(this.now()),
        current.version,
      ],
    );
  }
  private scope(grant: ExecutionGrant, mission: string | undefined) {
    return digest({
      org: grant.organizationId,
      env: grant.resource.id,
      user: grant.userId,
      session: grant.sessionId,
      membership: grant.membershipId,
      member_version: grant.membershipVersion,
      user_version: grant.userVersion,
      mission: mission ?? null,
    });
  }
  private async batch<T>(
    grant: ExecutionGrant,
    mission: string | undefined,
    cursor: string | undefined,
    send: (page: Page) => T,
  ): Promise<T> {
    return this.auth.guardExecution(grant, async (p) => {
      if (p.user.account_type !== "adult") deny("SIMULATION_ONLY", 403);
      const page = await this.tx(grant.organizationId, async (c) => {
        const org = grant.organizationId,
          env = grant.resource.id;
        if ((await this.environment(c, org, env)).type !== "simulation")
          deny("SIMULATION_ONLY", 403);
        if (
          mission &&
          (await this.mission(c, org, mission)).environment_id !== env
        )
          deny("NOT_FOUND", 404);
        const codec = new EventCursor(this.cursorSecret, this.now),
          scope = this.scope(grant, mission),
          decoded = cursor ? codec.decode(scope, cursor) : undefined;
        const missing = decoded?.anchor
          ? !(
              await c.query(
                "select 1 from runtime_events where organization_id=$1 and environment_id=$2 and ($3::uuid is null or mission_id=$3) and sequence=$4 and id=$5",
                [org, env, mission ?? null, decoded.sequence, decoded.anchor],
              )
            ).rowCount
          : false;
        if (!decoded || decoded.expired || missing) {
          const last = (
              await c.query<EventRow>(
                "select * from runtime_events where organization_id=$1 and environment_id=$2 and ($3::uuid is null or mission_id=$3) order by sequence desc limit 1",
                [org, env, mission ?? null],
              )
            ).rows[0],
            rows = (
              await c.query<MissionRow>(
                "select * from runtime_missions where organization_id=$1 and environment_id=$2 and ($3::uuid is null or id=$3) order by created_at desc,id limit 21",
                [org, env, mission ?? null],
              )
            ).rows,
            snapshot = [];
          for (const m of rows.slice(0, 20)) {
            const { tasks: _, ...summary } = await this.view(c, m);
            snapshot.push(missionSummary.parse(summary));
          }
          return runtimeEventPage.parse({
            items: [],
            cursor: codec.encode(
              scope,
              last?.sequence ?? "0",
              last?.id ?? null,
            ),
            has_more: false,
            resync_required: !!decoded,
            snapshot,
            snapshot_truncated: rows.length > 20,
          });
        }
        const rows = (
            await c.query<EventRow>(
              "select * from runtime_events where organization_id=$1 and environment_id=$2 and ($3::uuid is null or mission_id=$3) and sequence>$4 order by sequence limit 51",
              [org, env, mission ?? null, decoded.sequence],
            )
          ).rows,
          items = rows.slice(0, 50).map((e) =>
            runtimeEvent.parse({
              schema_version: 1,
              event_id: e.id,
              cursor: codec.encode(scope, e.sequence, e.id),
              type: e.type,
              organization_id: e.organization_id,
              project_id: e.project_id,
              environment_id: e.environment_id,
              mission_id: e.mission_id,
              occurred_at: e.created_at.toISOString(),
              aggregate_version: e.aggregate_version,
              payload: e.payload,
            }),
          ),
          last = rows[Math.min(rows.length, 50) - 1];
        return runtimeEventPage.parse({
          items,
          cursor: codec.encode(
            scope,
            last?.sequence ?? decoded.sequence,
            last?.id ?? decoded.anchor,
          ),
          has_more: rows.length > 50,
          resync_required: false,
          snapshot: null,
          snapshot_truncated: false,
        });
      });
      // Bounded synchronous enqueue only: authorization locks never span socket backpressure waits.
      return send(page);
    });
  }
  async eventPage(
    token: string,
    org: string,
    environment: string,
    cursor?: string,
    mission?: string,
  ) {
    const stream = await this.openEvents(
      token,
      org,
      environment,
      cursor,
      mission,
    );
    return stream.poll((page) => page);
  }
  async openEvents(
    token: string,
    org: string,
    environment: string,
    cursor?: string,
    mission?: string,
  ) {
    z.uuid().parse(environment);
    if (mission) z.uuid().parse(mission);
    const grant = await this.auth.issueExecutionGrant(
      token,
      org,
      "mission:read",
      { kind: "environment", id: environment },
    );
    await this.auth.guardExecution(grant, async (p) => {
      if (p.user.account_type !== "adult") deny("SIMULATION_ONLY", 403);
    });
    let position = cursor;
    return {
      key: `${org}/${grant.userId}`,
      organization: org,
      poll: <T>(send: (page: Page) => T) =>
        this.batch(grant, mission, position, (page) => {
          const result = send(page);
          position = page.cursor;
          return result;
        }),
    };
  }
}
