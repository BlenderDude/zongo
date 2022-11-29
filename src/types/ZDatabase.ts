import { AsyncLocalStorage } from "async_hooks";
import { Collection, Db, ObjectId } from "mongodb";
import { BRAND, z } from "zod";
import {
  RemoveZDefinitions,
  ZSchemaReferenceWrapper,
} from "../schema/zEmbeddedSchema";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
  ZCollectionModelName,
  ZRawDocumentType,
} from "./ZCollectionDefinition";
import { ZDocumentReference } from "./ZDocumentReference";
import { createZLazyDocument } from "./ZLazyDocument";
import { ZPartialDefinition, ZPartialSchema } from "./ZPartialDefinition";

type CreateDocumentParam<
  Definitions extends DefinitionsType,
  Def extends keyof Definitions
> = RemoveZDefinitions<
  Omit<z.input<ZCollectionBranded<Definitions[Def]>>, typeof BRAND>,
  {
    [DefName in keyof Definitions]:
      | ObjectId
      | ZDocumentReference<Definitions[DefName], any, any>;
  }
>;

type CreatePartialParam<
  Definitions extends DefinitionsType,
  Partial extends z.ZodSchema
> = RemoveZDefinitions<
  Omit<z.input<Partial>, typeof BRAND>,
  {
    [DefName in keyof Definitions]:
      | ObjectId
      | ZDocumentReference<Definitions[DefName], any, any>;
  }
>;

type DefinitionsType = {
  [key: string]: ZCollectionDefinition<any, any>;
};

type PartialsType = {
  [key: string]: ZPartialDefinition<any, any>;
};

export class ZDatabase<
  Definitions extends DefinitionsType = {},
  Partials extends PartialsType = {}
> {
  private definitions = new Map<
    keyof Definitions,
    ZCollectionDefinition<any, any>
  >();

  private partials = new Map<keyof Partials, ZPartialDefinition<any, any>>();

  private static als = new AsyncLocalStorage<ZDatabase<any, any>>();
  private static globalInstance: ZDatabase<any, any> | undefined = undefined;

  public static setGlobalInstance(instance: ZDatabase<any, any>) {
    ZDatabase.globalInstance = instance;
  }

  public static getContextZDB() {
    const ctxZDB = ZDatabase.als.getStore();
    if (ctxZDB) {
      return ctxZDB;
    }
    return this.globalInstance;
  }

  constructor(private db: Db) {}

  addDefinition<CollectionDef extends ZCollectionDefinition<any, any>>(
    definition: CollectionDef
  ): ZDatabase<
    Definitions & {
      [key in ZCollectionModelName<CollectionDef>]: CollectionDef;
    },
    Partials
  > {
    definition.zdb = this;
    this.definitions.set(definition.modelName, definition);

    return this as any;
  }

  addPartial<
    Name extends string,
    PartialDef extends ZPartialDefinition<Name, any>
  >(
    definition: PartialDef
  ): ZDatabase<Definitions, Partials & { [key in Name]: PartialDef }> {
    definition.zdb = this;
    this.partials.set(definition.name, definition);

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

  createPartial<Name extends keyof Partials>(
    name: Name,
    data: CreatePartialParam<Definitions, ZPartialSchema<Partials[Name]>>
  ) {
    const partial = this.partials.get(name);
    if (!partial) {
      throw new Error(`Partial ${String(name)} not found`);
    }
    return data;
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
          collection: Collection<ZRawDocumentType<Definitions[DefName]>>
        ) => Doc[] | Promise<Doc[]>)
  ): Promise<z.output<ZCollectionBranded<Definitions[DefName]>>[]> {
    let resolvedDocs: Doc[];
    if (typeof docs === "function") {
      resolvedDocs = await docs(this.getCollection(defName));
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

  async getReferences<DefName extends keyof Definitions>(defName: DefName) {
    const locations = new Map<
      keyof Definitions,
      Array<{
        path: string;
        mask?: string[];
      }>
    >();

    for (const [traversedDefName, definition] of this.definitions.entries()) {
      function traverseSchema(schema: unknown, pathSoFar: string[]) {
        if (schema instanceof ZSchemaReferenceWrapper) {
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
    _id: ObjectId
  ) {
    const collection = this.getCollection(defName) as Collection<any>;
    const document = await collection.findOne({
      _id,
    });
    const definition = this.definitions.get(defName) as Definitions[DefName];
    const resolvedDocument = await this.getRawDocument(
      await definition.schema.parseAsync(document)
    );

    const references = await this.getReferences(defName);
    for (const [refDefName, collectionRefs] of references.entries()) {
      for (const ref of collectionRefs) {
        const collection = this.getCollection(refDefName) as Collection<any>;
        const _id = resolvedDocument._id as ObjectId;
        const idPath = `${ref.path}._id`;
        const updateKeys: Record<string, any> = {};
        for (const key of ref.mask ?? Object.keys(resolvedDocument)) {
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
