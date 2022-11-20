import { Db, MongoClient, ObjectId } from "mongodb";
import { z } from "zod";
import { zg } from "./index";

function expectDocumentsToMatch(actual: any, expected: any) {
  function serialize(obj: any) {
    function replacer(key: string, value: any) {
      if (value instanceof ObjectId) {
        return value.toHexString();
      }
      if (value instanceof zg.ZDocumentReference) {
        return `ZDocumentReference(${value.definition.modelName},${value._id})`;
      }
      return value;
    }
    return JSON.parse(JSON.stringify(obj, replacer));
  }
  expect(serialize(actual)).toEqual(serialize(expected));
}

function createZdb(db: Db) {
  const photoDefinition = new zg.ZCollectionDefinition(
    "Photo",
    z.object({
      _id: zg.zObjectId(),
      url: z.string(),
      description: z.string(),
    })
  );
  const userDefinition = new zg.ZCollectionDefinition(
    "User",
    z.object({
      _id: zg.zObjectId(),
      name: z.string(),
      photo: zg.zEmbeddedSchema
        .partial(photoDefinition, {
          url: true,
        })
        .nullable(),
    })
  );
  const postDefinition = new zg.ZCollectionDefinition(
    "Post",
    z.object({
      _id: zg.zObjectId(),
      name: z.string(),
      author: zg.zEmbeddedSchema.full(userDefinition),
      photos: z.array(zg.zEmbeddedSchema.full(photoDefinition)),
    })
  );
  const discriminatedDefinition = new zg.ZCollectionDefinition(
    "DiscriminatedUnion",
    z.discriminatedUnion("_type", [
      z.object({
        _id: zg.zObjectId(),
        _type: z.literal("a"),
        a: z.string(),
      }),
      z.object({
        _id: zg.zObjectId(),
        _type: z.literal("b"),
        b: z.string(),
      }),
    ])
  );
  const refToDistDefinition = new zg.ZCollectionDefinition(
    "RefToDiscriminatedUnion",
    z.object({
      _id: zg.zObjectId(),
      testRef: zg.zEmbeddedSchema.full(discriminatedDefinition),
    })
  );
  const zdb = new zg.ZDatabase(db)
    .addDefinition(userDefinition)
    .addDefinition(postDefinition)
    .addDefinition(discriminatedDefinition)
    .addDefinition(refToDistDefinition)
    .addDefinition(photoDefinition);

  return zdb;
}

