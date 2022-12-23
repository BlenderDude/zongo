import * as mongo from "mongodb";
import { OK, ParseInput, SyncParseReturnType, z, ZodType } from "zod";
import {
  CollectionDefinition,
  CollectionUnbranded,
} from "../types/CollectionDefinition";
import { ResolveZReferences } from "../types/Database";
import { DocumentReference } from "../types/DocumentReference";
import { createLazyDocument } from "../types/LazyDocument";

export class ZodSchemaReferenceWrapper<
  Definition extends CollectionDefinition<any, z.ZodSchema>,
  Mask extends Record<string, true | undefined> | undefined = undefined,
  ExistingData extends Record<string, any> = {}
> extends ZodType<
  DocumentReference<Definition, Mask, ExistingData>,
  {},
  mongo.ObjectId | { _id: mongo.ObjectId } | DocumentReference<any, any, any>
> {
  constructor(public definition: Definition, public mask: Mask) {
    super({});
  }

  async _parse(
    input: ParseInput
  ): Promise<SyncParseReturnType<DocumentReference<any, any, any>>> {
    const { ctx } = this._processInputParams(input);
    if (!ctx.common.async) {
      throw new Error(
        "ZSchemaReferenceWrapper must be used with async parsing"
      );
    }
    const data = ctx.data as
      | mongo.ObjectId
      | { _id: mongo.ObjectId }
      | DocumentReference<any, any, any>;
    if (this.mask !== undefined) {
      const mask = this.mask;
      const requiredKeys = new Set<string>(
        Object.keys(mask).filter((k) => mask[k])
      );
      if (data instanceof mongo.ObjectId) {
        const lazyDocument = createLazyDocument(
          data,
          this.definition,
          undefined
        );
        const requiredData = {} as Record<string, any>;
        const promises: Promise<any>[] = [];
        for (const key of requiredKeys) {
          promises.push(
            lazyDocument[key].then((value) => {
              requiredData[key] = value;
            })
          );
        }
        await Promise.all(promises);
        return OK(
          new DocumentReference(data, this.definition, requiredData, this.mask)
        );
      }
      let existingData: Record<string, any>;
      if (data instanceof DocumentReference) {
        existingData = data.getExisting();
      } else {
        existingData = data;
      }
      const requiredData = {} as Record<string, any>;
      for (const key of requiredKeys) {
        requiredData[key] = existingData[key];
      }
      return OK(
        new DocumentReference(
          data._id,
          this.definition,
          requiredData,
          this.mask
        )
      );
    }
    let _id: mongo.ObjectId;
    if (data instanceof mongo.ObjectId) {
      _id = data;
    } else {
      _id = data._id;
    }

    const document = await this.definition.zdb
      .getCollection(this.definition.modelName)
      .findOne({ _id });

    return OK(new DocumentReference(_id, this.definition, document, this.mask));
  }
}

type UnionOfKeys<T> = T extends any ? keyof T : never;

type DistributiveSelectivePick<T, K extends keyof T> = T extends unknown
  ? {
      [Key in keyof Pick<T, Extract<K, keyof T>>]: Pick<T, K>[Key];
    }
  : never;

export const document = {
  full: <Definition extends CollectionDefinition<any, z.ZodSchema>>(
    definition: Definition
  ) => {
    return new ZodSchemaReferenceWrapper<
      Definition,
      undefined,
      ResolveZReferences<z.output<Definition["schema"]>>
    >(definition, undefined);
  },
  partial: <
    Definition extends CollectionDefinition<any, z.ZodSchema>,
    Mask extends {
      [key in Exclude<
        UnionOfKeys<z.output<Definition["schema"]>>,
        "_id" | typeof z.BRAND
      >]?: true;
    }
  >(
    definition: Definition,
    mask: Mask
  ) => {
    type MaskedOutput = DistributiveSelectivePick<
      z.output<CollectionUnbranded<Definition>>,
      keyof Mask | "_id"
    >;
    return new ZodSchemaReferenceWrapper<Definition, Mask, MaskedOutput>(
      definition,
      mask
    );
  },
  ref: <Definition extends CollectionDefinition<any, z.ZodSchema>>(
    definition: Definition
  ) => {
    return new ZodSchemaReferenceWrapper<
      Definition,
      {},
      { _id: mongo.ObjectId }
    >(definition, {});
  },
};
