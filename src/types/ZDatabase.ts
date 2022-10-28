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

type ZCollectionReference<DefName extends string> = {
  _id: ObjectId;
  def: DefName;
};

type CreateDocumentParam<
  Definitions extends DefinitionsType,
  Def extends keyof Definitions
> = RemoveZDefinitions<
  Omit<z.infer<ZCollectionBranded<Definitions[Def]>>, typeof BRAND>,
  {
    [DefName in keyof Definitions]: DefName extends string
      ? ZCollectionReference<DefName>
      : never;
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
    const collection = this.definitions.get(defName);
    if (!collection) {
      throw new Error(`Collection ${String(defName)} not found`);
    }
    return this.db.collection(collection.collection);
  }

  async create<Def extends keyof Definitions>(
    def: Def,
    data:
      | CreateDocumentParam<Definitions, Def>
      | ((helpers: {
          createRef<T extends string>(
            _id: ObjectId,
            def: T
          ): ZDocumentReference<Definitions, T>;
        }) => CreateDocumentParam<Definitions, Def>)
  ): Promise<z.infer<ZCollectionBranded<Definitions[Def]>>> {
    const definition = this.definitions.get(def);
    if (!definition) {
      throw new Error(`Collection ${String(def)} not found`);
    }
    const resolveReferences = async (input: any): Promise<any> => {
      if (input instanceof ZDocumentReference) {
        const doc = await this.getCollection(input.def).findOne({
          _id: input._id,
        });
        if (!doc) {
          throw new Error("Document not found");
        }
        return doc;
      }
      if (Array.isArray(input)) {
        return Promise.all(input.map(resolveReferences));
      }
      if (
        typeof input === "object" &&
        input !== null &&
        input.constructor === Object
      ) {
        const result: any = {};
        await Promise.all(
          Object.entries(input).map(async ([key, value]) => {
            result[key] = await resolveReferences(value);
          })
        );
        return result;
      }
      return input;
    };
    const createRef = <T extends string>(
      _id: ObjectId,
      def: T
    ): ZDocumentReference<Definitions, T> => {
      return new ZDocumentReference(_id, def);
    };
    const resolvedData = await resolveReferences(
      typeof data === "function" ? data({ createRef }) : data
    );
    const result = definition.schema.parse(resolvedData);
    await this.getCollection(def).insertOne(result);
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

  // hydrate<Def extends keyof Definitions>(
  //   doc: z.infer<ZCollectionBranded<Definitions[Def]>>
  // ): z.infer<ZCollectionBranded<Definitions[Def]>> {
  //   const definition = this.definitions.get(doc[BRAND]);
  //   if (!definition) {
  //     throw new Error(`Collection ${String(doc[BRAND])} not found`);
  //   }
  //   return definition.schema.parse(doc);
  // }
}
