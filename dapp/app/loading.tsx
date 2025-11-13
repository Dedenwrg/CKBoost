import { PageLoading } from "@/components/ui/page-loading";

export default function Loading() {
  return (
    <PageLoading
      showNavigation={false}
      description="Booting the CKBoost interface and syncing cached blockchain data."
    />
  );
}
