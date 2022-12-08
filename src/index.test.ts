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

function createZdb(client: MongoClient, db: Db) {
  const Timestamps = zg.createPartial(
    "Timestamps",
    z.object({
      createdAt: z.date().default(() => new Date()),
      updatedAt: z.date().default(() => new Date()),
    })
  );
  const photoDefinition = new zg.ZCollectionDefinition(
    "Photo",
    z.object({
      _id: zg.zObjectId(),
      url: z.string(),
      description: z.string(),
      timestamps: zg.zPartial(() => Timestamps),
    })
  );
  const userDefinition = new zg.ZCollectionDefinition(
    "User",
    z.object({
      _id: zg.zObjectId(),
      name: z.string(),
      photo: zg.zEmbeddedSchema
        .partial(() => photoDefinition, {
          url: true,
        })
        .nullable(),
    })
  );
  const AuditEntry = zg.createPartial(
    "AuditEntry",
    z.object({
      user: zg.zEmbeddedSchema.partial(() => userDefinition, {
        name: true,
      }),
      action: z.string(),
    })
  );
  const postDefinition = new zg.ZCollectionDefinition(
    "Post",
    z.object({
      _id: zg.zObjectId(),
      name: z.string(),
      author: zg.zEmbeddedSchema.full(() => userDefinition),
      photos: z.array(zg.zEmbeddedSchema.full(() => photoDefinition)),
      audit: z.array(zg.zPartial(() => AuditEntry)),
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
      testRef: zg.zEmbeddedSchema.full(() => discriminatedDefinition),
    })
  );

  const zdb = new zg.ZDatabase(client, db)
    .addDefinition(userDefinition)
    .addDefinition(postDefinition)
    .addDefinitions([
      discriminatedDefinition,
      refToDistDefinition,
      photoDefinition,
    ])
    .addPartials([AuditEntry]);

  return zdb;
}

describe("create", () => {
  let client: MongoClient;
  let db: Db;

  beforeEach(async () => {
    client = new MongoClient((globalThis as any).__MONGO_URI__ as string);
    await client.connect();
    db = client.db((globalThis as any).__MONGO_DB_NAME__ as string);
    await db.dropDatabase();
  });

  afterEach(async () => {
    await client.close();
  });

  it("create a basic zDatabase ", async () => {
    const zdb = createZdb(client, db);
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
    const zdb = createZdb(client, db);
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
      audit: [],
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
    const zdb = createZdb(client, db);
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
      const zdb = createZdb(client, db);
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
      const zdb = createZdb(client, db);
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
    it("creates lazy reference", async () => {
      const zdb = createZdb(client, db);
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

      const lazyDoc = res.testRef.resolve();
      expect(await lazyDoc._type).toBe(a._type);
    });
  });
  it("traverses references automatically", async () => {
    const zdb = createZdb(client, db);
    const photo = await zdb.create("Photo", {
      _id: new ObjectId(),
      url: "https://example.com",
      description: "test",
      timestamps: {},
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
      audit: [],
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
    const zdb = createZdb(client, db);
    const references = await zdb.getReferences("Photo");
    expect(Array.from(references.keys())).toEqual(["User", "Post"]);
    expect(Array.from(references.get("User")!)).toStrictEqual([
      {
        mask: ["url"],
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
    const zdb = createZdb(client, db);
    const photo = await zdb.create("Photo", {
      _id: new ObjectId(),
      url: "https://example.com",
      description: "test",
      timestamps: {},
    });
    const photo2 = await zdb.create("Photo", {
      _id: new ObjectId(),
      url: "https://example.com/2",
      description: "test2",
      timestamps: {},
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
      audit: [],
    });
    const updatedPhoto = {
      ...photo,
      url: "https://example.com/updated",
    };
    await zdb
      .getCollection("Photo")
      .updateOne({ _id: photo._id }, { $set: { url: updatedPhoto.url } });
    await zdb.updateReferences("Photo", photo._id);
    const updatedUser = await zdb.getCollection("User").findOne({
      _id: user._id,
    });
    const updatedPost = await zdb.getCollection("Post").findOne({
      _id: post._id,
    });
    const { description, timestamps, ...maskedPhoto } = updatedPhoto;
    expect(updatedUser?.photo).toEqual(maskedPhoto);
    expect(updatedPost?.photos[0]).toEqual(updatedPhoto);
  });
  it("updates partials with references", async () => {
    const zdb = createZdb(client, db);
    const user = await zdb.create("User", {
      _id: new ObjectId(),
      name: "Daniel",
      photo: null,
    });

    const auditEntry = zdb.createPartial("AuditEntry", {
      user,
      action: "create",
    });
    const expectedPost = {
      _id: new ObjectId(),
      name: "Post 1",
      author: user,
      photos: [],
      audit: [auditEntry],
    };
    const post = await zdb.create("Post", expectedPost);
    expect(post.audit[0].user).toBeInstanceOf(zg.ZDocumentReference);
    expect(post.audit[0].user.getExisting()._id).toEqual(user._id);
  });
});
