import { redirect } from "next/navigation";

// Everyone lands on the dashboard. The call tester now lives at /test, and the
// persistent nav shell wraps every (app) route.
export default function Home() {
  redirect("/dashboard");
}
