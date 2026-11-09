import type { Metadata } from "next";
import { LoginView } from "@/components/workstreams/login-view";

export const metadata: Metadata = {
  title: "Sign in | SmartTrack",
  description: "Sign in to SmartTrack with your organization's Supabase account.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginView />;
}
