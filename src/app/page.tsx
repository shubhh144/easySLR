import { redirect } from "next/navigation";
import { auth } from "~/server/auth";

/**
 * Root page: redirect authenticated users to their dashboard,
 * unauthenticated users to the sign-in page.
 */
export default async function RootPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  } else {
    redirect("/auth/signin");
  }
}
