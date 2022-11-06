import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
  ZCollectionModelName,
} from "./ZCollectionDefinition";
import { ZDatabase } from "./ZDatabase";
import { createZLazyDocument, ZLazyDocument } from "./ZLazyDocument";
import { ZLazyDocumentManager } from "./ZLazyDocumentManager";

export class ZDocumentReference<
  Definition extends ZCollectionDefinition<string, z.ZodSchema>,
  Mask extends Record<string, true | undefined> = never
> {
  constructor(
    public _id: ObjectId,
    public definition: Definition,
    private existingData: any,
    public mask: Mask | "full"
  ) {}

  resolve<ZDB extends ZDatabase<any>>(zdb: ZDB): ZLazyDocument<Definition> {
    return createZLazyDocument(
      this._id,
      this.definition,
      zdb.getCollection(this.definition.modelName),
      this.existingData
    );
  }

  async resolveFull<ZDB extends ZDatabase<any>>(
    zdb: ZDB
  ): Promise<z.output<ZCollectionBranded<Definition>>> {
    const modelName = this.definition.modelName;
    const collection = zdb.getCollection(modelName);
    if (this.mask === "full") {
      return collection.findOne(this._id);
    }
    const projection: Record<string, 0> = {};
    for (const key of Object.keys(this.existingData)) {
      projection[key] = 0;
    }
    const missingData = await collection.collection.findOne(this._id, {
      projection,
    });
    const doc = {
      ...this.existingData,
      ...missingData,
    };

    return collection.hydrate(doc);
  }
}
