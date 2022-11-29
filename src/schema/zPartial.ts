import { z } from "zod";
import { resolveThunk, Thunk } from "../util";

export function zPartial<Schema extends z.ZodSchema>(
  schemaThunk: Thunk<Schema>
) {
  return z.lazy(() => {
    return resolveThunk(schemaThunk);
  });
}
