import { ccc } from "@ckb-ccc/shell";

/**
 * Creates a signer from a signature.
 *
 * @param client - The client instance.
 * @param signature - The signature to create the signer from.
 * @param message - The message that was signed.
 * @param addresses - The addresses to check against the signer.
 * @returns The signer if the signature is valid and the addresses match, otherwise undefined.
 * @throws Error if the signature sign type is unknown.
 */

// Obtained from newer version of ccc-shell

export async function signerFromSignature(
  client: ccc.Client,
  signature: ccc.Signature,
  message?: string | ccc.BytesLike | null,
  ...addresses: (string | string[])[]
): Promise<ccc.Signer | undefined> {
  if (
    message != undefined &&
    !(await ccc.Signer.verifyMessage(message, signature))
  ) {
    return;
  }

  const signer = await (async () => {
    switch (signature.signType) {
      case ccc.SignerSignType.EvmPersonal:
        return new ccc.SignerEvmAddressReadonly(client, signature.identity);
      case ccc.SignerSignType.BtcEcdsa:
        return new ccc.SignerBtcPublicKeyReadonly(
          client,
          "",
          signature.identity
        );
      case ccc.SignerSignType.JoyId: {
        const { address } = JSON.parse(signature.identity) as {
          address: string;
        };
        return new ccc.SignerCkbScriptReadonly(
          client,
          (await ccc.Address.fromString(address, client)).script
        );
      }
      case ccc.SignerSignType.NostrEvent:
        return new ccc.SignerNostrPublicKeyReadonly(client, signature.identity);
      case ccc.SignerSignType.CkbSecp256k1:
        return new ccc.SignerCkbPublicKey(client, signature.identity);
      case ccc.SignerSignType.DogeEcdsa:
        return new ccc.SignerDogeAddressReadonly(client, signature.identity);
      case ccc.SignerSignType.Unknown:
        throw new Error("Unknown signer sign type");
    }
  })();
  const signerAddresses = await signer.getAddresses();
  if (!addresses.flat().every((addr) => signerAddresses.includes(addr))) {
    return;
  }

  return signer;
}
