import * as mongo from "mongodb";
import { z } from "zod";
import {
  CollectionBranded,
  CollectionDefinition,
} from "./CollectionDefinition";

export class Collection<Definition extends CollectionDefinition<any, any>> {
  constructor(
    private definition: Definition,
    public collection: mongo.Collection<z.input<CollectionBranded<Definition>>>
  ) {}

  async findOne(
    filter: mongo.Filter<z.input<CollectionBranded<Definition>>>,
    options?: mongo.FindOptions
  ) {
    const doc = await this.collection.findOne(filter, options);
    if (!doc) {
      return null;
    }
    return this.hydrate(doc);
  }

  hydrate(
    doc: z.input<CollectionBranded<Definition>>
  ): Promise<z.output<CollectionBranded<Definition>>> {
    return this.definition.schema.parseAsync(doc);
  }
}