describe("create", () => {
  let connection: MongoClient;
  let db: Db;

  beforeEach(async () => {
    connection = new MongoClient((globalThis as any).__MONGO_URI__ as string);
    await connection.connect();
    db = connection.db((globalThis as any).__MONGO_DB_NAME__ as string);
    await db.dropDatabase();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("create a basic zDatabase ", async () => {
    const zdb = createZdb(db);
    const expectedUser = {
      _id: new ObjectId(),
      name: "Daniel",
      photo: null,
    };
    await zdb.create("User", expectedUser);
    const user = await zdb.getCollection("User").findOne({ name: "Daniel" });
    expect(user).toEqual(expectedUser);
  });

  it("create a basic zDatabase with a reference", async () => {
    const zdb = createZdb(db);
    const expectedUser = {
      _id: new ObjectId(),
      name: "Daniel",
      photo: null,
    };
    const expectedPost = {
      _id: new ObjectId(),
      name: "Post 1",
      author: expectedUser,
      photos: [],
    };
    await zdb.create("User", expectedUser);
    await zdb.create("Post", expectedPost);

    const post = await zdb.getCollection("Post").findOne({ name: "Post 1" });
    const rPost = await zdb.getRawDocument(post);
    expect(rPost).toEqual(expectedPost);
    const user = await zdb.getCollection("User").findOne({ name: "Daniel" });
    expect(user).toEqual(expectedUser);
  });

  it("creates records with discriminated types", async () => {
    const zdb = createZdb(db);
    const expectedA = {
      _id: new ObjectId(),
      _type: "a" as const,
      a: "a",
    };
    const expectedB = {
      _id: new ObjectId(),
      _type: "b" as const,
      b: "b",
    };
    await zdb.create("DiscriminatedUnion", expectedA);
    await zdb.create("DiscriminatedUnion", expectedB);
    const a = await zdb
      .getCollection("DiscriminatedUnion")
      .findOne({ _type: "a" });
    expect(a).toEqual(expectedA);
    const b = await zdb
      .getCollection("DiscriminatedUnion")
      .findOne({ _type: "b" });
    expect(b).toEqual(expectedB);
  });
  describe("discriminated unions", () => {
    it("creates _id reference", async () => {
      const zdb = createZdb(db);
      const expectedA = {
        _id: new ObjectId(),
        _type: "a" as const,
        a: "a",
      };
      const a = await zdb.create("DiscriminatedUnion", expectedA);

      const res = await zdb.create("RefToDiscriminatedUnion", {
        _id: new ObjectId(),
        testRef: a._id,
      });

      expect(expectedA).toEqual(a);
      expectDocumentsToMatch(await res.testRef.resolveFull(), a);
    });
    it("creates full reference", async () => {
      const zdb = createZdb(db);
      const expectedA = {
        _id: new ObjectId(),
        _type: "a" as const,
        a: "a",
      };
      const a = await zdb.create("DiscriminatedUnion", expectedA);

      const res = await zdb.create("RefToDiscriminatedUnion", {
        _id: new ObjectId(),
        testRef: a,
      });

      expect(expectedA).toEqual(a);
      expectDocumentsToMatch(await res.testRef.resolveFull(), a);
    });
  });
  it("traverses references automatically", async () => {
    const zdb = createZdb(db);
    const photo = await zdb.create("Photo", {
      _id: new ObjectId(),
      url: "https://example.com",
      description: "test",
    });
    const user = await zdb.create("User", {
      _id: new ObjectId(),
      name: "Daniel",
      photo,
    });
    const post = await zdb.create("Post", {
      _id: new ObjectId(),
      name: "Post 1",
      author: user,
      photos: [photo],
    });

    const dPost = await zdb.hydrate("Post", (col) =>
      col.findOne({ _id: post._id })
    );
    const dAuthor = await dPost?.author.resolveFull();
    const dPhoto = await dAuthor?.photo?.resolveFull();

    expectDocumentsToMatch(dPost, post);
    expectDocumentsToMatch(dAuthor, user);
    expectDocumentsToMatch(dPhoto, photo);
  });
  it("locates references automatically", async () => {
    const zdb = createZdb(db);
    const references = await zdb.getReferences("Photo");
    expect(Array.from(references.keys())).toEqual(["User", "Post"]);
    expect(Array.from(references.get("User")!)).toStrictEqual([
      {
        mask: ["url", "_id"],
        path: "photo",
      },
    ]);
    expect(Array.from(references.get("Post")!)).toStrictEqual([
      {
        path: "photos.$",
        mask: undefined,
      },
    ]);
  });
  it("updates references with new document", async () => {
    const zdb = createZdb(db);
    const photo = await zdb.create("Photo", {
      _id: new ObjectId(),
      url: "https://example.com",
      description: "test",
    });
    const photo2 = await zdb.create("Photo", {
      _id: new ObjectId(),
      url: "https://example.com/2",
      description: "test2",
    });
    const user = await zdb.create("User", {
      _id: new ObjectId(),
      name: "Daniel",
      photo,
    });
    const post = await zdb.create("Post", {
      _id: new ObjectId(),
      name: "Post 1",
      author: user,
      photos: [photo, photo2],
    });
    const updatedPhoto = {
      _id: photo._id,
      url: "https://example.com/updated",
      description: "test",
    };
    await zdb
      .getCollection("Photo")
      .updateOne(
        { _id: photo._id },
        { $set: { url: "https://example.com/updated" } }
      );
    await zdb.updateReferences("Photo", photo._id);
    const updatedUser = await zdb.getCollection("User").findOne({
      _id: user._id,
    });
    const updatedPost = await zdb.getCollection("Post").findOne({
      _id: post._id,
    });
    const { description, ...maskedPhoto } = updatedPhoto;
    expect(updatedUser?.photo).toEqual(maskedPhoto);
    expect(updatedPost?.photos[0]).toEqual(updatedPhoto);
  });
});
