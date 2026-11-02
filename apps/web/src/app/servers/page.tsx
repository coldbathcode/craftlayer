import type { Metadata } from "next";
import { ServerConsole } from "./server-console";
import "./servers.css";
export const metadata: Metadata = { title: "Family servers · CraftLayer" };
export default function ServersPage() {
  return <ServerConsole />;
}
