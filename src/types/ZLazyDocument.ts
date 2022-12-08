import { Collection, ObjectId } from "mongodb";
import { z, ZodRawShape } from "zod";
import { ZCollection } from "./ZCollection";
import {
  ZCollectionDefinition,
  ZCollectionBranded,
} from "./ZCollectionDefinition";
import { ZDocumentReference } from "./ZDocumentReference";

export type ZLazyDocument<Definition extends ZCollectionDefinition<any, any>> =
  {
    [K in keyof z.output<ZCollectionBranded<Definition>>]: Promise<
      z.output<ZCollectionBranded<Definition>>[K]
    >;
  };

export function createZLazyDocument<
  Definition extends ZCollectionDefinition<any, any>
>(
  _id: ObjectId,
  definition: Definition,
  existingData?: Record<string, any>
): ZLazyDocument<Definition> {
  type FullData = z.infer<ZCollectionBranded<Definition>>;

  let pendingRead: Promise<Partial<FullData>> | null = null;
  const promises = new Map<keyof FullData, Promise<Partial<FullData>>>();

  for (const key in existingData ?? {}) {
    promises.set(key, Promise.resolve(existingData) as any);
  }

  const getKey = async <Key extends keyof FullData>(
    key: Key
  ): Promise<FullData[Key]> => {
    if (key === "_id") {
      return _id;
    }
    if (key === "then") {
      return undefined;
    }

    if (promises.has(key)) {
      const docSoFar = {};
      for (const [_, promise] of promises) {
        Object.assign(docSoFar, await promise);
      }
      const parsedResult = await definition.schema.safeParseAsync(docSoFar);
      if (parsedResult.success) {
        return parsedResult.data[key] as any;
      }
      throw new Error("Parsing failed");
    }
    if (pendingRead) {
      promises.set(key, pendingRead);
      await pendingRead;
      return getKey(key);
    }

    pendingRead = new Promise(async (resolve) => {
      setImmediate(async () => {
        const keys = Array.from(promises.entries())
          .filter(([_, promise]) => promise === pendingRead)
          .map(([key, _]) => key);
        pendingRead = null;
        const projection: Partial<Record<keyof FullData, 1>> = {};
        for (const key of keys) {
          projection[key] = 1;
        }
        const collection = definition.zdb.getCollection(definition.modelName);
        const doc = await collection.findOne(
          { _id },
          {
            projection: {
              _id: 0,
              ...projection,
            },
          }
        );
        if (!doc) {
          throw new Error("Document not found");
        }
        resolve(doc);
      });
    });

    return getKey(key);
  };

  async function traverseSchemaForObject(
    schema: unknown
  ): Promise<ZodRawShape> {
    if (schema instanceof z.ZodObject) {
      return schema.shape;
    } else if (schema instanceof z.ZodUnion) {
      throw new Error("ZodUnion not supported before first object");
    } else if (schema instanceof z.ZodIntersection) {
      throw new Error("ZodIntersection not supported before first object");
    } else if (schema instanceof z.ZodDiscriminatedUnion) {
      const key = schema.discriminator;
      const validValues = schema.validDiscriminatorValues;
      const value = await getKey(key);
      if (!validValues.includes(value)) {
        throw new Error("Invalid discriminator value");
      }
      return traverseSchemaForObject(schema.options.get(value));
    } else if (schema instanceof z.ZodTuple) {
      throw new Error("ZodIntersection not supported before first object");
    } else if (schema instanceof z.ZodBranded) {
      return traverseSchemaForObject(schema.unwrap());
    } else if (schema instanceof z.ZodNullable) {
      return traverseSchemaForObject(schema.unwrap());
    } else if (schema instanceof z.ZodEffects) {
      return traverseSchemaForObject(schema.innerType());
    } else if (schema instanceof z.ZodSet) {
      return traverseSchemaForObject(schema._def.valueType);
    } else if (schema instanceof z.ZodOptional) {
      return traverseSchemaForObject(schema.unwrap());
    } else if (schema instanceof z.ZodLazy) {
      return traverseSchemaForObject(schema.schema);
    } else if (schema instanceof z.ZodDefault) {
      return traverseSchemaForObject(schema.removeDefault());
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
      schema instanceof z.ZodNativeEnum
    ) {
      throw new Error("Unsupported schema type");
    } else {
      throw new Error(`Unsupported schema type: ${schema}`);
    }
  }

  let schemaShape: Promise<ZodRawShape> | null = null;

  function getSchemaShape(): Promise<ZodRawShape> {
    if (!schemaShape) {
      schemaShape = traverseSchemaForObject(definition.schema);
    }
    return schemaShape;
  }

  const proxy = new Proxy(existingData ?? {}, {
    async get(_target, prop: string) {
      const schemaShape = await getSchemaShape();
      if (!(prop in schemaShape)) {
        return undefined;
      }
      return z
        .strictObject({
          [prop]: schemaShape[prop],
        })
        .parseAsync({
          [prop]: await getKey(prop as keyof FullData),
        })
        .then((res) => res[prop]);
    },
  });
  return proxy as any;
}
