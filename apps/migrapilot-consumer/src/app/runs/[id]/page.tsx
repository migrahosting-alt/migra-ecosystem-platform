import type { Metadata } from 'next'
import { getCodingRun } from '@/server/brain/seams'
import { toBrainView } from '@/server/brain/view'
import { RunReportPage } from '@/screens/RunReportPage'

export const metadata: Metadata = { title: 'Run report' }

/** Per-run and session-scoped: never prerender one caller's run for everyone. */
export const dynamic = 'force-dynamic'

export default async function RunReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RunReportPage runId={id} run={toBrainView(await getCodingRun(id))} />
}
