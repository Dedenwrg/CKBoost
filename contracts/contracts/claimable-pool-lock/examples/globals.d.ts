declare module "@ckb-ccc/playground" {
  import { ccc } from "@ckb-ccc/core";

  export const signer: ccc.Signer;
  export function render(value: unknown): Promise<void>;
}
