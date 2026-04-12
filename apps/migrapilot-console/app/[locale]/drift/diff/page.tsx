import { Suspense } from "react";

import DriftDiffClient from "./DriftDiffClient";

export default function DriftDiffPage() {
  return (
    <Suspense fallback={<section className="panel" style={{ padding: 16 }}><div className="small">Loading drift diff...</div></section>}>
      <DriftDiffClient />
    </Suspense>
  );
}
