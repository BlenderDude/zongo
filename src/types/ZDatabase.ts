import { Db, MongoClient, ObjectId } from "mongodb";
import { BRAND, z, ZodBigInt } from "zod";
import { RemoveZDefinitions } from "../helpers/zEmbeddedSchema";
import { ZCollection } from "./ZCollection";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
  ZCollectionModelName,
} from "./ZCollectionDefinition";
import { ZDocumentReference } from "./ZDocumentReference";
import { createZLazyDocument } from "./ZLazyDocument";

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

  constructor(private db: Db) {}

  addDefinition<Collection extends ZCollectionDefinition<any, any>>(
    collection: Collection
  ): ZDatabase<
    Definitions & {
      [key in ZCollectionModelName<Collection>]: Collection;
    }
  > {
    this.definitions.set(collection.modelName, collection);
    return this as any;
  }

  getCollection<DefName extends keyof Definitions>(
    defName: DefName
  ): ZCollection<Definitions[DefName]> {
    const definition = this.definitions.get(defName) as
      | Definitions[DefName]
      | undefined;
    if (!definition) {
      throw new Error(`Collection ${String(defName)} not found`);
    }
    return new ZCollection<Definitions[DefName]>(
      definition,
      this.db.collection(definition.modelName)
    );
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

    const result = definition.schema.parse(data) as Result;
    const resolvedData = await this.resolveReferences<Result>(result);
    await this.getCollection(def).collection.insertOne(resolvedData as any);
    return resolvedData;
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

  async resolveReferences<Input>(
    input: Input
  ): Promise<ResolveZReferences<Input>> {
    if (input instanceof ZDocumentReference) {
      return input.resolve(this as any) as any;
    }
    if (Array.isArray(input)) {
      return Promise.all(input.map(this.resolveReferences)) as any;
    }
    if (
      typeof input === "object" &&
      input !== null &&
      input.constructor === Object
    ) {
      const result: any = {};
      await Promise.all(
        Object.entries(input).map(async ([key, value]) => {
          result[key] = await this.resolveReferences(value);
        })
      );
      return result;
    }
    return input as any;
  }
}

export type ResolveZReferences<T> = T extends ZDocumentReference<infer Def, any>
  ? z.input<ZCollectionBranded<Def>>
  : T extends ObjectId | Buffer | Date
  ? T
  : T extends Array<infer U>
  ? Array<ResolveZReferences<U>>
  : T extends object
  ? {
      [K in keyof T]: ResolveZReferences<T[K]>;
    }
  : T;
