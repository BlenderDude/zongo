import { ObjectId } from "mongodb";
import { AsyncParseReturnType, OK, ParseInput, z, ZodType } from "zod";
import {
  ZCollectionDefinition,
  ZCollectionUnbranded,
} from "../types/ZCollectionDefinition";
import { ResolveZReferences } from "../types/ZDatabase";
import { ZDocumentReference } from "../types/ZDocumentReference";
import { createZLazyDocument } from "../zongo";

export class ZSchemaReferenceWrapper<
  Definition extends ZCollectionDefinition<any, z.ZodSchema>,
  Mask extends Record<string, true | undefined> | undefined = undefined,
  ExistingData extends Record<string, any> = {}
> extends ZodType<
  ZDocumentReference<Definition, Mask, ExistingData>,
  {},
  ObjectId | { _id: ObjectId } | ZDocumentReference<any, any, any>
> {
  constructor(public definition: Definition, public mask: Mask) {
    super({});
  }

  async _parse(
    input: ParseInput
  ): AsyncParseReturnType<ZDocumentReference<any, any, any>> {
    const { ctx } = this._processInputParams(input);
    if (!ctx.common.async) {
      throw new Error(
        "ZSchemaReferenceWrapper must be used with async parsing"
      );
    }
    const data = ctx.data as
      | ObjectId
      | { _id: ObjectId }
      | ZDocumentReference<any, any, any>;
    if (this.mask !== undefined) {
      const mask = this.mask;
      const requiredKeys = new Set<string>(
        Object.keys(mask).filter((k) => mask[k])
      );
      if (data instanceof ObjectId) {
        const lazyDocument = createZLazyDocument(
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
          new ZDocumentReference(data, this.definition, requiredData, this.mask)
        );
      }
      let existingData: Record<string, any>;
      if (data instanceof ZDocumentReference) {
        existingData = data.getExisting();
      } else {
        existingData = data;
      }
      const requiredData = {} as Record<string, any>;
      for (const key of requiredKeys) {
        requiredData[key] = existingData[key];
      }
      return OK(
        new ZDocumentReference(
          data._id,
          this.definition,
          requiredData,
          this.mask
        )
      );
    }
    let _id: ObjectId;
    if (data instanceof ObjectId) {
      _id = data;
    } else {
      _id = data._id;
    }

    const document = await this.definition.zdb
      .getCollection(this.definition.modelName)
      .findOne({ _id });

    return OK(
      new ZDocumentReference(_id, this.definition, document, this.mask)
    );
  }
}

type UnionOfKeys<T> = T extends any ? keyof T : never;

type DistributiveSelectivePick<T, K extends keyof T> = T extends unknown
  ? {
      [Key in keyof Pick<T, Extract<K, keyof T>>]: Pick<T, K>[Key];
    }
  : never;

export const zEmbeddedSchema = {
  full: <Definition extends ZCollectionDefinition<any, z.ZodSchema>>(
    definition: Definition
  ) => {
    return new ZSchemaReferenceWrapper<
      Definition,
      undefined,
      ResolveZReferences<z.output<Definition["schema"]>>
    >(definition, undefined);
  },
  partial: <
    Definition extends ZCollectionDefinition<any, z.ZodSchema>,
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
      z.output<ZCollectionUnbranded<Definition>>,
      keyof Mask | "_id"
    >;
    return new ZSchemaReferenceWrapper<Definition, Mask, MaskedOutput>(
      definition,
      mask
    );
  },
  ref: <Definition extends ZCollectionDefinition<any, z.ZodSchema>>(
    definition: Definition
  ) => {
    return new ZSchemaReferenceWrapper<Definition, {}, { _id: ObjectId }>(
      definition,
      {}
    );
  },
};
