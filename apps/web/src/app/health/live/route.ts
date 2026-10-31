import { healthSchema } from "@craftlayer/contracts";
export function GET() {
  return Response.json(
    healthSchema.parse({ status: "ok", service: "web", version: "0.0.0" }),
  );
}
