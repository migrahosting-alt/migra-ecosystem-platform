import type { ReactNode } from "react";
import "./migraguard.css";

export default function MigraGuardLayout({children}: {children:ReactNode}) {
  return <div className="migraguard-module">{children}</div>;
}
