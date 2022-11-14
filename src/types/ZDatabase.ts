import { Collection, Db, MongoClient, ObjectId } from "mongodb";
import { BRAND, z, ZodBigInt } from "zod";
import { RemoveZDefinitions } from "../helpers/zEmbeddedSchema";
import { ZCollection } from "./ZCollection";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
  ZCollectionModelName,
  ZRawDocumentType,
} from "./ZCollectionDefinition";
import { ZDocumentReference } from "./ZDocumentReference";
import { createZLazyDocument } from "./ZLazyDocument";
import { AsyncLocalStorage } from "async_hooks";

type CreateDocumentParam<
  Definitions extends DefinitionsType,
  Def extends keyof Definitions
> = RemoveZDefinitions<
  Omit<z.input<ZCollectionBranded<Definitions[Def]>>, typeof BRAND>,
  {
    [DefName in keyof Definitions]: ObjectId;
  }
>;

type DefinitionsType = {
  [key: string]: ZCollectionDefinition<any, any>;
};

export class ZDatabase<Definitions extends DefinitionsType = {}> {
  private definitions = new Map<
    keyof Definitions,
    ZCollectionDefinition<any, any>
  >();

  private static als = new AsyncLocalStorage<ZDatabase<any>>();
  private static globalInstance: ZDatabase<any> | undefined = undefined;

  public static setGlobalInstance(instance: ZDatabase<any>) {
    ZDatabase.globalInstance = instance;
  }

  public static getContextZDB() {
    const ctxZDB = ZDatabase.als.getStore();
    if (ctxZDB) {
      return ctxZDB;
    }
    return this.globalInstance;
  }

  constructor(private db: Db) {
    db.collection("", {
      serializeFunctions: true,
    });
  }

  addDefinition<CollectionDef extends ZCollectionDefinition<any, any>>(
    definition: CollectionDef
  ): ZDatabase<
    Definitions & {
      [key in ZCollectionModelName<CollectionDef>]: CollectionDef;
    }
  > {
    definition.zdb = this;
    this.definitions.set(definition.modelName, definition);

    return this as any;
  }

  getCollection<DefName extends keyof Definitions>(
    defName: DefName
  ): Collection<ZRawDocumentType<Definitions[DefName]>> {
    const definition = this.definitions.get(defName);
    if (!definition) {
      throw new Error(`Collection ${String(defName)} not found`);
    }
    return this.db.collection(definition.modelName);
  }

  async create<Def extends keyof Definitions>(
    def: Def,
    data: CreateDocumentParam<Definitions, Def>
  ) {
    type Definition = Definitions[Def];
    const definition = this.definitions.get(def) as Definition | undefined;
    if (!definition) {
      throw new Error(`Collection ${String(def)} not found`);
    }
    type Result = z.output<ZCollectionBranded<Definition>>;

    const result = (await definition.schema.parseAsync(data)) as Result;
    const resolvedData = await this.getRawDocument<Result>(result);
    await this.getCollection(def).insertOne(resolvedData as any);
    return result;
  }

  findOneLazy<Def extends keyof Definitions>(def: Def, id: ObjectId) {
    const definition = this.definitions.get(def);
    if (!definition) {
      throw new Error(`Collection ${String(def)} not found`);
    }
    return createZLazyDocument(
      id,
      definition as Definitions[Def],
      this.getCollection(def)
    );
  }

  async getRawDocument<Input>(
    input: Input
  ): Promise<ResolveZReferences<Input>> {
    if (input instanceof ZDocumentReference) {
      return input.getExisting();
    }
    if (Array.isArray(input)) {
      return Promise.all(input.map(this.getRawDocument)) as any;
    }
    if (
      typeof input === "object" &&
      input !== null &&
      input.constructor === Object
    ) {
      const result: any = {};
      await Promise.all(
        Object.entries(input).map(async ([key, value]) => {
          result[key] = await this.getRawDocument(value);
        })
      );
      return result;
    }
    return input as any;
  }

  async hydrateMultiple<DefName extends keyof Definitions, Doc extends object>(
    defName: DefName,
    docs:
      | Doc[]
      | ((
          collection: Collection<ZRawDocumentType<Definitions[DefName]>>
        ) => Doc[])
  ): Promise<z.output<ZCollectionBranded<Definitions[DefName]>>[]> {
    let resolvedDocs: Doc[];
    if (typeof docs === "function") {
      resolvedDocs = docs(this.getCollection(defName));
    } else {
      resolvedDocs = docs;
    }
    const definition = this.definitions.get(defName) as Definitions[DefName];
    if (!definition) {
      throw new Error(`Collection ${String(defName)} not found`);
    }
    return Promise.all(
      resolvedDocs.map((doc) => definition.schema.parseAsync(doc))
    ) as any;
  }

  async hydrate<DefName extends keyof Definitions, Doc extends object>(
    defName: DefName,
    doc:
      | Doc
      | null
      | ((
          collection: Collection<ZRawDocumentType<Definitions[DefName]>>
        ) => Doc | null)
  ) {
    let finalDoc: Doc | null;
    if (typeof doc === "function") {
      finalDoc = doc(this.getCollection(defName));
    } else {
      finalDoc = doc;
    }
    if (!finalDoc) {
      return null;
    }

    const definition = this.definitions.get(defName) as Definitions[DefName];
    if (!definition) {
      throw new Error(`Collection ${String(defName)} not found`);
    }
    return definition.schema.parseAsync(finalDoc) as Promise<
      z.output<ZCollectionBranded<Definitions[DefName]>>
    >;
  }

  async runInContext<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      ZDatabase.als.run(this as any, async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}

export type ResolveZReferences<T> = T extends ZDocumentReference<
  any,
  any,
  infer Existing
>
  ? Existing
  : T extends ObjectId | Buffer | Date
  ? T
  : T extends Array<infer U>
  ? Array<ResolveZReferences<U>>
  : T extends object
  ? {
      [K in keyof T]: ResolveZReferences<T[K]>;
    }
  : T;
