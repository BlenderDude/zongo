import * as mongo from "mongodb";
import { z } from "zod";
import {
  CollectionBranded,
  CollectionDefinition,
} from "./CollectionDefinition";
import { createLazyDocument, LazyDocument } from "./LazyDocument";

export class DocumentReference<
  Definition extends CollectionDefinition<string, z.ZodSchema>,
  Mask extends Record<string, true | undefined> | undefined = undefined,
  ExistingData extends Record<string, any> = {}
> {
  private existingData: ExistingData;

  constructor(
    public _id: mongo.ObjectId,
    public definition: Definition,
    existingData: ExistingData,
    public mask: Mask
  ) {
    this.existingData = {
      ...existingData,
      _id,
    };
  }

  resolve(): LazyDocument<Definition> {
    return createLazyDocument(this._id, this.definition, this.existingData);
  }

  async resolveFull(): Promise<z.output<CollectionBranded<Definition>>> {
    const zdb = this.definition.zdb;

    const modelName = this.definition.modelName;
    const collection = zdb.getCollection(modelName);
    if (this.mask === undefined) {
      return zdb.hydrate(modelName, await collection.findOne(this._id));
    }
    const projection: Record<string, 0> = {};
    for (const key of Object.keys(this.existingData)) {
      projection[key] = 0;
    }
    const missingData = await collection.findOne(this._id, {
      projection,
    });
    const doc = {
      ...this.existingData,
      ...missingData,
    };

    return zdb.hydrate(modelName, doc);
  }

  getExisting() {
    return this.existingData;
  }
}
