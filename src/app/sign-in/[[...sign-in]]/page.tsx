import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Resimpli Test Suite
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Sign in to access the voice testing tool
        </p>
      </div>
      <SignIn
        appearance={{
          elements: {
            rootBox: "w-full max-w-sm",
            card: "shadow-none border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900",
            headerTitle: "hidden",
            headerSubtitle: "hidden",
            socialButtonsBlockButton:
              "border border-zinc-200 dark:border-zinc-700 rounded-lg",
            formButtonPrimary:
              "bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 text-sm font-medium rounded-lg",
            formFieldInput:
              "border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-sm",
            formFieldLabel: "text-sm text-zinc-700 dark:text-zinc-300",
            footerAction: "hidden",
            footer: "hidden",
            alert: "rounded-lg text-sm",
          },
        }}
      />
    </div>
  );
}
