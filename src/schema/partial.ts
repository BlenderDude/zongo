import { PartialDefinition } from "../types/PartialDefinition";

export function partial<PD extends PartialDefinition<any, any>>(partial: PD) {
  return partial.schema as PD["schema"];
}
