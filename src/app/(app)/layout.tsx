import AppShell from "@/components/AppShell";

// Route-group layout: renders the persistent app shell (sidebar nav + mobile
// drawer) around every page in (app). ClerkProvider + WorkspaceProvider already
// wrap this at the root layout, so they are NOT duplicated here.
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
