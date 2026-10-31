import type { Metadata } from "next";
import { IdentityConsole } from "./console";
import "./identity.css";
export const metadata: Metadata = { title: "Your account · CraftLayer" };
export default function AccountPage() {
  return <IdentityConsole />;
}
