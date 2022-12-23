import { z, ZodRawShape } from "zod";
import { ResolveZReferences as ResolveReferences, Database } from "./Database";

export class CollectionDefinition<
  ModelName extends string,
  Schema extends z.ZodSchema
> {
  public collection: string;
  public schema: z.ZodBranded<Schema, ModelName>;
  private _zdb: Database<any, any> | null = null;
  set zdb(val: Database<any, any>) {
    this._zdb = val;
  }
  get zdb() {
    if (!this._zdb) {
      throw new Error("ZDB not set");
    }
    return this._zdb;
  }

  constructor(public modelName: ModelName, schema: Schema) {
    this.collection = modelName;
    this.schema = schema.brand<ModelName>();
    this.validateSchema(schema);
  }

  public async getDocumentSchema(
    resolutionKeyGetter: (key: string) => Promise<unknown>
  ): Promise<ZodRawShape> {
    async function traverseSchemaForObject(
      schema: unknown
    ): Promise<ZodRawShape> {
      if (schema instanceof z.ZodObject) {
        return schema.shape;
      } else if (schema instanceof z.ZodDiscriminatedUnion) {
        const key = schema.discriminator;
        const validValues = schema.validDiscriminatorValues;
        const value = await resolutionKeyGetter(key);
        if (!validValues.includes(value)) {
          throw new Error("Invalid discriminator value");
        }
        return traverseSchemaForObject(schema.options.get(value));
      } else if (schema instanceof z.ZodUnion) {
        throw new Error("ZodUnion not supported before first object");
      } else if (schema instanceof z.ZodIntersection) {
        throw new Error("ZodIntersection not supported before first object");
      } else if (schema instanceof z.ZodTuple) {
        throw new Error("ZodIntersection not supported before first object");
      } else if (
        schema instanceof z.ZodBranded ||
        schema instanceof z.ZodNullable ||
        schema instanceof z.ZodOptional
      ) {
        return traverseSchemaForObject(schema.unwrap());
      } else if (schema instanceof z.ZodEffects) {
        return traverseSchemaForObject(schema.innerType());
      } else if (schema instanceof z.ZodLazy) {
        return traverseSchemaForObject(schema.schema);
      } else if (schema instanceof z.ZodRecord) {
        throw new Error("ZodRecord not supported");
      } else if (schema instanceof z.ZodMap) {
        throw new Error("ZodMap not supported");
      } else if (
        schema instanceof z.ZodAny ||
        schema instanceof z.ZodUnknown ||
        schema instanceof z.ZodNever ||
        schema instanceof z.ZodVoid ||
        schema instanceof z.ZodUndefined ||
        schema instanceof z.ZodNull ||
        schema instanceof z.ZodString ||
        schema instanceof z.ZodNumber ||
        schema instanceof z.ZodBigInt ||
        schema instanceof z.ZodBoolean ||
        schema instanceof z.ZodDate ||
        schema instanceof z.ZodFunction ||
        schema instanceof z.ZodPromise ||
        schema instanceof z.ZodLiteral ||
        schema instanceof z.ZodEnum ||
        schema instanceof z.ZodNativeEnum ||
        schema instanceof z.ZodSet ||
        schema instanceof z.ZodDefault
      ) {
        throw new Error(
          "Must reach a ZodObject first before using other primitive types"
        );
      } else {
        throw new Error(`Unsupported schema type: ${schema}`);
      }
    }
    return traverseSchemaForObject(this.schema);
  }

  private validateSchema(schema: z.ZodSchema) {
    function traverseSchemaForObjects(schema: unknown): void {
      if (schema instanceof z.ZodObject) {
        if (!("_id" in schema.shape)) {
          throw new Error("First schema must have _id field");
        }
        return;
      } else if (schema instanceof z.ZodDiscriminatedUnion) {
        for (const option of schema.options.values()) {
          traverseSchemaForObjects(option);
        }
      } else if (schema instanceof z.ZodUnion) {
        throw new Error("ZodUnion not supported before first object");
      } else if (schema instanceof z.ZodIntersection) {
        throw new Error("ZodIntersection not supported before first object");
      } else if (schema instanceof z.ZodTuple) {
        throw new Error("ZodIntersection not supported before first object");
      } else if (
        schema instanceof z.ZodBranded ||
        schema instanceof z.ZodNullable ||
        schema instanceof z.ZodOptional
      ) {
        return traverseSchemaForObjects(schema.unwrap());
      } else if (schema instanceof z.ZodEffects) {
        return traverseSchemaForObjects(schema.innerType());
      } else if (schema instanceof z.ZodLazy) {
        return traverseSchemaForObjects(schema.schema);
      } else if (schema instanceof z.ZodRecord) {
        throw new Error("ZodRecord not supported");
      } else if (schema instanceof z.ZodMap) {
        throw new Error("ZodMap not supported");
      } else if (
        schema instanceof z.ZodAny ||
        schema instanceof z.ZodUnknown ||
        schema instanceof z.ZodNever ||
        schema instanceof z.ZodVoid ||
        schema instanceof z.ZodUndefined ||
        schema instanceof z.ZodNull ||
        schema instanceof z.ZodString ||
        schema instanceof z.ZodNumber ||
        schema instanceof z.ZodBigInt ||
        schema instanceof z.ZodBoolean ||
        schema instanceof z.ZodDate ||
        schema instanceof z.ZodFunction ||
        schema instanceof z.ZodPromise ||
        schema instanceof z.ZodLiteral ||
        schema instanceof z.ZodEnum ||
        schema instanceof z.ZodNativeEnum ||
        schema instanceof z.ZodSet ||
        schema instanceof z.ZodDefault
      ) {
        throw new Error(
          "Must reach a ZodObject first before using other primitive types"
        );
      } else {
        throw new Error(`Unsupported schema type: ${schema}`);
      }
    }
    traverseSchemaForObjects(schema);
  }
}

export type CollectionUnbranded<T> = T extends CollectionDefinition<
  any,
  infer S
>
  ? S
  : never;

export type CollectionBranded<T> = T extends CollectionDefinition<
  infer M,
  infer S
>
  ? z.ZodBranded<S, M>
  : never;

export type CollectionModelName<T> = T extends CollectionDefinition<
  infer M,
  any
>
  ? M
  : never;

export type RawDocumentType<Definition extends CollectionDefinition<any, any>> =
  ResolveReferences<z.output<CollectionBranded<Definition>>>;
