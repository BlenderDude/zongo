import { Collection, Filter, FindOptions } from "mongodb";
import { z } from "zod";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
} from "./ZCollectionDefinition";

export class ZCollection<Definition extends ZCollectionDefinition<any, any>> {
  constructor(
    private definition: Definition,
    public collection: Collection<z.input<ZCollectionBranded<Definition>>>
  ) {}

  async findOne(
    filter: Filter<z.input<ZCollectionBranded<Definition>>>,
    options?: FindOptions
  ) {
    const doc = await this.collection.findOne(filter, options);
    if (!doc) {
      return null;
    }
    return this.hydrate(doc);
  }

  hydrate(
    doc: z.input<ZCollectionBranded<Definition>>
  ): Promise<z.output<ZCollectionBranded<Definition>>> {
    return this.definition.schema.parseAsync(doc);
  }
}
