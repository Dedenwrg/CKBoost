import { Tippings } from "@/components/tippings";
import { TippingProvider } from "../../lib/providers/tipping-provider";

export default function CommunityPage() {
  return (
    <div className="min-h-screen bg-black dark:bg-black">
      {/* Starlight background - only for main content area, not footer */}
      <div
        className="fixed inset-0 overflow-hidden pointer-events-none"
        style={{
          zIndex: 0,
          background: `url('/assets/Base%20UI/Starlight%20background.svg') black`,
          backgroundSize: "100vw 100vh",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          imageRendering: "pixelated",
          width: "100%",
          height: "100%",
        }}
      />
      <main
        className="max-w-4xl mx-auto px-4 py-8 relative"
        style={{ zIndex: 10 }}
      >
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-4xl">💰</div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              Community Tipping Proposals
            </h1>
          </div>
          <p className="text-lg text-muted-foreground mb-6">
            Discover and support valuable community contributions through tip
            proposals. Vote on community-funded tips or add your own personal
            tips to show appreciation.
          </p>
        </div>

        <Tippings />
      </main>
    </div>
  );
}
