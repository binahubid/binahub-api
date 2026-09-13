import type { Instrumentation } from "next";
import { recordRuntimeError } from "./lib/runtime-observability";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await recordRuntimeError({
    message: error instanceof Error ? error.message : "Unhandled API error",
    stack: error instanceof Error ? error.stack : undefined,
    route: context.routePath || request.path,
    code: "UNHANDLED_REQUEST_ERROR",
  });
};
