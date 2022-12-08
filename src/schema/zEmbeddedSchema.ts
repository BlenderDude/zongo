import { ObjectId } from "mongodb";
import {
  ParseInput,
  ParseReturnType,
  z,
  ZodBrandedDef,
  ZodObject,
  ZodType,
} from "zod";
import {
  ZCollectionDefinition,
  ZCollectionModelName,
  ZCollectionUnbranded,
} from "../types/ZCollectionDefinition";
import { ZDocumentReference } from "../types/ZDocumentReference";
import { zObjectId } from "./zObjectId";
import { Thunk, resolveThunk } from "../util";

type RemoveBrand<T> = T extends z.ZodBranded<infer S, any> ? S : never;

export const DEF_NAME_SYM: unique symbol = Symbol("DEF_NAME_SYM");

type DefNameBrand<DefName extends string> = {
  [DEF_NAME_SYM]: DefName;
};

export class ZSchemaReferenceWrapper<
  Schema extends z.ZodSchema,
  Definition extends ZCollectionDefinition<any, z.ZodSchema>
> extends ZodType<
  Schema["_output"] & DefNameBrand<ZCollectionModelName<Definition>>,
  ZodBrandedDef<Schema>,
  Schema["_input"] & DefNameBrand<ZCollectionModelName<Definition>>
> {
  constructor(
    public definition: Definition,
    public mask: string[] | undefined,
    def: z.ZodBrandedDef<any>
  ) {
    super(def);
  }

  _parse(input: ParseInput): ParseReturnType<any> {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx,
    });
  }
}

function schemaWrapper<
  Schema extends z.ZodSchema,
  Definition extends ZCollectionDefinition<any, z.ZodSchema>,
  Mask extends Record<string, true | undefined> | undefined
>(schemaThunk: Thunk<Schema>, definitionThunk: Thunk<Definition>, mask?: Mask) {
  const maskArray = Object.keys(mask || {});

  return z.lazy(() => {
    const schema = resolveThunk(schemaThunk);
    const definition = resolveThunk(definitionThunk);
    return z
      .union([
        zObjectId(),
        z.instanceof(ZDocumentReference),
        new ZSchemaReferenceWrapper<Schema, Definition>(
          definition,
          mask ? maskArray : undefined,
          {
            type: schema,
            typeName: z.ZodFirstPartyTypeKind.ZodBranded,
          }
        ),
      ])
      .transform<ZDocumentReference<Definition, Mask, z.output<Schema>>>(
        async (
          data: z.output<Schema> | ObjectId | ZDocumentReference<any, any, any>
        ) => {
          if (data instanceof ZDocumentReference) {
            return data;
          }
          // If object is ID, then resolve reference to minimal required data
          if (data instanceof ObjectId) {
            const { zdb } = definition;
            const collection = zdb.getCollection(definition.modelName);
            if (mask !== undefined) {
              const projection: Record<string, 1> = {};
              for (const key in mask) {
                if (mask[key] === true) {
                  projection[key] = 1;
                }
              }
              const doc = await collection.findOne(data, {
                projection,
              });
              return new ZDocumentReference(data, definition, doc, mask) as any;
            }
            const doc = await collection.findOne(data);
            return new ZDocumentReference(data, definition, doc, mask);
          }
          if (data._id instanceof ObjectId) {
            return new ZDocumentReference(data._id, definition, data, mask);
          }
          throw new Error("Invalid data, must have _id");
        }
      );
  });
}

export const zEmbeddedSchema = {
  full: <Definition extends ZCollectionDefinition<any, z.ZodSchema>>(
    definitionThunk: Thunk<Definition>
  ) => {
    return schemaWrapper<
      ZCollectionUnbranded<Definition>,
      Definition,
      undefined
    >(() => {
      const definition = resolveThunk(definitionThunk);
      return definition.schema.unwrap() as ZCollectionUnbranded<Definition>;
    }, definitionThunk);
  },
  partial: <
    Definition extends ZCollectionDefinition<any, z.AnyZodObject>,
    Mask extends {
      [key in keyof Omit<
        RemoveBrand<Definition["schema"]>["shape"],
        "_id"
      >]?: true;
    }
  >(
    definitionThunk: Thunk<Definition>,
    mask: Mask
  ) => {
    type S = ZCollectionUnbranded<Definition>;

    return schemaWrapper<
      ZodObject<
        Pick<S["shape"], Extract<keyof S["shape"], keyof Mask> | "_id">,
        any,
        any
      >,
      Definition,
      Mask
    >(
      () => {
        const definition = resolveThunk(definitionThunk);
        const unbrandedSchema = definition.schema.unwrap() as S;
        return unbrandedSchema.pick(
          Object.assign(mask, { _id: true })
        ) as ZodObject<
          Pick<S["shape"], Extract<keyof S["shape"], keyof Mask> | "_id">,
          any,
          any
        >;
      },
      definitionThunk,
      mask
    );
  },
  ref: <Definition extends ZCollectionDefinition<any, z.ZodSchema>>(
    definitionThunk: Thunk<Definition>
  ) => {
    const refSchema = z.object({
      _id: zObjectId(),
    });
    return schemaWrapper<typeof refSchema, Definition, {}>(
      () => refSchema,
      definitionThunk
    );
  },
};

export type RemoveZDefinitions<
  T,
  EmbeddedSubstitute extends Record<string, any>
> = T extends ObjectId | Buffer | Date
  ? T
  : T extends Array<infer U>
  ? Array<RemoveZDefinitions<U, EmbeddedSubstitute>>
  : T extends { [DEF_NAME_SYM]: infer DefName }
  ?
      | (DefName extends string ? EmbeddedSubstitute[DefName] : never)
      | {
          [K in keyof Omit<T, typeof DEF_NAME_SYM>]: RemoveZDefinitions<
            T[K],
            EmbeddedSubstitute
          >;
        }
  : T extends object
  ? {
      [K in keyof T]: RemoveZDefinitions<T[K], EmbeddedSubstitute>;
    }
  : T;
