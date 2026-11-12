import type { Metadata } from "next";
import { FamilyApp } from "./app";
import "./family.css";
export const metadata: Metadata = { title: "Home · CraftLayer" };
export default function HomePage() {
  return <FamilyApp />;
}
