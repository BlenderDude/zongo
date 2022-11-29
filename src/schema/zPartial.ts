import { z } from "zod";
import { resolveThunk, Thunk } from "../util";
import { ZPartialDefinition } from "../zongo";

export function zPartial<
  PartialDefinition extends ZPartialDefinition<any, any>
>(schemaThunk: Thunk<PartialDefinition>) {
  return z.lazy(() => {
    return resolveThunk(schemaThunk).schema as PartialDefinition["schema"];
  });
}
