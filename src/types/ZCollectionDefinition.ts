import { z, ZodBranded, ZodDiscriminatedUnion, ZodObject, ZodUnion } from "zod";

export class ZCollectionDefinition<
  ModelName extends string,
  Schema extends z.ZodSchema
> {
  public collection: string;
  public schema: z.ZodBranded<Schema, ModelName>;

  constructor(public modelName: ModelName, schema: Schema) {
    this.collection = modelName;
    this.schema = schema.brand<ModelName>();
    this.validateSchema(schema);
  }

  private validateSchema(schema: z.ZodSchema) {
    if (schema instanceof ZodBranded) {
      this.validateSchema(schema.unwrap());
    }
    if (schema instanceof ZodObject) {
      const keys = Object.keys(schema.shape);
      if (!keys.includes("_id")) {
        throw new Error("Schema must include _id");
      }
      return;
    }
    if (schema instanceof ZodDiscriminatedUnion) {
      for (const literal of schema.options.keys()) {
        this.validateSchema(schema.options.get(literal));
      }
      return;
    }
    if (schema instanceof ZodUnion) {
      for (const option of schema.options) {
        this.validateSchema(option);
      }
      return;
    }
    console.error(schema);
    throw new Error("Invalid schema");
  }

  create(input: z.infer<Schema>): z.infer<Schema> {
    return this.schema.parse(input);
  }
}

// export type ZCollectionShape<T> = T extends ZCollectionDefinition<any, infer S>
//   ? S["shape"]
//   : never;

export type ZCollectionUnbranded<T> = T extends ZCollectionDefinition<
  any,
  infer S
>
  ? S
  : never;

export type ZCollectionBranded<T> = T extends ZCollectionDefinition<
  infer M,
  infer S
>
  ? z.ZodBranded<S, M>
  : never;

export type ZCollectionModelName<T> = T extends ZCollectionDefinition<
  infer M,
  any
>
  ? M
  : never;
