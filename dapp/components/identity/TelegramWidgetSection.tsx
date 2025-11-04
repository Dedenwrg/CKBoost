"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, MessageCircle } from "lucide-react";
import { LoginButton } from "@telegram-auth/react";

export function TelegramWidgetSection({
  walletAddress,
  open,
}: {
  walletAddress: string | null;
  open: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-4">
      {!walletAddress && (
        <Alert className="bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800 dark:text-yellow-200">
            Please connect your wallet first to start verification
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <MessageCircle className="h-4 w-4" />
        <AlertDescription>
          Use the official Telegram Login widget below to link your Telegram
          account. After login, we’ll bind it to your wallet.
        </AlertDescription>
      </Alert>

      {walletAddress ? (
        <div className="flex flex-col items-center gap-3">
          <LoginButton
            botUsername={"ckboost_bot"}
            authCallbackUrl="/identity?source=telegram"
            buttonSize="large"
            cornerRadius={5}
            showAvatar={true}
            lang="en"
          />
        </div>
      ) : (
        <Button onClick={open} className="w-full">
          Connect Wallet to Verify
          <ExternalLink className="w-4 h-4 ml-2" />
        </Button>
      )}
    </div>
  );
}
