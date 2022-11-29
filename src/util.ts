export type Thunk<T> = () => T;
export function resolveThunk<T>(thunk: Thunk<T>): T {
  return thunk();
}
