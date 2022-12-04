import { z } from "zod";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
} from "./ZCollectionDefinition";
import { ZLazyDocument } from "./ZLazyDocument";

export class ZLazyDocumentManager<
  Definition extends ZCollectionDefinition<any, any>
> {
  constructor(private lazyDocument: ZLazyDocument<Definition>) {}

  async collect<
    Keys extends ReadonlyArray<keyof z.output<ZCollectionBranded<Definition>>>
  >(
    keys: Keys
  ): Promise<{
    [K in Keys[number]]: z.infer<ZCollectionBranded<Definition>>[K];
  }> {
    const promises = keys.map((key) => this.lazyDocument[key]);
    const resolvedKeyData = await Promise.all(promises);
    const keyEntries = resolvedKeyData.map((data, index) => [
      keys[index],
      data,
    ]);
    return Object.fromEntries(keyEntries);
  }
}
