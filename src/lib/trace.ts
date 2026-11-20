import type * as OpenTelemetry from "@opentelemetry/api";
import type { Attributes, Span } from "@opentelemetry/api";
import type { RequestEvent } from "@sveltejs/kit";

type Api = typeof OpenTelemetry;

const API = "@opentelemetry/api";
const tracing: { api: Api | null; loading: Promise<void> | null } = {
  api: null,
  loading: null,
};

export async function startTracing(event: RequestEvent) {
  if (!(tracing.api == null && event.tracing.enabled)) {
    return;
  }

  tracing.loading ??= importApi();
  await tracing.loading;
}

async function importApi() {
  try {
    tracing.api = (await import(/* @vite-ignore */ API)) as Api;
  } catch {}
}

function opened(event: RequestEvent, name: string, attributes: Attributes) {
  if (tracing.api == null || !event.tracing.enabled) {
    return null;
  }
  const { context, trace, SpanStatusCode } = tracing.api;
  const parent = trace.setSpan(context.active(), event.tracing.current);
  const span = trace
    .getTracer("svelte-islands")
    .startSpan(`svelte-islands.${name}`, { attributes }, parent);
  return {
    span,
    within: <T>(run: () => T) => context.with(trace.setSpan(parent, span), run),
    fail(error: unknown) {
      span.recordException(
        error instanceof Error ? error : { message: String(error) },
      );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  };
}

export function traced<T>(
  event: RequestEvent,
  name: string,
  attributes: Attributes,
  run: (span: Span | null) => T,
) {
  const open = opened(event, name, attributes);
  if (open == null) {
    return run(null);
  }
  try {
    return open.within(() => run(open.span));
  } catch (error) {
    open.fail(error);
    throw error;
  } finally {
    open.span.end();
  }
}

export async function tracedAsync<T>(
  event: RequestEvent,
  name: string,
  attributes: Attributes,
  run: (span: Span | null) => Promise<T>,
) {
  const open = opened(event, name, attributes);
  if (open == null) {
    return run(null);
  }
  try {
    return await open.within(async () => run(open.span));
  } catch (error) {
    open.fail(error);
    throw error;
  } finally {
    open.span.end();
  }
}
