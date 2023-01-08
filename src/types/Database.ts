import { AsyncLocalStorage } from "async_hooks";
import * as mongo from "mongodb";
import { BRAND, z } from "zod";
import { ZodSchemaReferenceWrapper } from "../schema/document";
import {
  CollectionBranded,
  CollectionDefinition,
  CollectionModelName,
  RawDocumentType,
} from "./CollectionDefinition";
import { DocumentReference } from "./DocumentReference";
import { createLazyDocument } from "./LazyDocument";
import {
  PartialDefinition,
  PartialName,
  PartialSchema,
} from "./PartialDefinition";

type CreateDocumentParam<
  Definitions extends DefinitionsType,
  Def extends keyof Definitions
> = Omit<z.input<CollectionBranded<Definitions[Def]>>, typeof BRAND>;

type DefinitionsType = {
  [key: string]: CollectionDefinition<any, any>;
};

type PartialsType = {
  [key: string]: PartialDefinition<any, any>;
};

type Merge<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

export class Database<
  Definitions extends DefinitionsType = {},
  Partials extends PartialsType = {}
> {
  public definitions: Definitions = {} as any;
  public partials: Partials = {} as any;

  private static als = new AsyncLocalStorage<Database<any, any>>();
  private static globalInstance: Database<any, any> | undefined = undefined;

  get definitionNames(): Array<keyof Definitions> {
    return Object.keys(this.definitions);
  }

  get partialNames(): Array<keyof Partials> {
    return Object.keys(this.partials);
  }

  public static setGlobalInstance(instance: Database<any, any>) {
    Database.globalInstance = instance;
  }

  public static getContextZDB() {
    const ctxZDB = Database.als.getStore();
    if (ctxZDB) {
      return ctxZDB;
    }
    return this.globalInstance;
  }

  constructor(private client: mongo.MongoClient, private db: mongo.Db) {}

  addDefinition<CollectionDef extends CollectionDefinition<any, any>>(
    definition: CollectionDef
  ): Database<
    Merge<
      Definitions & {
        [key in CollectionModelName<CollectionDef>]: CollectionDef;
      }
    >,
    Partials
  > {
    definition.zdb = this;
    (this.definitions as any)[definition.modelName] = definition;

    return this as any;
  }

  addDefinitions<
    NewDefinitions extends readonly CollectionDefinition<any, any>[]
  >(
    definitions: NewDefinitions
  ): Database<
    Merge<
      Definitions & {
        [Definition in NewDefinitions[number] as CollectionModelName<Definition>]: Definition;
      }
    >,
    Partials
  > {
    for (const definition of definitions) {
      this.addDefinition(definition);
    }
    return this as any;
  }

  addPartial<PartialDef extends PartialDefinition<any, any>>(
    definition: PartialDef
  ): Database<
    Definitions,
    Merge<Partials & { [key in PartialName<PartialDef>]: PartialDef }>
  > {
    definition.zdb = this;
    (this.partials as any)[definition.name] = definition;

    return this as any;
  }

  addPartials<NewPartials extends readonly PartialDefinition<any, any>[]>(
    definitions: NewPartials
  ): Database<
    Definitions,
    Merge<
      Partials & {
        [Definition in NewPartials[number] as PartialName<Definition>]: Definition;
      }
    >
  > {
    for (const definition of definitions) {
      this.addPartial(definition);
    }
    return this as any;
  }

  getCollection<DefName extends keyof Definitions>(
    defName: DefName
  ): mongo.Collection<RawDocumentType<Definitions[DefName]>> {
    const definition = this.definitions[defName];
    if (!definition) {
      throw new Error(`Collection ${String(defName)} not found`);
    }
    return this.db.collection(definition.modelName);
  }

  async create<DefName extends keyof Definitions>(
    def: DefName,
    data: CreateDocumentParam<Definitions, DefName>
  ) {
    const definition = this.definitions[def];
    if (!definition) {
      throw new Error(`Collection ${String(def)} not found`);
    }
    type Result = z.output<CollectionBranded<typeof definition>>;

    const result = (await definition.schema.parseAsync(data)) as Result;
    const resolvedData = await this.getRawDocument<Result>(result);
    await this.getCollection(def).insertOne(resolvedData as any);
    return result;
  }

  async replace<Def extends keyof Definitions>(
    def: Def,
    data: CreateDocumentParam<Definitions, Def>
  ) {
    const definition = this.definitions[def];
    if (!definition) {
      throw new Error(`Collection ${String(def)} not found`);
    }
    type Result = z.output<CollectionBranded<typeof definition>>;

    const result = (await definition.schema.parseAsync(data)) as Result;
    const resolvedData = await this.getRawDocument<Result>(result);
    await this.getCollection(def).replaceOne(
      { _id: result._id },
      resolvedData as any
    );
    return result;
  }

  async update<Def extends keyof Definitions>(
    def: Def,
    _id: mongo.ObjectId,
    data:
      | Partial<CreateDocumentParam<Definitions, Def>>
      | ((
          current: z.output<CollectionBranded<Definitions[Def]>>
        ) =>
          | Promise<CreateDocumentParam<Definitions, Def>>
          | CreateDocumentParam<Definitions, Def>),
    options?: Partial<{
      updateReferences: boolean;
      session: mongo.ClientSession;
    }>
  ) {
    const computedOptions = Object.assign(
      {
        updateReferences: true,
      },
      options ?? {}
    );
    const definition = this.definitions[def];
    if (!definition) {
      throw new Error(`Collection ${String(def)} not found`);
    }
    type Result = z.output<CollectionBranded<typeof definition>>;

    const session = computedOptions.session ?? this.client.startSession();

    try {
      if (!computedOptions.session) {
        session.startTransaction();
      }

      const collection = this.getCollection(def) as mongo.Collection<any>;
      const current = await collection.findOne(
        {
          _id,
        },
        { session }
      );

      if (!current) {
        throw new Error(`Document ${String(_id)} not found`);
      }

      let newData: CreateDocumentParam<Definitions, Def>;
      if (typeof data === "function") {
        newData = await data(current);
      } else {
        newData = {
          ...current,
          ...data,
        };
      }

      const result = (await definition.schema.parseAsync(newData)) as Result;
      const resolvedData = await this.getRawDocument<Result>(result);
      await this.getCollection(def).replaceOne(
        { _id: result._id },
        resolvedData as any,
        { session }
      );
      if (computedOptions.updateReferences) {
        await this.updateReferences(def, result._id, { session });
      }
      if (!computedOptions.session) {
        await session.commitTransaction();
      }
      return result;
    } catch (e) {
      if (!computedOptions.session) {
        await session.abortTransaction();
      }
      throw e;
    } finally {
      if (!computedOptions.session) {
        await session.endSession();
      }
    }
  }

  findOneLazy<Def extends keyof Definitions>(def: Def, id: mongo.ObjectId) {
    const definition = this.definitions[def];
    if (!definition) {
      throw new Error(`Collection ${String(def)} not found`);
    }
    return createLazyDocument(
      id,
      definition as Definitions[Def],
      this.getCollection(def)
    );
  }

  async getRawDocument<Input>(
    input: Input
  ): Promise<ResolveZReferences<Input>> {
    if (input instanceof DocumentReference) {
      return await this.getRawDocument(input.getExisting());
    }
    if (Array.isArray(input)) {
      return Promise.all(input.map((elem) => this.getRawDocument(elem))) as any;
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
          collection: mongo.Collection<RawDocumentType<Definitions[DefName]>>
        ) => Doc[] | Promise<Doc[]>)
  ): Promise<z.output<CollectionBranded<Definitions[DefName]>>[]> {
    let resolvedDocs: Doc[];
    if (typeof docs === "function") {
      resolvedDocs = await docs(this.getCollection(defName));
    } else {
      resolvedDocs = docs;
    }
    const definition = this.definitions[defName];
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
          collection: mongo.Collection<RawDocumentType<Definitions[DefName]>>
        ) => Doc | Promise<Doc> | null)
  ) {
    let finalDoc: Doc | null;
    if (typeof doc === "function") {
      finalDoc = await doc(this.getCollection(defName));
    } else {
      finalDoc = doc;
    }
    if (!finalDoc) {
      return null;
    }

    const definition = this.definitions[defName];
    if (!definition) {
      throw new Error(`Collection ${String(defName)} not found`);
    }
    return definition.schema.parseAsync(finalDoc) as Promise<
      z.output<CollectionBranded<Definitions[DefName]>>
    >;
  }

  async runInContext<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      Database.als.run(this as any, async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async getReferences<DefName extends keyof Definitions>(defName: DefName) {
    const locations = new Map<
      keyof Definitions,
      Array<{
        path: string;
        mask?: Record<string, boolean>;
      }>
    >();

    for (const [traversedDefName, definition] of Object.entries(
      this.definitions
    )) {
      function traverseSchema(schema: unknown, pathSoFar: string[]) {
        if (schema instanceof ZodSchemaReferenceWrapper) {
          if (schema.definition.collection === defName) {
            const location = locations.get(traversedDefName) ?? [];
            location.push({
              path: pathSoFar.join("."),
              mask: schema.mask,
            });
            locations.set(traversedDefName, location);
          }
        } else if (schema instanceof z.ZodObject) {
          Object.entries(schema.shape).forEach(([key, value]) => {
            traverseSchema(value, pathSoFar.concat(key));
          });
        } else if (schema instanceof z.ZodArray) {
          traverseSchema(schema.element, pathSoFar.concat("$"));
        } else if (schema instanceof z.ZodUnion) {
          for (const option of schema.options) {
            traverseSchema(option, pathSoFar.concat());
          }
        } else if (schema instanceof z.ZodIntersection) {
          traverseSchema(schema._def.left, pathSoFar);
          traverseSchema(schema._def.right, pathSoFar);
        } else if (schema instanceof z.ZodDiscriminatedUnion) {
          schema.options.forEach((option) => {
            traverseSchema(option, pathSoFar.concat());
          });
        } else if (schema instanceof z.ZodTuple) {
          (schema.items as any[]).forEach((item, index) => {
            traverseSchema(item, pathSoFar.concat(index.toString()));
          });
        } else if (schema instanceof z.ZodBranded) {
          traverseSchema(schema.unwrap(), pathSoFar.concat());
        } else if (schema instanceof z.ZodNullable) {
          traverseSchema(schema.unwrap(), pathSoFar.concat());
        } else if (schema instanceof z.ZodEffects) {
          traverseSchema(schema.innerType(), pathSoFar.concat());
        } else if (schema instanceof z.ZodSet) {
          traverseSchema(schema._def.valueType, pathSoFar.concat("$"));
        } else if (schema instanceof z.ZodOptional) {
          traverseSchema(schema.unwrap(), pathSoFar.concat());
        } else if (schema instanceof z.ZodLazy) {
          traverseSchema(schema.schema, pathSoFar.concat());
        } else if (schema instanceof z.ZodDefault) {
          traverseSchema(schema.removeDefault(), pathSoFar.concat());
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
          return;
        } else {
          console.log(`Unknown schema type`, schema);
        }
      }
      traverseSchema(definition.schema, []);
    }
    return locations;
  }

  async updateReferences<DefName extends keyof Definitions>(
    defName: DefName,
    _id: mongo.ObjectId,
    options?: Partial<{ session: mongo.ClientSession }>
  ) {
    const computedOptions = Object.assign({}, options);
    const collection = this.getCollection(defName) as mongo.Collection<any>;
    const document = await collection.findOne({
      _id,
    });
    if (!document) {
      throw new Error(`Document ${String(_id)} not found`);
    }
    const definition = this.definitions[defName];
    const resolvedDocument = await this.getRawDocument(
      await definition.schema.parseAsync(document)
    );
    const session = computedOptions.session ?? this.client.startSession();

    try {
      if (!computedOptions.session) {
        session.startTransaction();
      }
      const references = await this.getReferences(defName);
      for (const [refDefName, collectionRefs] of references.entries()) {
        for (const ref of collectionRefs) {
          const collection = this.getCollection(
            refDefName
          ) as mongo.Collection<any>;
          const _id = resolvedDocument._id as mongo.ObjectId;
          const idPath = `${ref.path}._id`;
          const updateKeys: Record<string, any> = {};
          for (const key of Object.keys(ref.mask ?? resolvedDocument)) {
            updateKeys[`${ref.path}.${key}`] = resolvedDocument[key];
          }
          function buildFilter(pathParts: string[]): any {
            if (pathParts.length === 0) {
              return _id;
            }
            for (const [index, part] of pathParts.entries()) {
              if (part === "$") {
                return {
                  [pathParts.slice(0, index).join(".")]: {
                    $elemMatch: buildFilter(pathParts.slice(index + 1)),
                  },
                };
              }
            }
            return {
              [pathParts.join(".")]: buildFilter([]),
            };
          }
          const filter = buildFilter(idPath.split("."));
          await collection.updateMany(filter, {
            $set: updateKeys,
          });
        }
      }
      if (!computedOptions.session) {
        await session.commitTransaction();
      }
    } catch (e) {
      if (!computedOptions.session) {
        await session.abortTransaction();
      }
      throw e;
    } finally {
      if (!computedOptions.session) {
        await session.endSession();
      }
    }
  }
}

export type HydratedDocuments<DB extends Database<any, any>> = {
  [K in keyof DB["definitions"]]: z.output<
    CollectionBranded<DB["definitions"][K]["schema"]>
  >;
};

export type InputDocuments<DB extends Database<any, any>> = {
  [K in keyof DB["definitions"]]: z.input<DB["definitions"][K]["schema"]>;
};

export type ResolveZReferences<T> = T extends DocumentReference<
  any,
  any,
  infer Existing
>
  ? Existing
  : T extends mongo.ObjectId | Buffer | Date
  ? T
  : T extends Array<infer U>
  ? Array<ResolveZReferences<U>>
  : T extends object
  ? {
      [K in keyof T]: ResolveZReferences<T[K]>;
    }
  : T;
