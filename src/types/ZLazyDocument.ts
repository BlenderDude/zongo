import { ObjectId } from "mongodb";
import { z } from "zod";
import { ZCollection } from "./ZCollection";
import {
  ZCollectionDefinition,
  ZCollectionBranded,
} from "./ZCollectionDefinition";

export type ZLazyDocument<Definition extends ZCollectionDefinition<any, any>> =
  {
    [K in keyof z.infer<ZCollectionBranded<Definition>>]: Promise<
      z.infer<ZCollectionBranded<Definition>>[K]
    >;
  };

export function createZLazyDocument<
  Definition extends ZCollectionDefinition<any, any>,
  ZCol extends ZCollection<Definition>
>(
  _id: ObjectId,
  definition: Definition,
  zCollection: ZCol
): ZLazyDocument<Definition> {
  type FullData = z.infer<ZCollectionBranded<Definition>>;
  // const knownKeys = Object.keys(definition.schema._type.shape);
  let pendingRead: Promise<Partial<FullData>> | null = null;
  const promises = new Map<keyof FullData, Promise<Partial<FullData>>>();

  const getKey = async (key: keyof FullData) => {
    if (key === "_id") {
      return _id;
    }
    if (promises.has(key)) {
      return promises.get(key);
    }
    if (pendingRead) {
      promises.set(key, pendingRead);
      const data = await pendingRead;
      return data[key];
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
        const doc = await zCollection.collection.findOne(
          { _id },
          { projection }
        );
        if (!doc) {
          throw new Error("Document not found");
        }
        resolve(doc);
      });
    });
  };

  const proxy = new Proxy(
    {},
    {
      // has(_target, prop) {
      //   return knownKeys.includes(String(prop));
      // },
      get(_target, prop) {
        // if (!knownKeys.includes(prop as string)) {
        //   return undefined;
        // }
        return getKey(prop as keyof FullData);
      },
    }
  );
  return proxy as any;
}
