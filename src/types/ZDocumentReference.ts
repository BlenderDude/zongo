import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
} from "./ZCollectionDefinition";
import { createZLazyDocument, ZLazyDocument } from "./ZLazyDocument";

export class ZDocumentReference<
  Definition extends ZCollectionDefinition<string, z.ZodSchema>,
  Mask extends Record<string, true | undefined> | undefined = undefined,
  ExistingData extends Record<string, any> = {}
> {
  private existingData: ExistingData;

  constructor(
    public _id: ObjectId,
    public definition: Definition,
    existingData: ExistingData,
    public mask: Mask
  ) {
    this.existingData = {
      ...existingData,
      _id,
    };
  }

  resolve(): ZLazyDocument<Definition> {
    return createZLazyDocument(this._id, this.definition, this.existingData);
  }

  async resolveFull(): Promise<z.output<ZCollectionBranded<Definition>>> {
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
