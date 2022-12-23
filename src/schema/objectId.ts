import { z } from "zod";
import { ObjectId } from "mongodb";

export function objectId() {
  return z.instanceof(ObjectId);
}
