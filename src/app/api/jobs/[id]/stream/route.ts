import { NextRequest } from "next/server";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getJob } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * SSE stream of job tool/status events for Studio live updates.
 * Polls the store so it works with the JSON file backend / Amplify.
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
  let lastCount = 0;
  let ticks = 0;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("hello", {
        jobId: id,
        status: job.status,
        events: job.events ?? [],
      });
      lastCount = job.events?.length ?? 0;

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
          const events = fresh.events ?? [];
          if (events.length > lastCount) {
            send("events", { events: events.slice(lastCount) });
            lastCount = events.length;
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
          // Keep-alive comment every ~15s
          if (ticks % 15 === 0) {
            controller.enqueue(encoder.encode(": ping\n\n"));
          }
          // Safety cap ~10 minutes
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
      }, 1000);

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
