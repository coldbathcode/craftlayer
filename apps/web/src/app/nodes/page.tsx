import type { Metadata } from "next";
import { NodeConsole } from "./node-console";
import "../servers/servers.css";
import "./nodes.css";
export const metadata: Metadata = { title: "Docker hosts · CraftLayer" };
export default function NodesPage() {
  return <NodeConsole />;
}
