import { Collection, ObjectId } from "mongodb";
import { z } from "zod";
import { ZCollection } from "./ZCollection";
import {
  ZCollectionDefinition,
  ZCollectionBranded,
} from "./ZCollectionDefinition";
import { ZDocumentReference } from "./ZDocumentReference";

export type ZLazyDocument<Definition extends ZCollectionDefinition<any, any>> =
  {
    [K in keyof z.infer<ZCollectionBranded<Definition>>]: Promise<
      z.infer<ZCollectionBranded<Definition>>[K]
    >;
  };

export function createZLazyDocument<
  Definition extends ZCollectionDefinition<any, any>
>(
  _id: ObjectId,
  definition: Definition,
  collection: Collection<any>,
  existingData?: Record<string, any>
): ZLazyDocument<Definition> {
  type FullData = z.infer<ZCollectionBranded<Definition>>;
  // const knownKeys = Object.keys(definition.schema._type.shape);
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

  const proxy = new Proxy(existingData ?? {}, {
    // has(_target, prop) {
    //   return knownKeys.includes(String(prop));
    // },
    get(_target, prop) {
      // if (!knownKeys.includes(prop as string)) {
      //   return undefined;
      // }
      return getKey(prop as keyof FullData);
    },
  });
  return proxy as any;
}
