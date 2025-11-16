"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Wallet,
  CheckCircle,
  Copy,
  ExternalLink,
  ChevronDown,
  Shield,
  AlertCircle,
  UserCheck,
  Settings,
  Search,
  Loader2,
  Clock3,
  Info,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ccc } from "@ckb-ccc/connector-react";
import { NeventParserDialog } from "@/components/nevent-parser-dialog";
import { useProtocol } from "@/lib/providers/protocol-provider";
import { useVerification } from "@/lib/hooks/use-verification";
import { calculateVerificationStatus } from "@/lib/config/verification-config";
import { usePendingTransactions } from "@/lib/providers/pending-transaction-provider";
import type { PendingTransactionRecord } from "@/lib/providers/pending-transaction-provider";
import { createScopedLogger } from "ssri-ckboost";

const log = createScopedLogger("WalletConnect");

export function WalletConnect() {
  const { open } = ccc.useCcc();
  const signer = ccc.useSigner();
  const { isAdmin, isEndorser } = useProtocol();
  const { verificationStatus: verificationData } = useVerification();
  const [address, setAddress] = React.useState<string>("");
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [showNeventParser, setShowNeventParser] = React.useState(false);
  const [isMonitorCollapsed, setIsMonitorCollapsed] = React.useState(true);
  const {
    pendingTransactions,
    activeCount,
    hasTrackedTransactions,
    confirmationTarget,
    refresh: refreshPendingTransactions,
    remove: removePendingTransaction,
    explorerBaseUrl,
  } = usePendingTransactions();
  const [pendingDetailsHash, setPendingDetailsHash] = React.useState<
    string | null
  >(null);

  const selectedPendingTx = React.useMemo(() => {
    if (!pendingDetailsHash) return null;
    return (
      pendingTransactions.find((tx) => tx.txHash === pendingDetailsHash) || null
    );
  }, [pendingDetailsHash, pendingTransactions]);
  const isPendingModalOpen = pendingDetailsHash !== null;
  const pendingExplorerUrl = selectedPendingTx
    ? `${explorerBaseUrl}${selectedPendingTx.txHash}`
    : null;

  const getStatusDisplay = React.useCallback(
    (tx: PendingTransactionRecord) => {
      const defaultDescription =
        tx.metadata?.description ||
        "Stored locally until the RPC reports this transaction.";
      switch (tx.status) {
        case "waiting":
          return {
            label: "Awaiting RPC",
            description:
              "Wallet submitted the transaction. Waiting for RPC to index it.",
            badgeClass:
              "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100",
            textClass: "text-amber-700 dark:text-amber-200",
            icon: <Loader2 className="w-3 h-3 animate-spin" />,
            iconLarge: <Loader2 className="w-5 h-5 animate-spin" />,
          };
        case "rpc_seen":
          return {
            label: "Seen by RPC",
            description:
              "RPC can query this hash, waiting for it to be committed to a block.",
            badgeClass:
              "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100",
            textClass: "text-blue-700 dark:text-blue-200",
            icon: <Clock3 className="w-3 h-3" />,
            iconLarge: <Clock3 className="w-5 h-5" />,
          };
        case "confirming": {
          const confirmations = Math.max(0, tx.confirmations || 0);
          const clamped = Math.min(confirmations, confirmationTarget);
          return {
            label: `Confirming (${clamped}/${confirmationTarget})`,
            description: `Currently at ${confirmations} confirmation${
              confirmations === 1 ? "" : "s"
            }. Data may lag until finality.`,
            badgeClass:
              "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
            textClass: "text-blue-700 dark:text-blue-200",
            icon: <Loader2 className="w-3 h-3 animate-spin" />,
            iconLarge: <Loader2 className="w-5 h-5 animate-spin" />,
          };
        }
        case "finalized": {
          const confirmations = Math.max(
            confirmationTarget,
            tx.confirmations || 0
          );
          return {
            label: "Finalized",
            description: `${defaultDescription} Finalized with ${confirmations} confirmation${
              confirmations === 1 ? "" : "s"
            }.`,
            badgeClass:
              "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100",
            textClass: "text-emerald-700 dark:text-emerald-200",
            icon: <CheckCircle className="w-3 h-3" />,
            iconLarge: <CheckCircle className="w-5 h-5" />,
          };
        }
        default:
          return {
            label: "Tracing",
            description: defaultDescription,
            badgeClass:
              "bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground",
            textClass: "text-muted-foreground",
            icon: <Clock3 className="w-3 h-3" />,
            iconLarge: <Clock3 className="w-5 h-5" />,
          };
      }
    },
    [confirmationTarget]
  );

  const renderStatusIndicator = React.useCallback(() => {
    if (activeCount > 0) {
      return (
        <Badge
          variant="secondary"
          className="text-xs flex items-center gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          {activeCount === 1 ? "1 tx updating" : `${activeCount} txs updating`}
        </Badge>
      );
    }
    if (hasTrackedTransactions) {
      return (
        <Badge
          variant="secondary"
          className="text-xs flex items-center gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
        >
          <CheckCircle className="w-3 h-3" />
          All synced
        </Badge>
      );
    }
    return null;
  }, [activeCount, hasTrackedTransactions]);

  const modalStatusDisplay = selectedPendingTx
    ? getStatusDisplay(selectedPendingTx)
    : null;
  const monitorStatusIndicator =
    activeCount > 0 ? renderStatusIndicator() : null;
  const monitorHint =
    "Recent hashes are cached locally so you know when the RPC has seen them.";

  React.useEffect(() => {
    if (!pendingDetailsHash) return;
    if (!pendingTransactions.some((tx) => tx.txHash === pendingDetailsHash)) {
      setPendingDetailsHash(null);
    }
  }, [pendingDetailsHash, pendingTransactions]);

  const formatHash = React.useCallback((hash: string) => {
    if (!hash) return "";
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
  }, []);

  const formatRelativeTime = React.useCallback((timestamp?: number) => {
    if (!timestamp) return "Not checked yet";
    const now = Date.now();
    const delta = Math.max(0, now - timestamp);
    const seconds = Math.floor(delta / 1000);
    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }, []);

  const formatAbsoluteTime = React.useCallback((timestamp?: number) => {
    if (!timestamp) return "--";
    return new Date(timestamp).toLocaleString();
  }, []);

  const handleOpenPendingDetails = React.useCallback((txHash: string) => {
    setPendingDetailsHash(txHash);
  }, []);

  const handlePendingModalChange = React.useCallback((open: boolean) => {
    if (!open) {
      setPendingDetailsHash(null);
    }
  }, []);

  const handleCopyTxHash = React.useCallback((txHash?: string) => {
    if (!txHash) return;
    navigator.clipboard.writeText(txHash);
  }, []);

  const handleDismissPending = React.useCallback(() => {
    if (!pendingDetailsHash) return;
    removePendingTransaction(pendingDetailsHash);
    setPendingDetailsHash(null);
  }, [pendingDetailsHash, removePendingTransaction]);

  // Calculate verification status from real data using modular config
  const verificationStatus = calculateVerificationStatus(verificationData);

  // Map icon names to components
  const VerificationIcon =
    verificationStatus.icon === "CheckCircle"
      ? CheckCircle
      : verificationStatus.icon === "AlertCircle"
      ? AlertCircle
      : UserCheck;

  React.useEffect(() => {
    const getAddress = async () => {
      if (signer) {
        try {
          const addr = await signer.getRecommendedAddress();
          setAddress(addr);
        } catch (error) {
          log.error("Error getting address:", error);
        }
      } else {
        setAddress("");
      }
    };
    getAddress();
  }, [signer]);

  const handleConnect = async () => {
    try {
      setIsConnecting(true);
      await open();
    } catch (error) {
      log.error("Connection failed:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    // CCC handles disconnection through the wallet interface
    await open();
  };

  const copyAddress = async () => {
    if (address) {
      navigator.clipboard.writeText(address);
    }
  };

  const formatAddress = (addr: string) => {
    if (!addr) return "ckb1qyq...7x8n";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (!signer) {
    const inlineIndicator = renderStatusIndicator();
    return (
      <Button
        onClick={handleConnect}
        disabled={isConnecting}
        variant="outline"
        className="flex items-center gap-2 bg-transparent"
      >
        {isConnecting ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
            Connecting...
          </>
        ) : (
          <>
            <Wallet className="w-4 h-4" />
            Connect Wallet
            {inlineIndicator && <span className="ml-2">{inlineIndicator}</span>}
          </>
        )}
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="flex items-center gap-2 bg-transparent"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="font-mono text-sm">
                {formatAddress(address)}
              </span>
              {verificationStatus.verifiedCount > 0 && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-xs",
                    verificationStatus.verifiedCount ===
                      verificationStatus.totalCount
                      ? "bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-100"
                      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-800 dark:text-yellow-100"
                  )}
                >
                  <Shield className="w-3 h-3 mr-1" />
                  {verificationStatus.text}
                </Badge>
              )}
              {renderStatusIndicator()}
            </div>
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {/* Wallet Info */}
          <div className="px-3 py-2 border-b">
            <div className="text-sm font-medium">Wallet Connected</div>
            <div className="text-xs text-muted-foreground">CKB Testnet</div>
          </div>

          {/* Transaction Monitor */}
          <div className="px-3 py-3 border-b space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMonitorCollapsed((prev) => !prev)}
                  className="flex items-center gap-2 text-sm font-medium text-left whitespace-nowrap"
                  aria-expanded={!isMonitorCollapsed}
                >
                  <Clock3 className="w-4 h-4 text-amber-600" />
                  Transaction Monitor
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 transition-transform",
                      isMonitorCollapsed ? "-rotate-90" : "rotate-0"
                    )}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void refreshPendingTransactions()}
                  className="text-xs font-medium text-amber-700 hover:underline dark:text-amber-200 whitespace-nowrap"
                >
                  Refresh
                </button>
              </div>
              {monitorStatusIndicator}
            </div>
            {!isMonitorCollapsed && (
              <>
                {pendingTransactions.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {pendingTransactions.map((tx) => {
                      const status = getStatusDisplay(tx);
                      return (
                        <button
                          key={tx.txHash}
                          type="button"
                          onClick={() => handleOpenPendingDetails(tx.txHash)}
                          className="w-full rounded-md border border-muted bg-card px-3 py-2 text-left text-sm shadow-sm transition hover:bg-accent hover:text-accent-foreground"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-medium">
                              <span
                                className={cn(
                                  "flex items-center gap-1",
                                  status.textClass
                                )}
                              >
                                {status.icon}
                                {formatHash(tx.txHash)}
                              </span>
                            </div>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[11px] px-2 py-0.5",
                                status.badgeClass
                              )}
                            >
                              {status.label}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground flex items-center justify-between gap-3">
                            <span className="whitespace-nowrap">
                              Submitted {formatRelativeTime(tx.createdAt)}
                            </span>
                            <span className="whitespace-nowrap">
                              Checked {formatRelativeTime(tx.lastCheckedAt)}
                            </span>
                          </div>
                          <div
                            className={cn(
                              "mt-1 text-xs truncate",
                              status.textClass
                            )}
                            title={tx.metadata?.label ?? "Unnamed action"}
                          >
                            {tx.metadata?.label ?? "Unnamed action"}
                          </div>
                          <div
                            className="mt-1 text-xs text-muted-foreground truncate"
                            title={status.description}
                          >
                            {status.description}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground gap-3">
                            <span className="whitespace-nowrap">
                              {tx.confirmations > 0
                                ? `${tx.confirmations} confirmation${
                                    tx.confirmations === 1 ? "" : "s"
                                  }`
                                : "No confirmations yet"}
                            </span>
                            <a
                              href={`${explorerBaseUrl}${tx.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-blue-600 hover:underline"
                              onClick={(event) => event.stopPropagation()}
                            >
                              Explorer
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          {tx.lastError && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                              <AlertCircle className="w-3 h-3" />
                              {tx.lastError}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed py-6 px-3 text-center text-xs text-muted-foreground">
                    No recent transactions. Submit any action to start tracking
                    it here.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Verification Status */}
          <div className="px-3 py-2 border-b">
            <div className="flex items-center gap-2 mb-1">
              <VerificationIcon
                className={cn("w-4 h-4", verificationStatus.color)}
              />
              <span className="text-sm font-medium">Identity Status</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div
                  className={cn(
                    "text-sm font-medium",
                    verificationStatus.color
                  )}
                >
                  {verificationStatus.text}
                </div>
                <div className="text-xs text-muted-foreground">
                  {verificationStatus.description}
                </div>
              </div>
              {verificationStatus.verifiedCount <
                verificationStatus.totalCount && (
                <Link href="/identity">
                  <Button size="sm" variant="outline" className="text-xs">
                    Verify
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {/* Wallet Actions */}
          <DropdownMenuItem onClick={copyAddress}>
            <Copy className="w-4 h-4 mr-2" />
            Copy Address
          </DropdownMenuItem>
          <DropdownMenuItem>
            <ExternalLink className="w-4 h-4 mr-2" />
            View on Explorer
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Verification Actions */}
          <DropdownMenuItem asChild>
            <Link href="/identity" className="w-full">
              <Shield className="w-4 h-4 mr-2" />
              Manage Identity
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Campaign Admin - Visible to endorsers and admins */}
          {(isEndorser || isAdmin) && (
            <>
              <DropdownMenuItem asChild>
                <Link href="/campaign-admin" className="w-full">
                  <Settings className="w-4 h-4 mr-2" />
                  Campaign Admin
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
            </>
          )}

          {/* Platform Admin Tools - Only visible to platform admins */}
          {isAdmin && (
            <>
              {/* Tools */}
              <DropdownMenuItem onClick={() => setShowNeventParser(true)}>
                <Search className="w-4 h-4 mr-2" />
                Parse Nevent Submission
              </DropdownMenuItem>

              {/* Platform Admin */}
              <DropdownMenuItem asChild>
                <Link href="/platform-admin" className="w-full">
                  <Shield className="w-4 h-4 mr-2" />
                  Platform Admin
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem onClick={handleDisconnect} className="text-red-600">
            <Wallet className="w-4 h-4 mr-2" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Pending transaction dialog */}
      <Dialog open={isPendingModalOpen} onOpenChange={handlePendingModalChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock3 className="w-5 h-5 text-amber-600" />
              {selectedPendingTx?.metadata?.label ?? "Pending transaction"}
            </DialogTitle>
            <DialogDescription>
              {selectedPendingTx?.metadata?.description ||
                "We keep recent transactions locally until the RPC reports them so you know data may take a moment to sync."}
            </DialogDescription>
          </DialogHeader>
          {selectedPendingTx ? (
            <div className="space-y-4">
              {modalStatusDisplay && (
                <div className="rounded-md border px-3 py-2 flex items-start gap-3">
                  <div className={cn("mt-0.5", modalStatusDisplay.textClass)}>
                    {modalStatusDisplay.iconLarge}
                  </div>
                  <div>
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        modalStatusDisplay.textClass
                      )}
                    >
                      {modalStatusDisplay.label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {modalStatusDisplay.description}
                    </div>
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Transaction hash
                </div>
                <div className="mt-1 break-all font-mono text-sm">
                  {selectedPendingTx.txHash}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopyTxHash(selectedPendingTx.txHash)}
                  >
                    <Copy className="w-4 h-4 mr-1" /> Copy hash
                  </Button>
                  {pendingExplorerUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(pendingExplorerUrl, "_blank")}
                    >
                      <ExternalLink className="w-4 h-4 mr-1" />
                      Open explorer
                    </Button>
                  )}
                </div>
                {selectedPendingTx.metadata?.context && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Source: {selectedPendingTx.metadata.context}
                  </div>
                )}
              </div>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={cn("font-medium", modalStatusDisplay?.textClass)}
                  >
                    {modalStatusDisplay?.label ?? selectedPendingTx.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Confirmations</span>
                  <span className="font-medium">
                    {selectedPendingTx.confirmations ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Block number</span>
                  <span className="font-medium">
                    {selectedPendingTx.blockNumber ?? "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span className="font-medium">
                    {formatAbsoluteTime(selectedPendingTx.createdAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">RPC seen</span>
                  <span className="font-medium">
                    {selectedPendingTx.rpcSeenAt
                      ? formatAbsoluteTime(selectedPendingTx.rpcSeenAt)
                      : "Waiting..."}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last RPC check</span>
                  <span className="font-medium">
                    {selectedPendingTx.lastCheckedAt
                      ? formatAbsoluteTime(selectedPendingTx.lastCheckedAt)
                      : "Waiting..."}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Checks attempted
                  </span>
                  <span className="font-medium">
                    {selectedPendingTx.checkAttempts}
                  </span>
                </div>
              </div>
              {selectedPendingTx.lastError && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-50">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5" />
                    <div>
                      <div className="font-medium">RPC error</div>
                      <div className="text-xs">
                        {selectedPendingTx.lastError}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              Transaction cache cleared.
            </div>
          )}
          <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refreshPendingTransactions()}
              >
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Check now
              </Button>
              {pendingExplorerUrl && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => window.open(pendingExplorerUrl, "_blank")}
                >
                  <ExternalLink className="w-4 h-4 mr-1" />
                  View in explorer
                </Button>
              )}
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDismissPending}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nevent Parser Dialog */}
      <NeventParserDialog
        open={showNeventParser}
        onOpenChange={setShowNeventParser}
      />
    </>
  );
}
