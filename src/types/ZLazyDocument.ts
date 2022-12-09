import { ObjectId } from "mongodb";
import { z, ZodRawShape } from "zod";
import {
  ZCollectionDefinition,
  ZCollectionBranded,
} from "./ZCollectionDefinition";

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
