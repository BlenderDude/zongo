import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
  ZCollectionModelName,
} from "./ZCollectionDefinition";
import { ZDatabase } from "./ZDatabase";
import { createZLazyDocument, ZLazyDocument } from "./ZLazyDocument";

export class ZDocumentReference<
  Definition extends ZCollectionDefinition<string, z.ZodSchema>,
  Mask extends Record<string, true | undefined> | undefined = undefined,
  ExistingData extends Record<string, any> = {}
> {
  constructor(
    public _id: ObjectId,
    public definition: Definition,
    private existingData: ExistingData,
    public mask: Mask
  ) {}

  resolve(): ZLazyDocument<Definition> {
    return createZLazyDocument(this._id, this.definition, this.existingData);
  }

  async resolveFull(): Promise<
    Mask extends undefined
      ? z.output<ZCollectionBranded<Definition>>
      : {
          [K in Extract<
            keyof z.output<ZCollectionBranded<Definition>>,
            keyof Mask
          >]: z.output<ZCollectionBranded<Definition>>[K];
        }
  > {
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
