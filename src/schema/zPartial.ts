import { ZPartialDefinition } from "../zongo";

export function zPartial<
  PartialDefinition extends ZPartialDefinition<any, any>
>(partial: PartialDefinition) {
  return partial.schema as PartialDefinition["schema"];
}
