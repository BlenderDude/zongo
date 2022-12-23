import * as mongo from "mongodb";
import { z, ZodRawShape } from "zod";
import {
  CollectionDefinition,
  CollectionBranded,
} from "./CollectionDefinition";

export type LazyDocument<Definition extends CollectionDefinition<any, any>> = {
  [K in keyof z.output<CollectionBranded<Definition>>]: Promise<
    z.output<CollectionBranded<Definition>>[K]
  >;
};

export function createLazyDocument<
  Definition extends CollectionDefinition<any, any>
>(
  _id: mongo.ObjectId,
  definition: Definition,
  existingData?: Record<string, any>
): LazyDocument<Definition> {
  type FullData = z.infer<CollectionBranded<Definition>>;

  let pendingRead: Promise<Partial<FullData>> | null = null;
  const promises = new Map<keyof FullData, Promise<Partial<FullData>>>();

  let schemaShapePromise: Promise<ZodRawShape> | null = null;

  for (const key in existingData ?? {}) {
    promises.set(key, Promise.resolve(existingData) as any);
  }

  const getKey = async <Key extends keyof FullData>(
    key: Key,
    validate: boolean
  ): Promise<FullData[Key]> => {
    if (key === "_id") {
      return _id;
    }
    if (key === "then") {
      return undefined;
    }

    if (!schemaShapePromise && validate) {
      schemaShapePromise = definition.getDocumentSchema((key) => {
        return getKey(key, false);
      });
    }

    if (promises.has(key)) {
      if (validate) {
        const docSoFar: any = {};
        for (const [_, promise] of promises) {
          Object.assign(docSoFar, await promise);
        }
        const schemaShape = await schemaShapePromise;
        const schema = z
          .strictObject(schemaShape!)
          .pick(
            Object.fromEntries(Object.keys(docSoFar).map((key) => [key, true]))
          );
        const result: any = await schema.parseAsync(docSoFar);
        return result[key];
      }
      const result: any = await promises.get(key);
      return result[key];
    }
    if (pendingRead) {
      promises.set(key, pendingRead);
      await pendingRead;
      return getKey(key, validate);
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

    return getKey(key, validate);
  };

  const proxy = new Proxy(existingData ?? {}, {
    async get(_target, prop: string) {
      return getKey(prop as keyof FullData, true);
    },
  });
  return proxy as any;
}
