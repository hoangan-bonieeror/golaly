import { titleFor } from "@/i18n/server";
import { AdminShell } from "@/components/admin/AdminShell";

export const generateMetadata = titleFor("admin");

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
