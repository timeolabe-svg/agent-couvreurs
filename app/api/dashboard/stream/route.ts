import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          // controller already closed
        }
      }

      // Send initial events
      if (process.env.DATABASE_URL) {
        try {
          const { db } = await import('@/lib/db')
          const { dashboard_events } = await import('@/lib/db/schema')
          const { desc } = await import('drizzle-orm')

          const recentEvents = await db
            .select()
            .from(dashboard_events)
            .orderBy(desc(dashboard_events.created_at))
            .limit(20)

          send({ type: 'init', events: recentEvents })
        } catch (err) {
          console.error('[dashboard/stream] init error:', err)
          send({ type: 'init', events: [] })
        }
      } else {
        send({
          type: 'init',
          events: [
            {
              id: 'demo1',
              type: 'email_sent',
              data: { company: 'Toiture Carpentier', contactEmail: 'l.carpentier@gmail.com' },
              created_at: new Date().toISOString(),
            },
            {
              id: 'demo2',
              type: 'reply_received',
              data: { company: 'Toitures Vidal', classification: 'rdv_request' },
              created_at: new Date(Date.now() - 120000).toISOString(),
            },
          ],
          _demo: true,
        })
      }

      let lastEventIds: string[] = []

      const interval = setInterval(async () => {
        try {
          if (!process.env.DATABASE_URL) {
            // Send heartbeat only in demo mode
            send({ type: 'heartbeat', ts: Date.now() })
            return
          }

          const { db } = await import('@/lib/db')
          const { dashboard_events } = await import('@/lib/db/schema')
          const { desc } = await import('drizzle-orm')

          const latest = await db
            .select()
            .from(dashboard_events)
            .orderBy(desc(dashboard_events.created_at))
            .limit(5)

          const newEvents = latest.filter((e) => !lastEventIds.includes(e.id))

          if (newEvents.length > 0) {
            send({ type: 'update', events: newEvents })
            lastEventIds = latest.map((e) => e.id)
          } else {
            send({ type: 'heartbeat', ts: Date.now() })
          }
        } catch {
          clearInterval(interval)
          try { controller.close() } catch { /* already closed */ }
        }
      }, 5000)

      request.signal.addEventListener('abort', () => {
        clearInterval(interval)
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
