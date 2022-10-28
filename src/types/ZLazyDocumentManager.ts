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
    Mask extends {
      [K in keyof ZLazyDocument<Definition>]?: true;
    }
  >(
    request: Mask
  ): Promise<{
    [K in keyof Mask]: Mask[K] extends true
      ? z.infer<ZCollectionBranded<Definition>>[K]
      : never;
  }> {
    const keys = Object.keys(request) as Array<keyof ZLazyDocument<Definition>>;
    const promises = keys.map((key) => this.lazyDocument[key]);
    const resolvedKeyData = await Promise.all(promises);
    const keyEntries = resolvedKeyData.map((data, index) => [
      keys[index],
      data,
    ]);
    return Object.fromEntries(keyEntries);
  }
}
