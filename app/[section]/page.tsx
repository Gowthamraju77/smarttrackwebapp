import { AppShell } from "@/components/app-shell";

type SectionPageProps = {
  params: Promise<{ section: string }>;
};

export default async function SectionPage({ params }: SectionPageProps) {
  const { section } = await params;
  return <AppShell activeView={section} />;
}
