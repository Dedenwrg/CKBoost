import { ccc } from "@ckb-ccc/connector-react";

export async function injectProxyAuthenticationCell(
  signer: ccc.Signer,
  baseDraftTx: ccc.Transaction
): Promise<void> {
  const authenticatorAddress =
    process.env.NEXT_PUBLIC_API_AUTHENTICATOR_ADDRESS;

  const authenticatorLock = await ccc.Address.fromString(
    authenticatorAddress as string,
    signer.client
  );
  const authenticatorLockScript = authenticatorLock.script;
  let proxyAuthenticationCell: ccc.Cell | undefined;
  for await (const cell of signer.client.findCellsByLock(
    authenticatorLockScript,
    null,
    false
  )) {
    // Setting type to null won't filter out the cell, so we need to check manually
    if (!cell.cellOutput.type) {
      proxyAuthenticationCell = cell;
      break;
    }
  }

  if (!proxyAuthenticationCell) {
    throw new Error("Proxy authentication cell not found");
  }

  console.log("proxyAuthenticationCell", proxyAuthenticationCell);

  await baseDraftTx.addInput(proxyAuthenticationCell);
  const proxyAuthenticationCellOutput = ccc.CellOutput.from({
    capacity: proxyAuthenticationCell.cellOutput.capacity,
    lock: proxyAuthenticationCell.cellOutput.lock,
  });
  await baseDraftTx.addOutput(proxyAuthenticationCellOutput);

  console.log("baseDraftTx", baseDraftTx);
  console.log("baseDraftTx in Hex", ccc.hexFrom(baseDraftTx.toBytes()));
}
