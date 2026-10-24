/**
 * In-process live event bus for SSE token/tool streaming.
 * Persisted job.events still hold a durable subset; this bus is low-latency.
 */

import type { JobEvent } from "@/lib/types";

const MAX_EVENTS = 400;
const bus = new Map<string, JobEvent[]>();

export function pushLiveEvent(jobId: string, event: JobEvent) {
  const list = bus.get(jobId) ?? [];
  list.push(event);
  if (list.length > MAX_EVENTS) {
    bus.set(jobId, list.slice(-MAX_EVENTS));
  } else {
    bus.set(jobId, list);
  }
}

export function getLiveEvents(jobId: string): JobEvent[] {
  return bus.get(jobId) ?? [];
}

export function clearLiveEvents(jobId: string) {
  bus.delete(jobId);
}
