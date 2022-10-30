import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
  ZCollectionModelName,
} from "./ZCollectionDefinition";
import { ZDatabase } from "./ZDatabase";
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

  async resolve<ZDB extends ZDatabase<any>>(
    zdb: ZDB
  ): Promise<
    Mask extends "full"
      ? ZCollectionBranded<Definition>
      : Pick<
          z.output<ZCollectionBranded<Definition>>,
          Extract<
            keyof z.output<ZCollectionBranded<Definition>>,
            keyof Mask | "_id"
          >
        >
  > {
    const modelName = this.definition
      .modelName as ZCollectionModelName<Definition>;
    if (this.mask === "full") {
      const collection = zdb.getCollection(modelName);
      return collection.findOne({ _id: this._id }) as any;
    }
    const doc = zdb.findOneLazy(modelName, this._id);
    const manager = new ZLazyDocumentManager(doc);

    const requiredKeys = Object.keys(this.mask).filter(
      (key) => !(key in this.existingData)
    );
    const requiredKeysMask = Object.fromEntries(
      requiredKeys.map((key) => [key, true as const])
    );
    const maskedData = await manager.collect(requiredKeysMask as any);
    return {
      ...this.existingData,
      ...maskedData,
    };
  }
}
