import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
} from "./ZCollectionDefinition";
import { ZDatabase } from "./ZDatabase";

export class ZDocumentReference<
  Definitions extends {
    [key: string]: ZCollectionDefinition<any, any>;
  },
  DefName extends keyof Definitions
> {
  constructor(public _id: ObjectId, public def: DefName) {}

  async resolve(
    zdb: ZDatabase<any>
  ): Promise<z.infer<ZCollectionBranded<Definitions[DefName]>> | null> {
    return zdb.getCollection(this.def).findOne({ _id: this._id });
  }
}
