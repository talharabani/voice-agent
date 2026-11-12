import { SignIn } from "@clerk/nextjs";
import { Waveform } from "@/components/voice/waveform";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-brand-bg px-4 py-12">
      <div className="flex items-center gap-3">
        <Waveform />
        <span className="font-display text-lg font-semibold tracking-tight text-brand-text">
          VOXA
        </span>
      </div>
      <SignIn
        fallbackRedirectUrl="/dashboard"
        appearance={{
          variables: {
            colorPrimary: "#7c5cfc",
            colorBackground: "#12161f",
            colorForeground: "#e7e9ee",
            colorInput: "#181d29",
            colorInputForeground: "#e7e9ee",
            borderRadius: "0.625rem",
          },
          elements: {
            card: "shadow-xl border border-brand-border",
          },
        }}
      />
    </div>
  );
}
