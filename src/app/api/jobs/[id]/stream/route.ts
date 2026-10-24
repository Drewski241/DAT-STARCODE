import { NextRequest } from "next/server";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getJob } from "@/lib/store";
import { getLiveEvents } from "@/lib/job-live-bus";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * SSE stream of job tool/token/status events for Studio live updates.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (job.accountId !== auth.account.id) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let closed = false;
  const seen = new Set<string>();
  let ticks = 0;

  const mergeEvents = () => {
    const durable = job.events ?? [];
    const live = getLiveEvents(id);
    const byId = new Map<string, (typeof durable)[0]>();
    for (const e of [...durable, ...live]) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => a.t.localeCompare(b.t));
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const initial = mergeEvents();
      for (const e of initial) seen.add(e.id);
      send("hello", {
        jobId: id,
        status: job.status,
        events: initial,
      });

      const timer = setInterval(async () => {
        if (closed) {
          clearInterval(timer);
          return;
        }
        ticks += 1;
        try {
          const fresh = await getJob(id);
          if (!fresh) {
            send("error", { message: "Job disappeared" });
            clearInterval(timer);
            controller.close();
            closed = true;
            return;
          }
          const durable = fresh.events ?? [];
          const live = getLiveEvents(id);
          const combined = [...durable, ...live].sort((a, b) =>
            a.t.localeCompare(b.t),
          );
          const novel = combined.filter((e) => !seen.has(e.id));
          if (novel.length) {
            for (const e of novel) seen.add(e.id);
            send("events", { events: novel });
          }
          if (
            fresh.status === "completed" ||
            fresh.status === "failed" ||
            fresh.status === "cancelled"
          ) {
            send("done", {
              status: fresh.status,
              result: fresh.result,
              error: fresh.error,
              toolSteps: fresh.toolSteps,
            });
            clearInterval(timer);
            controller.close();
            closed = true;
            return;
          }
          if (ticks % 15 === 0) {
            controller.enqueue(encoder.encode(": ping\n\n"));
          }
          if (ticks > 600) {
            send("error", { message: "Stream timeout" });
            clearInterval(timer);
            controller.close();
            closed = true;
          }
        } catch (err) {
          send("error", {
            message: err instanceof Error ? err.message : "stream error",
          });
        }
      }, 400);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
