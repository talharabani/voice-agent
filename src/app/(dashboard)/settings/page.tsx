"use client";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export default function SettingsPage() {
  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    toast.success("Settings saved");
  }

  return (
    <div>
      <PageHeader title="Settings" description="Manage your workspace and billing." />

      <Tabs defaultValue="profile" className="w-full">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <Card className="border-brand-border bg-brand-surface">
            <CardHeader>
              <CardTitle className="text-brand-text">Workspace profile</CardTitle>
              <CardDescription>Used on receipts and outbound calls.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-md">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="workspace-name">Workspace name</Label>
                  <Input id="workspace-name" defaultValue="Maple Dental Group" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="workspace-email">Billing email</Label>
                  <Input id="workspace-email" type="email" defaultValue="billing@mapledental.com" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input id="timezone" defaultValue="America/Los_Angeles" />
                </div>
                <Button type="submit" className="w-fit">Save changes</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-6">
          <Card className="border-brand-border bg-brand-surface">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-brand-text">Free plan</CardTitle>
                  <CardDescription>50 calls included per month.</CardDescription>
                </div>
                <Badge>Active</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm text-brand-muted">
                <span>342 of 50 calls used</span>
                <span className="text-brand-text">over limit</span>
              </div>
              <Progress value={100} className="mt-2 bg-brand-surface-raised" />
              <Separator className="my-5 bg-brand-border" />
              <p className="text-sm text-brand-muted">
                Upgrade to Growth for 2,000 calls/mo, custom voices, and CRM
                integrations.
              </p>
            </CardContent>
            <CardFooter>
              <Button>Upgrade plan</Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <Card className="border-brand-border bg-brand-surface">
            <CardHeader>
              <CardTitle className="text-brand-text">Notifications</CardTitle>
              <CardDescription>
                Choose what gets sent to your billing email.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-brand-muted">
              <p>· New lead captured</p>
              <p>· Negative sentiment call detected</p>
              <p>· Weekly summary report</p>
              <p className="text-xs">
                Notification preferences UI coming soon — these are sent by
                default today.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
