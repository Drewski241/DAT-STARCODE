import { AccountClient } from "@/components/account-client";
import { SiteHeader } from "@/components/site-header";

export default function AccountPage() {
  return (
    <div className="relative min-h-screen bg-ink-950 text-copper-50">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-grid opacity-40"
      />
      <div className="relative z-10">
        <SiteHeader />
        <main className="mx-auto max-w-lg px-5 py-16 md:px-10">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-copper-400">
            Account
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight">
            Sign in to DAT STARCODER
          </h1>
          <p className="mt-3 text-sm text-steel-300">
            Sign in with your DAT username and DAT password, or create a new
            account. New accounts start with 20 credits so you can try the
            studio.
          </p>
          <div className="mt-10">
            <AccountClient />
          </div>
        </main>
      </div>
    </div>
  );
}
