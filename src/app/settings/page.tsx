import { connection } from "next/server";
import { BackupCard } from "@/components/backup-card";
import { SettingsForm } from "@/components/settings-form";
import { getSettings } from "@/lib/store";

// Fresh file reads on every visit — no prerendered shell.
export const instant = false;

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await connection();
  const settings = await getSettings();

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Company details and invoice defaults used everywhere.
        </p>
        <SettingsForm settings={settings} />
        <BackupCard />
      </div>
    </div>
  );
}
