"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import { agentsApi } from "@/lib/api";
import type { Agent, AgentCreate } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Save, Plus } from "lucide-react";
import { toast } from "sonner";

const LANGUAGES = [
  { value: "ar", label: "العربية" },
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "darija", label: "الدارجة" },
];

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "concierge", label: "Prestige Concierge" },
  { value: "casual", label: "Casual" },
];

export default function AgentPage() {
  const t = useTranslations("Dashboard");
  const { user } = useUser();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [language, setLanguage] = useState("fr");
  const [tone, setTone] = useState("professional");
  const [greeting, setGreeting] = useState("");
  const [fallback, setFallback] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadAgent();
  }, [user]);

  async function loadAgent() {
    setLoading(true);
    try {
      const agents = await agentsApi.list();
      if (agents.length > 0) {
        const a = agents[0];
        setAgent(a);
        setName(a.name);
        setSystemPrompt(a.system_prompt || "");
        setLanguage(a.language || "fr");
        setTone(a.tone || "professional");
        setGreeting(a.greeting_message || "");
        setFallback(a.fallback_message || "");
        setIsActive(a.is_active);
      }
    } catch {
      toast.error(t("errors.loadAgent"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (agent) {
        const updated = await agentsApi.update(agent.id, {
          name,
          system_prompt: systemPrompt,
          language,
          tone,
          greeting_message: greeting,
          fallback_message: fallback,
          is_active: isActive,
        });
        setAgent(updated);
        toast.success(t("agent.saved"));
      } else {
        const created = await agentsApi.create({
          name,
          system_prompt: systemPrompt,
          language,
          tone,
          greeting_message: greeting,
          fallback_message: fallback,
          is_active: isActive,
        });
        setAgent(created);
        toast.success(t("agent.created"));
      }
    } catch (err: any) {
      toast.error(err.message || t("errors.saveAgent"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardContent className="space-y-4 pt-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            {agent ? t("agent.configTitle") : t("agent.createTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("agent.configDesc")}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || !name} className="gap-2">
          {agent ? (
            <Save className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {saving
            ? t("saving")
            : agent
              ? t("agent.saveChanges")
              : t("agent.createAgent")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-secondary" />
            {t("agent.generalSection")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agentName">{t("agent.name")}</Label>
              <Input
                id="agentName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("agent.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("agent.language")}</Label>
              <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("agent.tone")}</Label>
              <Select value={tone} onValueChange={(v) => v && setTone(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((to) => (
                    <SelectItem key={to.value} value={to.value}>
                      {to.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3 pb-1">
              <div className="space-y-2">
                <Label>{t("agent.active")}</Label>
                <div className="flex items-center gap-2">
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                  <span className="text-sm text-muted-foreground">
                    {isActive ? t("operational") : t("inactive")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("agent.systemPromptSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="systemPrompt">{t("agent.systemPrompt")}</Label>
            <Textarea
              id="systemPrompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t("agent.systemPromptPlaceholder")}
              rows={8}
              className="resize-y font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {systemPrompt.length}/8000
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("agent.messagesSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="greeting">{t("agent.greeting")}</Label>
            <Textarea
              id="greeting"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder={t("agent.greetingPlaceholder")}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fallback">{t("agent.fallback")}</Label>
            <Textarea
              id="fallback"
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
              placeholder={t("agent.fallbackPlaceholder")}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
